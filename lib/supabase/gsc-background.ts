import { createAdminClient } from './admin';
import { getGoogleAccessToken } from '@/lib/sync/token';
import { fetchGscDay } from '@/lib/gsc/history';
import { backgroundHistoryDates, planBackgroundDays, retryDelaySeconds } from '@/lib/gsc/background';

export async function enqueueGscSync(organizationId: string, clientId: string): Promise<boolean> {
    const { data, error } = await createAdminClient().rpc('enqueue_gsc_sync', {
        p_organization_id: organizationId, p_client_id: clientId,
    });
    if (error) throw new Error('Unable to schedule search performance');
    return data === true;
}

interface JobRow { id: string; organization_id: string; client_id: string; property: string; lease_token: string; attempts: number }
function rowToJob(row: JobRow) {
    return { id: row.id, organizationId: row.organization_id, clientId: row.client_id,
        property: row.property, leaseToken: row.lease_token, attempts: row.attempts };
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
            const dates = backgroundHistoryDates(now);
            const auth = await getGoogleAccessToken(job.clientId, 'gsc');
            if (!auth || auth.creds.site_url !== job.property) throw new Error('Connection changed');
            const { data: days, error: coverageError } = await admin.from('gsc_history_days')
                .select('data_date,imported_at').eq('organization_id', job.organizationId)
                .eq('client_id', job.clientId).eq('property', job.property)
                .gte('data_date', dates.at(-1)!).lte('data_date', dates[0]);
            if (coverageError) throw new Error('Unable to read coverage');
            const selected = planBackgroundDays(dates, days ?? [], now);
            const signal = AbortSignal.timeout(Math.max(1, Math.min(60000, deadline - Date.now() - 2000)));
            const savedDates = new Set((days ?? []).map(day => day.data_date));
            for (const date of selected) {
                const day = await fetchGscDay(job.property, auth.token, date, { signal });
                const { data: saved, error: saveError } = await admin.rpc('replace_gsc_history_day', {
                    p_organization_id: job.organizationId, p_client_id: job.clientId, p_property: job.property,
                    p_date: date, p_fetched_at: day.fetchedAt, p_page_limited: day.pageLimited,
                    p_query_limited: day.queryLimited, p_facts: day.facts,
                });
                if (saveError || saved !== true) throw new Error('Snapshot was not saved');
                savedDates.add(date);
                imported += 1;
            }
            remaining = dates.some(date => !savedDates.has(date));
            succeeded = true;
            delay = remaining ? 0 : 86400;
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
