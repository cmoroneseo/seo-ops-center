import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { applySuggestions, type ApplicableSuggestion } from '@/lib/approvals/apply-suggestion';
import type { ContentAnchor } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Accept or reject client suggestions.
 *
 * Accepting is a real edit to the working draft, not a note for someone to re-key — which
 * is only possible because the app owns the document after import. All accepted
 * suggestions for a document are applied in one pass so they can be ordered back to
 * front; applying them one at a time would invalidate the anchors of the rest.
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
    const docId = body?.docId ? String(body.docId) : '';
    const action = body?.action === 'reject' ? 'reject' : 'accept';
    const ids: string[] = Array.isArray(body?.suggestionIds) ? body.suggestionIds.map(String) : [];

    if (!docId || ids.length === 0) {
        return NextResponse.json({ error: 'docId and suggestionIds are required.' }, { status: 400 });
    }

    // RLS scopes this — a document outside the caller's org is simply not found.
    const { data: doc } = await supabase
        .from('content_approval_docs')
        .select('id, organization_id, working_json, review_locked')
        .eq('id', docId)
        .maybeSingle();

    if (!doc) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });

    if (action === 'reject') {
        const { error } = await supabase
            .from('content_suggestions')
            .update({ status: 'rejected', decided_by: user.id, decided_at: new Date().toISOString() })
            .eq('doc_id', docId)
            .in('id', ids);
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ rejected: ids.length });
    }

    // A document is either open for review or open for editing, never both — and
    // accepting a suggestion is editing.
    if (doc.review_locked) {
        return NextResponse.json({
            error: 'This document is locked for client review.',
            hint: 'Unlock it to edit, which closes the current review round.',
        }, { status: 409 });
    }

    const { data: rows } = await supabase
        .from('content_suggestions')
        .select('id, kind, anchor, payload, status')
        .eq('doc_id', docId)
        .in('id', ids);

    const pending = (rows ?? []).filter((r) => r.status === 'pending');
    if (pending.length === 0) {
        return NextResponse.json({ error: 'No pending suggestions to apply.' }, { status: 409 });
    }

    const applicable: ApplicableSuggestion[] = pending.map((r) => ({
        id: r.id,
        kind: r.kind,
        anchor: r.anchor as ContentAnchor,
        payload: r.payload ?? '',
    }));

    const result = applySuggestions(doc.working_json as Record<string, unknown>, applicable);

    if (result.applied.length > 0) {
        const { error: saveError } = await supabase
            .from('content_approval_docs')
            .update({ working_json: result.doc, updated_at: new Date().toISOString() })
            .eq('id', docId);
        if (saveError) return NextResponse.json({ error: saveError.message }, { status: 500 });

        await supabase
            .from('content_suggestions')
            .update({ status: 'accepted', decided_by: user.id, decided_at: new Date().toISOString() })
            .in('id', result.applied);
    }

    // Skipped suggestions stay pending on purpose: a stale one needs a human to look at
    // what actually changed, and silently marking it accepted would hide that.
    return NextResponse.json({
        applied: result.applied.length,
        skipped: result.skipped,
    });
}
