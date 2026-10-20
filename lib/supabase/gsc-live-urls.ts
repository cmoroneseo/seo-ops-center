import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchLiveUrlPerformance, refreshLiveUrlBatch, type LiveUrlCheck } from '@/lib/gsc/live-url-sync';
import { normalizeShipDate } from '@/lib/search-reporting/proof';
import { ptToday } from '@/lib/sync/months';

type Admin = SupabaseClient;

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function readPages(build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }> }) {
    const pageSize = 1000;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await build().range(from, from + pageSize - 1);
        if (error) throw new Error('Unable to refresh live URL results');
        const batch = (data ?? []) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < pageSize) return rows;
    }
}

/**
 * Asks Search Console for each shipped URL and replaces that URL's stored rows.
 * Runs from the existing daily history sync. No separate cron.
 */
export async function refreshClientLiveUrls(input: {
    admin: Admin;
    organizationId: string;
    clientId: string;
    property: string;
    token: string;
    now: Date;
    budgetMs: number;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<{ refreshed: number }> {
    const taskRows = await readPages(() => input.admin.from('tasks')
        .select('published_url, completed_at')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('status', 'done'));
    const deliverableRows = await readPages(() => input.admin.from('deliverables')
        .select('published_url, delivered_on')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('status', 'Published'));
    const subjects = [
        ...taskRows.flatMap(row => {
            const url = text(row.published_url);
            const goLive = normalizeShipDate(text(row.completed_at));
            return url && goLive ? [{ url, goLive }] : [];
        }),
        ...deliverableRows.flatMap(row => {
            const url = text(row.published_url);
            const goLive = normalizeShipDate(text(row.delivered_on));
            return url && goLive ? [{ url, goLive }] : [];
        }),
    ];
    if (subjects.length === 0) return { refreshed: 0 };

    const checkRows = await readPages(() => input.admin.from('gsc_live_url_checks')
        .select('url_key, go_live, fetched_at')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('property', input.property));
    const checks: LiveUrlCheck[] = checkRows.flatMap(row => {
        const urlKey = text(row.url_key);
        const goLive = normalizeShipDate(text(row.go_live));
        const fetchedAt = text(row.fetched_at);
        return urlKey && goLive && fetchedAt ? [{ urlKey, goLive, fetchedAt }] : [];
    });

    return refreshLiveUrlBatch({
        subjects,
        checks,
        now: input.now,
        today: ptToday(input.now),
        budgetMs: input.budgetMs,
        fetchUrl: (candidate, windows) => fetchLiveUrlPerformance(
            input.property,
            input.token,
            candidate.url,
            { start: windows.coverageStart, end: windows.coverageEnd },
            { start: windows.afterStart, end: windows.afterEnd },
            { fetch: input.fetchImpl, signal: input.signal },
        ),
        save: async (candidate, windows, fetched, fetchedAt) => {
            const { error } = await input.admin.rpc('replace_gsc_live_url', {
                p_organization_id: input.organizationId,
                p_client_id: input.clientId,
                p_property: input.property,
                p_url_key: candidate.urlKey,
                p_go_live: candidate.goLive,
                p_coverage_start: windows.coverageStart,
                p_coverage_end: windows.coverageEnd,
                p_query_window_start: windows.afterStart,
                p_query_window_end: windows.afterEnd,
                p_fetched_at: fetchedAt,
                p_days: fetched.rows.map(row => ({
                    data_date: row.date,
                    clicks: row.clicks,
                    impressions: row.impressions,
                    position: row.position,
                })),
                p_queries: fetched.queries.map(row => ({
                    query: row.query,
                    clicks: row.clicks,
                    impressions: row.impressions,
                    position: row.position,
                })),
            });
            if (error) throw new Error('Unable to save live URL results');
        },
    });
}
