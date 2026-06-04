import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { fetchGA4 } from '@/lib/sync/fetchGA4';
import { fetchGSC } from '@/lib/sync/fetchGSC';
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
/** Allow either the cron secret (machine) or a logged-in user (manual "Sync Now"). */
async function isAuthorized(req: NextRequest): Promise<boolean> {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;

    // Fall back to an authenticated dashboard session — no secret needed in the browser.
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
    return !!user;
}

export async function POST(req: NextRequest) {
    if (!(await isAuthorized(req))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Parse optional body for manual single-client sync
    let singleClientId: string | null = null;
    let targetMonth = currentMonth;
    try {
        const body = await req.json().catch(() => ({}));
        singleClientId = body.clientId ?? null;
        targetMonth = body.month ?? currentMonth;
    } catch { /* no body */ }

    // Fetch all active organizations
    const { data: orgs } = await admin.from('organizations').select('id').order('id');
    if (!orgs?.length) return NextResponse.json({ synced: 0 });

    const errors: { clientId: string; service: string; message: string }[] = [];
    let totalSynced = 0;

    for (const org of orgs) {
        // Create a sync_run record for this org
        const { data: runRow } = await admin.from('sync_runs').insert({
            organization_id: org.id,
            status: 'running',
        }).select('id').single();
        const syncRunId = runRow?.id;

        // Get all active clients for this org (or just the one requested)
        let clientQuery = admin
            .from('clients')
            .select('id, organization_id')
            .eq('organization_id', org.id)
            .eq('status', 'active');

        if (singleClientId) clientQuery = clientQuery.eq('id', singleClientId);

        const { data: clients } = await clientQuery;
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
                }
            } catch (e: any) {
                // GBP failures are non-fatal — don't mark as client error
                console.warn(`GBP sync skipped for ${client.id}:`, e.message);
            }

            // ── Ahrefs ───────────────────────────────────────────────────────
            try {
                const ahrefsData = await fetchAhrefs(client.id);
                if (ahrefsData) {
                    const r = await upsertMetric({
                        organizationId: org.id, clientId: client.id,
                        source: 'ahrefs', metricMonth: targetMonth,
                        data: ahrefsData, syncRunId,
                    });
                    if (!r.success) throw new Error(`upsert failed: ${r.error}`);
                }
            } catch (e: any) {
                clientErrors.push(`ahrefs: ${e.message}`);
                errors.push({ clientId: client.id, service: 'ahrefs', message: e.message });
            }

            if (clientErrors.length === 0) orgSynced++;
            else orgErrored++;

            totalSynced++;
        }

        // Finalize sync_run
        await admin.from('sync_runs').update({
            status: orgErrored === 0 ? 'completed' : orgSynced === 0 ? 'failed' : 'partial',
            finished_at: new Date().toISOString(),
            clients_synced: orgSynced,
            clients_errored: orgErrored,
            error_summary: errors,
        }).eq('id', syncRunId);
    }

    return NextResponse.json({
        ok: true,
        month: targetMonth,
        clients: totalSynced,
        errors: errors.length,
        errorDetail: errors.length ? errors : undefined,
    });
}

// Also support GET for Vercel cron (cron jobs send GET by default)
export async function GET(req: NextRequest) {
    return POST(req);
}
