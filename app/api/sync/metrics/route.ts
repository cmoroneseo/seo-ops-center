import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireClientIntegrationManager } from '@/lib/security/tenant-authz';
import { authorizeSyncRequest, SyncRequestError } from '@/lib/sync/request';
import { markIntegrationSynced } from '@/lib/sync/token';
import { fetchGA4 } from '@/lib/sync/fetchGA4';
import { fetchGSC } from '@/lib/sync/fetchGSC';
import { syncGscHistory } from '@/lib/supabase/gsc-history';
import { fetchGBP } from '@/lib/sync/fetchGBP';
import { fetchAhrefs } from '@/lib/sync/fetchAhrefs';
import { upsertMetric } from '@/lib/sync/upsertMetric';

export const maxDuration = 300; // Vercel max for Pro plan

/**
 * POST /api/sync/metrics
 *
 * Triggered by Vercel Cron daily at 8am UTC (2am CT).
 * Also callable manually with the same secret for ad-hoc syncs.
 *
 * Headers: { Authorization: 'Bearer <CRON_SECRET>' }
 * Body (optional): { clientId: string, month: string } — sync a single client/month
 */
export async function POST(req: NextRequest) {
    let scope;
    try {
        scope = await authorizeSyncRequest(req, process.env.CRON_SECRET, requireClientIntegrationManager);
    } catch (error) {
        return NextResponse.json({ error: error instanceof SyncRequestError ? error.message : 'Unable to authorize sync' }, { status: error instanceof SyncRequestError ? error.status : 500 });
    }
    const admin = createAdminClient();
    const singleClientId = scope.clientId;
    const targetMonth = scope.month;
    let orgQuery = admin.from('organizations').select('id').order('id');
    if (scope.organizationId) orgQuery = orgQuery.eq('id', scope.organizationId);
    const { data: orgs, error: orgError } = await orgQuery;
    if (orgError) return NextResponse.json({ error: 'Unable to load sync organizations' }, { status: 500 });
    if (!orgs?.length) return NextResponse.json({ synced: 0 });

    const errors: { clientId: string; service: string; message: string }[] = [];
    let totalSynced = 0;
    let sourcesUpdated = 0;

    for (const org of orgs) {
        const orgErrors: typeof errors = [];
        // Create a sync_run record for this org
        const { data: runRow, error: runError } = await admin.from('sync_runs').insert({
            organization_id: org.id,
            status: 'running',
        }).select('id').single();
        if (runError || !runRow) return NextResponse.json({ error: 'Unable to start sync run' }, { status: 500 });
        const syncRunId = runRow.id;

        // Get all active clients for this org (or just the one requested)
        let clientQuery = admin
            .from('clients')
            .select('id, organization_id')
            .eq('organization_id', org.id)
            .eq('status', 'active');

        if (singleClientId) clientQuery = clientQuery.eq('id', singleClientId);

        const { data: clients, error: clientsError } = await clientQuery;
        if (clientsError) {
            await admin.from('sync_runs').update({ status: 'failed', finished_at: new Date().toISOString() }).eq('id', syncRunId);
            return NextResponse.json({ error: 'Unable to load sync clients' }, { status: 500 });
        }
        if (!clients?.length) {
            await admin.from('sync_runs').update({
                status: 'completed', finished_at: new Date().toISOString(),
            }).eq('id', syncRunId);
            continue;
        }

        let orgSynced = 0;
        let orgErrored = 0;

        for (const client of clients) {
            const clientErrors: string[] = [];
            let clientSourcesUpdated = 0;

            // ── GA4 ──────────────────────────────────────────────────────────
            try {
                const ga4Data = await fetchGA4(client.id, targetMonth);
                if (ga4Data) {
                    const r = await upsertMetric({
                        organizationId: org.id, clientId: client.id,
                        source: 'ga4', metricMonth: targetMonth,
                        data: ga4Data, syncRunId,
                    });
                    if (!r.success) throw new Error(`upsert failed: ${r.error}`);
                    clientSourcesUpdated++;
                    sourcesUpdated++;
                }
            } catch (e: any) {
                clientErrors.push(`ga4: ${e.message}`);
                errors.push({ clientId: client.id, service: 'ga4', message: e.message });
            }

            // ── GSC ──────────────────────────────────────────────────────────
            try {
                const gscData = await fetchGSC(client.id, targetMonth);
                if (gscData) {
                    const r = await upsertMetric({
                        organizationId: org.id, clientId: client.id,
                        source: 'gsc', metricMonth: targetMonth,
                        data: gscData, syncRunId,
                    });
                    if (!r.success) throw new Error(`upsert failed: ${r.error}`);
                    await markIntegrationSynced(client.id, 'gsc');
                    clientSourcesUpdated++;
                    sourcesUpdated++;
                    // Enable only after migration 049. Manual report sync keeps its original scope.
                    if (process.env.GSC_HISTORY_ENABLED === 'true' && !scope.organizationId) {
                        await syncGscHistory(org.id, client.id);
                    }
                }
            } catch (e: any) {
                clientErrors.push(`gsc: ${e.message}`);
                errors.push({ clientId: client.id, service: 'gsc', message: e.message });
            }

            // ── GBP (skipped if quota not approved — returns null gracefully) ─
            try {
                const gbpData = await fetchGBP(client.id, targetMonth);
                if (gbpData) {
                    const r = await upsertMetric({
                        organizationId: org.id, clientId: client.id,
                        source: 'gbp', metricMonth: targetMonth,
                        data: gbpData, syncRunId,
                    });
                    if (!r.success) throw new Error(`upsert failed: ${r.error}`);
                    clientSourcesUpdated++;
                    sourcesUpdated++;
                }
            } catch (e: any) {
                // GBP failures are non-fatal — don't mark as client error
                console.warn(`GBP sync skipped for ${client.id}:`, e.message);
            }

            // ── Ahrefs ───────────────────────────────────────────────────────
            try {
                const ahrefsData = await fetchAhrefs(client.id, targetMonth);
                if (ahrefsData) {
                    const r = await upsertMetric({
                        organizationId: org.id, clientId: client.id,
                        source: 'ahrefs', metricMonth: targetMonth,
                        data: ahrefsData, syncRunId,
                    });
                    if (!r.success) throw new Error(`upsert failed: ${r.error}`);
                    clientSourcesUpdated++;
                    sourcesUpdated++;
                }
            } catch (e: any) {
                clientErrors.push(`ahrefs: ${e.message}`);
                errors.push({ clientId: client.id, service: 'ahrefs', message: e.message });
            }

            orgErrors.push(...errors.filter(error => error.clientId === client.id));
            if (clientErrors.length > 0) orgErrored++;
            else if (clientSourcesUpdated > 0) orgSynced++;

            totalSynced++;
        }

        // Finalize sync_run
        await admin.from('sync_runs').update({
            status: orgErrored === 0 ? 'completed' : orgSynced === 0 ? 'failed' : 'partial',
            finished_at: new Date().toISOString(),
            clients_synced: orgSynced,
            clients_errored: orgErrored,
            error_summary: orgErrors,
        }).eq('id', syncRunId);
    }

    return NextResponse.json({
        ok: true,
        month: targetMonth,
        clients: totalSynced,
        sourcesUpdated,
        errors: errors.length,
        errorDetail: errors.length ? errors : undefined,
    });
}

// Also support GET for Vercel cron (cron jobs send GET by default)
export async function GET(req: NextRequest) {
    return POST(req);
}
