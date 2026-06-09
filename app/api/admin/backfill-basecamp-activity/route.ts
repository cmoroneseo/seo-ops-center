import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/backfill-basecamp-activity
 *
 * One-time backfill: finds all clients that have Basecamp configured in
 * custom_fields but have no 'integration.connected' activity log entry
 * for the 'basecamp' service, then inserts the missing entries.
 *
 * Safe to run multiple times — skips clients that already have an entry.
 */
export async function POST(req: NextRequest) {
    // Simple shared secret guard — not a full auth flow since this is one-time
    const authHeader = req.headers.get('authorization');
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!authHeader || authHeader !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    // 1. Find all clients with Basecamp configured
    const { data: clients, error: clientsErr } = await admin
        .from('clients')
        .select('id, name, organization_id, custom_fields');

    if (clientsErr) {
        return NextResponse.json({ error: clientsErr.message }, { status: 500 });
    }

    const basecampClients = (clients ?? []).filter((c: any) => {
        const cf = (c.custom_fields as Record<string, unknown>) ?? {};
        return cf.basecamp_project_id && cf.basecamp_sync_enabled;
    });

    if (basecampClients.length === 0) {
        return NextResponse.json({ message: 'No Basecamp-configured clients found', inserted: 0 });
    }

    // 2. Check which clients already have a Basecamp activity entry
    const clientIds = basecampClients.map((c: any) => c.id);
    const { data: existing } = await admin
        .from('client_activity_log')
        .select('client_id')
        .in('client_id', clientIds)
        .in('event_type', ['integration.connected', 'integration.reconfigured'])
        .filter('metadata->>service', 'eq', 'basecamp');

    const alreadyLogged = new Set((existing ?? []).map((r: any) => r.client_id));

    // 3. Insert missing entries
    const toBackfill = basecampClients.filter((c: any) => !alreadyLogged.has(c.id));
    const results: { client: string; status: string }[] = [];

    for (const client of toBackfill) {
        const cf = (client.custom_fields as Record<string, unknown>) ?? {};
        try {
            await logClientActivity({
                organizationId: client.organization_id,
                clientId: client.id,
                eventType: 'integration.connected',
                // No actorId — retroactive entry, actor unknown
                metadata: {
                    service: 'basecamp',
                    basecamp_project_id: cf.basecamp_project_id ?? null,
                    basecamp_todolist_id: cf.basecamp_todolist_id ?? null,
                    sync_enabled: true,
                    backfilled: true,
                },
            });
            results.push({ client: client.name, status: 'inserted' });
        } catch {
            results.push({ client: client.name, status: 'error' });
        }
    }

    const skipped = basecampClients
        .filter((c: any) => alreadyLogged.has(c.id))
        .map((c: any) => ({ client: c.name, status: 'already logged — skipped' }));

    return NextResponse.json({
        message: `Backfill complete. ${toBackfill.length} inserted, ${skipped.length} skipped.`,
        results: [...results, ...skipped],
    });
}
