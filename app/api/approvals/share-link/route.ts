import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { createAdminClient } from '@/lib/supabase/admin';
import { canSendForReview } from '@/lib/approvals/batch-status';
import { defaultExpiry, generateToken, hashToken } from '@/lib/approvals/token';

export const dynamic = 'force-dynamic';

/**
 * Mint a share link for a batch.
 *
 * The raw token is returned exactly once and never stored — only its sha-256 hash lands
 * in the table. If the team loses the URL they mint a new one; there is no way to read
 * the old one back, which is the point.
 */
export async function POST(req: NextRequest) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }); },
                remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }); },
            },
        },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const batchId = body?.batchId ? String(body.batchId) : '';
    if (!batchId) return NextResponse.json({ error: 'batchId is required.' }, { status: 400 });

    // RLS scopes this read — a batch outside the caller's org is simply not found.
    const { data: batch } = await supabase
        .from('content_approval_batches')
        .select('id, organization_id')
        .eq('id', batchId)
        .maybeSingle();

    if (!batch) return NextResponse.json({ error: 'Batch not found.' }, { status: 404 });

    const { data: docs } = await supabase
        .from('content_approval_docs')
        .select('id, current_version_id, deliverable_id, archived_at')
        .eq('batch_id', batchId);

    const sendability = canSendForReview(
        (docs ?? []).map((d) => ({
            id: d.id,
            currentVersionId: d.current_version_id,
            deliverableId: d.deliverable_id,
            archivedAt: d.archived_at,
        })),
    );

    if (!sendability.ok) {
        return NextResponse.json(
            { error: 'This batch is not ready to send.', reasons: sendability.reasons },
            { status: 409 },
        );
    }

    const token = generateToken();
    const expiresInDays = Number.isFinite(body?.expiresInDays) ? Number(body.expiresInDays) : undefined;

    // Service role: the caller's authorization was already established above, and this
    // write must not depend on a storage policy for the hash.
    const admin = createAdminClient();
    const { data: link, error } = await admin
        .from('content_share_links')
        .insert({
            batch_id: batchId,
            organization_id: batch.organization_id,
            token_hash: hashToken(token),
            allow_comments: body?.allowComments !== false,
            expires_at: defaultExpiry(new Date(), expiresInDays),
            created_by: user.id,
        })
        .select('id, expires_at')
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const now = new Date().toISOString();
    await admin
        .from('content_approval_batches')
        .update({ status: 'in_review', sent_at: now, updated_at: now })
        .eq('id', batchId);

    // Lock every live document: a document is either open for review or open for
    // editing, never both.
    await admin
        .from('content_approval_docs')
        .update({ review_locked: true, updated_at: now })
        .eq('batch_id', batchId)
        .is('archived_at', null);

    const origin = req.nextUrl.origin;
    return NextResponse.json({
        linkId: link.id,
        expiresAt: link.expires_at,
        // Shown once. Paste it into the client's Basecamp project.
        url: `${origin}/review/${token}`,
    });
}
