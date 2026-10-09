import { createAdminClient } from './admin';
import { getGoogleAccessToken } from '@/lib/sync/token';
import { fetchGscDay, gbpLandingUrlsFromCustomFields } from '@/lib/gsc/history';
import {
    backgroundHistoryDates, backgroundWindowLength, planBackgroundDays, planV2Backfill, retryDelaySeconds,
    V2_BACKFILL_DAYS_PER_CLAIM, V2_BACKFILL_HISTORY_DAYS, V2_DAY_BUDGET_MS, V2_REQUEST_GAP_MS,
} from '@/lib/gsc/background';
import { gscHistoryV2BackfillEnabled, gscHistoryV2Enabled } from '@/lib/gsc/flags';

export async function enqueueGscSync(organizationId: string, clientId: string): Promise<boolean> {
    const { data, error } = await createAdminClient().rpc('enqueue_gsc_sync', {
        p_organization_id: organizationId, p_client_id: clientId,
    });
    if (error) throw new Error('Unable to schedule search performance');
    return data === true;
}

export async function enqueueGscV2Backfill(organizationId: string, clientId: string): Promise<boolean> {
    if (!gscHistoryV2BackfillEnabled()) return false;
    const { data, error } = await createAdminClient().rpc('enqueue_gsc_v2_backfill', {
        p_organization_id: organizationId, p_client_id: clientId,
    });
    if (error) throw new Error('Unable to schedule search performance');
    return data === true;
}

interface JobRow {
    id: string;
    organization_id: string;
    client_id: string;
    property: string;
    lease_token: string;
    attempts: number;
    cursor_date?: string | null;
}
function rowToJob(row: JobRow) {
    return {
        id: row.id, organizationId: row.organization_id, clientId: row.client_id,
        property: row.property, leaseToken: row.lease_token, attempts: row.attempts,
        cursorDate: row.cursor_date ?? null,
    };
}

async function landingUrlsFor(admin: ReturnType<typeof createAdminClient>, organizationId: string, clientId: string) {
    const { data } = await admin.from('clients').select('custom_fields').eq('id', clientId).eq('organization_id', organizationId).maybeSingle();
    return gbpLandingUrlsFromCustomFields(data?.custom_fields);
}

/** Leased batches survive request cancellation, crashes, retries, and overlapping workers. */
export async function runGscSyncWorker(options: { clientId?: string; budgetMs?: number } = {}) {
    const deadline = Date.now() + (options.budgetMs ?? 240000);
    const admin = createAdminClient();
    let imported = 0;
    let failed = 0;
    while (Date.now() + 20000 < deadline) {
        const { data, error } = await admin.rpc('claim_gsc_sync', { p_client_id: options.clientId ?? null });
        if (error) throw new Error('Unable to claim search performance work');
        const row = (data as JobRow[] | null)?.[0];
        if (!row) break;
        const job = rowToJob(row);
        let remaining = false;
        let delay = 0;
        let succeeded = false;
        try {
            const now = new Date();
            const dates = backgroundHistoryDates(now, backgroundWindowLength());
            const v2 = gscHistoryV2Enabled();
            const auth = await getGoogleAccessToken(job.clientId, 'gsc');
            if (!auth || auth.creds.site_url !== job.property) throw new Error('Connection changed');
            const { data: days, error: coverageError } = await admin.from('gsc_history_days')
                .select('data_date,imported_at').eq('organization_id', job.organizationId)
                .eq('client_id', job.clientId).eq('property', job.property)
                .gte('data_date', dates.at(-1)!).lte('data_date', dates[0]);
            if (coverageError) throw new Error('Unable to read coverage');
            const selected = planBackgroundDays(dates, days ?? [], now);
            const sharedSignal = v2 ? null : AbortSignal.timeout(Math.max(1, Math.min(60000, deadline - Date.now() - 2000)));
            const savedDates = new Set((days ?? []).map(day => day.data_date));
            const gbpLandingUrls = v2 ? await landingUrlsFor(admin, job.organizationId, job.clientId) : [];
            for (const date of selected) {
                // v1 keeps one shared timeout. v2 days make more requests, so each day gets its own.
                const signal = sharedSignal ?? AbortSignal.timeout(Math.max(1, Math.min(60000, deadline - Date.now() - 2000)));
                const day = await fetchGscDay(job.property, auth.token, date, {
                    signal, v2, gbpLandingUrls, minIntervalMs: v2 ? V2_REQUEST_GAP_MS : 0,
                });
                const { data: saved, error: saveError } = await admin.rpc('replace_gsc_history_day', {
                    p_organization_id: job.organizationId, p_client_id: job.clientId, p_property: job.property,
                    p_date: date, p_fetched_at: day.fetchedAt, p_page_limited: day.pageLimited,
                    p_query_limited: day.queryLimited, p_facts: day.facts, p_is_incomplete: day.isIncomplete,
                });
                if (saveError || saved !== true) throw new Error('Snapshot was not saved');
                savedDates.add(date);
                imported += 1;
            }
            if (selected.length > 0) {
                // Clear recovered connection errors only for the property we just fetched.
                const { error: connectionError } = await admin.from('client_integrations').update({
                    sync_status: 'active', error_message: null, last_synced_at: new Date().toISOString(),
                }).eq('organization_id', job.organizationId).eq('client_id', job.clientId)
                    .eq('service', 'gsc').eq('credentials->>site_url', job.property);
                if (connectionError) throw new Error('Unable to update connection health');
            }
            remaining = dates.some(date => !savedDates.has(date));
            succeeded = true;
            delay = remaining ? 0 : 3600;
        } catch {
            // No raw API responses or tokens enter job records or client-visible errors.
            failed += 1;
            remaining = true;
            delay = retryDelaySeconds(job.attempts);
        }
        const { error: finishError } = await admin.from('gsc_sync_jobs').update({
            status: remaining ? 'pending' : 'idle', available_at: new Date(Date.now() + delay * 1000).toISOString(),
            lease_token: null, lease_until: null, updated_at: new Date().toISOString(),
            ...(succeeded ? { attempts: 0 } : {}),
        }).eq('id', job.id).eq('lease_token', job.leaseToken);
        if (finishError) throw new Error('Unable to release search performance work');
    }
    return { imported, failed };
}

/** Leased, newest-first, a couple of days per claim. Cron keeps calling until the cursor reaches the oldest day. */
export async function runGscV2BackfillWorker(options: { clientId?: string; budgetMs?: number } = {}) {
    if (!gscHistoryV2BackfillEnabled()) return { imported: 0, failed: 0, skipped: true as const };
    const deadline = Date.now() + (options.budgetMs ?? 240000);
    const admin = createAdminClient();
    let imported = 0;
    let failed = 0;
    while (Date.now() + V2_DAY_BUDGET_MS < deadline) {
        const { data, error } = await admin.rpc('claim_gsc_sync', { p_client_id: options.clientId ?? null, p_kind: 'v2_backfill' });
        if (error) throw new Error('Unable to claim search performance work');
        const row = (data as JobRow[] | null)?.[0];
        if (!row) break;
        const job = rowToJob(row);
        let remaining = false;
        let delay = 0;
        let succeeded = false;
        let cursor = job.cursorDate;
        try {
            const now = new Date();
            const dates = backgroundHistoryDates(now, V2_BACKFILL_HISTORY_DAYS);
            const auth = await getGoogleAccessToken(job.clientId, 'gsc');
            if (!auth || auth.creds.site_url !== job.property) throw new Error('Connection changed');
            const gbpLandingUrls = await landingUrlsFor(admin, job.organizationId, job.clientId);
            let plan = planV2Backfill(dates, cursor, V2_BACKFILL_DAYS_PER_CLAIM);
            if (plan.done) {
                cursor = plan.cursor;
                succeeded = true;
                delay = 86400;
            } else {
                for (const date of plan.dates) {
                    if (Date.now() + V2_DAY_BUDGET_MS >= deadline) {
                        remaining = true;
                        break;
                    }
                    const signal = AbortSignal.timeout(Math.max(1, Math.min(60000, deadline - Date.now() - 2000)));
                    const day = await fetchGscDay(job.property, auth.token, date, {
                        signal, v2: true, gbpLandingUrls, minIntervalMs: V2_REQUEST_GAP_MS,
                    });
                    const { data: saved, error: saveError } = await admin.rpc('replace_gsc_history_day', {
                        p_organization_id: job.organizationId, p_client_id: job.clientId, p_property: job.property,
                        p_date: date, p_fetched_at: day.fetchedAt, p_page_limited: day.pageLimited,
                        p_query_limited: day.queryLimited, p_facts: day.facts, p_is_incomplete: day.isIncomplete,
                    });
                    if (saveError || saved !== true) throw new Error('Snapshot was not saved');
                    cursor = date;
                    imported += 1;
                    const { data: held, error: holdError } = await admin.from('gsc_sync_jobs').update({
                        lease_until: new Date(Date.now() + 90000).toISOString(),
                        cursor_date: cursor,
                        updated_at: new Date().toISOString(),
                    }).eq('id', job.id).eq('lease_token', job.leaseToken).select('id');
                    if (holdError || (held?.length ?? 0) !== 1) throw new Error('Search performance lease expired');
                }
                plan = planV2Backfill(dates, cursor, 1);
                remaining = !plan.done;
                succeeded = true;
                delay = remaining ? 0 : 86400;
            }
        } catch {
            failed += 1;
            remaining = true;
            delay = retryDelaySeconds(job.attempts);
        }
        const { error: finishError } = await admin.from('gsc_sync_jobs').update({
            status: remaining ? 'pending' : 'idle',
            available_at: new Date(Date.now() + delay * 1000).toISOString(),
            lease_token: null,
            lease_until: null,
            cursor_date: cursor,
            updated_at: new Date().toISOString(),
            ...(succeeded ? { attempts: 0 } : {}),
        }).eq('id', job.id).eq('lease_token', job.leaseToken);
        if (finishError) throw new Error('Unable to release search performance work');
    }
    return { imported, failed, skipped: false as const };
}
