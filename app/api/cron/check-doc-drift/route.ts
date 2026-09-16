import { NextRequest, NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { fetchRevisionId } from '@/lib/google/docs';
import { loadServiceAccountFromEnv } from '@/lib/google/service-account';
import { notifyApproval } from '@/lib/approvals/notify';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET|POST /api/cron/check-doc-drift
 *
 * The import is a one-way door: once content is imported, the app owns it and the Google
 * Doc is archival. This catches the one way that gets violated — someone edits the source
 * Doc afterwards and assumes the client will see the change. They will not.
 *
 * Detection is free: the Docs API returns a `revisionId` on every read, so comparing it
 * against the one stored at import costs a single metadata request per document.
 *
 * Daily, because the Vercel account is on the Hobby plan, which rejects any cron running
 * more than once a day. That only sets how long drift can sit unnoticed; the check itself
 * is exact.
 *
 * Auth: Bearer CRON_SECRET only — this runs with no user session.
 */
function isAuthorized(req: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Bound the sweep so a Doc that was archived long ago is not polled forever. */
const LOOKBACK_DAYS = 120;

async function run(req: NextRequest) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const credentials = loadServiceAccountFromEnv();
    if (!credentials) {
        return NextResponse.json({ error: 'Google service account not configured.' }, { status: 500 });
    }

    const admin = createAdminClient();
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);

    const { data: docs, error } = await admin
        .from('content_approval_docs')
        .select('id, batch_id, organization_id, title, gdoc_document_id, gdoc_revision_id, gdoc_imported_at')
        .not('gdoc_document_id', 'is', null)
        .is('archived_at', null)
        .gte('gdoc_imported_at', since.toISOString());

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    let checked = 0;
    let drifted = 0;
    let unreadable = 0;

    for (const doc of docs ?? []) {
        if (!doc.gdoc_document_id || !doc.gdoc_revision_id) continue;
        checked += 1;

        const current = await fetchRevisionId(credentials, doc.gdoc_document_id);
        // null means we could not read it — a permission change or a deleted Doc. Not
        // drift, and not worth a false alarm; it is counted so a spike is visible.
        if (current === null) { unreadable += 1; continue; }
        if (current === doc.gdoc_revision_id) continue;

        drifted += 1;

        // Stamp the new revision so a single edit notifies once rather than every day
        // until someone acts on it.
        await admin
            .from('content_approval_docs')
            .update({ gdoc_revision_id: current })
            .eq('id', doc.id);

        await notifyApproval({
            organizationId: doc.organization_id,
            batchId: doc.batch_id,
            type: 'approval_doc_drifted',
            title: `The source Doc for “${doc.title}” changed after it was imported`,
            body: 'Those edits are not in the portal. Re-import the document if the client should see them.',
            entityType: 'content_approval_doc',
            entityId: doc.id,
        });
    }

    return NextResponse.json({ checked, drifted, unreadable });
}

export async function GET(req: NextRequest) { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
