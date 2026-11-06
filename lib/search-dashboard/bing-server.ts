/**
 * Reads stored Bing rows for one client. This is not a Bing Webmaster API
 * client. Position uses avg_impression_position only.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DateSpan } from '@/lib/search-reporting/range';

export interface BingSearchPayload {
    link: { syncStatus: 'active' | 'error'; lastSyncedAt: string | null } | null;
    traffic: Array<{ date: string; clicks: number; impressions: number; queriesComplete: boolean; pagesComplete: boolean }>;
    queries: Array<{ weekEnding: string; query: string; clicks: number; impressions: number; avgImpressionPosition: number | null; stale: boolean }>;
    pages: Array<{ weekEnding: string; page: string; clicks: number; impressions: number; avgImpressionPosition: number | null }>;
    truncated: boolean;
}

function num(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function date(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const day = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

async function readPages(
    build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>,
): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < 8; page += 1) {
        const from = page * 1000;
        const { data, error } = await build(from, from + 999);
        if (error) throw new Error('Unable to read Bing history');
        const batch = Array.isArray(data) ? data : [];
        for (const row of batch) {
            if (row && typeof row === 'object') rows.push(row as Record<string, unknown>);
        }
        if (batch.length < 1000) return { rows, truncated: false };
    }
    return { rows, truncated: true };
}

export async function loadBingSearchPayload(
    admin: SupabaseClient,
    organizationId: string,
    clientId: string,
    span: DateSpan,
): Promise<BingSearchPayload> {
    const integration = await admin
        .from('client_integrations')
        .select('sync_status, last_synced_at, site_url:credentials->>site_url')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('service', 'bing')
        .maybeSingle();
    if (integration.error) throw new Error('Unable to read Bing history');
    const row = integration.data as { sync_status?: unknown; last_synced_at?: unknown; site_url?: unknown } | null;
    const syncStatus: 'active' | 'error' | null = row?.sync_status === 'error' ? 'error' : row?.sync_status === 'active' ? 'active' : null;
    const siteUrl = typeof row?.site_url === 'string' && row.site_url.trim() ? row.site_url.trim() : null;
    if (!syncStatus || !siteUrl) {
        return { link: null, traffic: [], queries: [], pages: [], truncated: false };
    }
    const link = {
        syncStatus,
        lastSyncedAt: typeof row?.last_synced_at === 'string' && row.last_synced_at ? row.last_synced_at : null,
    };
    const [trafficRead, queryRead, pageRead] = await Promise.all([
        readPages((from, to) => admin.from('bing_traffic_days')
            .select('data_date, clicks, impressions, queries_complete, pages_complete')
            .eq('organization_id', organizationId)
            .eq('client_id', clientId)
            .eq('site_url', siteUrl)
            .gte('data_date', span.start)
            .lte('data_date', span.end)
            .order('data_date', { ascending: true })
            .range(from, to)),
        readPages((from, to) => admin.from('bing_query_weeks')
            .select('week_ending, query, clicks, impressions, avg_impression_position, stale')
            .eq('organization_id', organizationId)
            .eq('client_id', clientId)
            .eq('site_url', siteUrl)
            .gte('week_ending', span.start)
            .lte('week_ending', span.end)
            .order('week_ending', { ascending: true })
            .range(from, to)),
        readPages((from, to) => admin.from('bing_page_weeks')
            .select('week_ending, page, clicks, impressions, avg_impression_position')
            .eq('organization_id', organizationId)
            .eq('client_id', clientId)
            .eq('site_url', siteUrl)
            .gte('week_ending', span.start)
            .lte('week_ending', span.end)
            .order('week_ending', { ascending: true })
            .range(from, to)),
    ]);
    const traffic = trafficRead.rows.flatMap(item => {
        const day = date(item.data_date);
        const clicks = num(item.clicks);
        const impressions = num(item.impressions);
        if (!day || clicks == null || impressions == null) return [];
        return [{
            date: day,
            clicks,
            impressions,
            queriesComplete: item.queries_complete === true,
            pagesComplete: item.pages_complete === true,
        }];
    });
    const queries = queryRead.rows.flatMap(item => {
        const weekEnding = date(item.week_ending);
        const query = typeof item.query === 'string' ? item.query : '';
        const clicks = num(item.clicks);
        const impressions = num(item.impressions);
        if (!weekEnding || !query || clicks == null || impressions == null) return [];
        const position = item.avg_impression_position == null ? null : num(item.avg_impression_position);
        return [{ weekEnding, query, clicks, impressions, avgImpressionPosition: position, stale: item.stale === true }];
    });
    const pages = pageRead.rows.flatMap(item => {
        const weekEnding = date(item.week_ending);
        const page = typeof item.page === 'string' ? item.page : '';
        const clicks = num(item.clicks);
        const impressions = num(item.impressions);
        if (!weekEnding || !page || clicks == null || impressions == null) return [];
        const position = item.avg_impression_position == null ? null : num(item.avg_impression_position);
        return [{ weekEnding, page, clicks, impressions, avgImpressionPosition: position }];
    });
    return {
        link,
        traffic,
        queries,
        pages,
        truncated: trafficRead.truncated || queryRead.truncated || pageRead.truncated,
    };
}
