/**
 * Browser reads for the Search dashboard. GSC uses the history and insights
 * loaders. GA4 reads ga4_daily. Bing comes from the Search API, which checks
 * the server flag and reads the stored Bing tables. The two engines stay separate.
 */

import { loadHistory, loadSearchInsights, type HistoryDay, type HistoryRow } from '@/lib/gsc/insights';
import { ptToday } from '@/lib/sync/months';
import { createClient } from '@/lib/supabase/client';
import type { BingLinkInput } from '@/lib/agency-dashboard/bing';
import {
    buildBingDashboard,
    dedupeGa4Days,
    gaPeriod,
    gaSeries,
    historyChunks,
    insightPages,
    insightQueries,
    pairedWindows,
    periodMetrics,
    propertySeries,
    readGa4DailyPayload,
    sourceConnections,
    windowChip,
    type BingDashboard,
    type BingPageWeek,
    type BingQueryWeek,
    type BingTrafficDay,
    type ChartPoint,
    type Ga4DailyRow,
    type GaPeriod,
    type InsightPageRow,
    type InsightQueryRow,
    type PairedWindow,
    type PeriodMetrics,
} from './model';

export interface BingPayload {
    enabled: boolean;
    unavailable: boolean;
    link: Pick<BingLinkInput, 'syncStatus' | 'lastSyncedAt'> | null;
    traffic: BingTrafficDay[];
    queries: BingQueryWeek[];
    pages: BingPageWeek[];
    truncated: boolean;
}

export interface DashboardData {
    gscConnected: boolean;
    gaConnected: boolean;
    window: PairedWindow | null;
    windowLabel: string;
    gscError: string;
    gscPoints: ChartPoint[];
    gscCurrent: PeriodMetrics;
    gscPrior: PeriodMetrics | null;
    queries: InsightQueryRow[];
    pages: InsightPageRow[];
    hiddenQueries: number;
    hiddenPages: number;
    tableError: string;
    gaError: string;
    gaPoints: ChartPoint[];
    gaCurrent: GaPeriod | null;
    bing: BingPayload;
    bingView: BingDashboard | null;
}

function abortError(): DOMException {
    return new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal: AbortSignal) {
    if (signal.aborted) throw abortError();
}

function disconnectedMessage(message: string): boolean {
    return /property first|select a gsc property/i.test(message);
}

async function loadIntegrationFlags(organizationId: string, clientId: string, signal: AbortSignal): Promise<{ gsc: boolean; ga: boolean; failed: boolean }> {
    const params = new URLSearchParams({ clientId, orgId: organizationId });
    const response = await fetch(`/api/integrations/status?${params}`, { signal, credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) return { gsc: false, ga: false, failed: true };
    const body = await response.json().catch(() => ({}));
    const rows = Array.isArray(body.integrations) ? body.integrations : [];
    return { ...sourceConnections(rows), failed: false };
}

async function loadChunk(clientId: string, span: { start: string; end: string }, signal: AbortSignal): Promise<{ days: HistoryDay[]; rows: HistoryRow[]; error: string }> {
    try {
        const history = await loadHistory(clientId, span, 'property', signal);
        return { days: history.days, rows: history.rows, error: '' };
    } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Unable to load Search Console.';
        return { days: [], rows: [], error: message };
    }
}

async function loadGa4Rows(organizationId: string, clientId: string, start: string, end: string): Promise<{ rows: Ga4DailyRow[]; error: string }> {
    const supabase = createClient();
    if (!supabase) return { rows: [], error: 'Google Analytics history is not available.' };
    const { data, error } = await supabase
        .from('ga4_history_days')
        .select('day, is_final, ga4_daily(organic_sessions, sessions, engaged_sessions, key_events)')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .gte('day', start)
        .lte('day', end)
        .order('day', { ascending: true });
    if (error) return { rows: [], error: 'Google Analytics history is not available.' };
    const rows: Ga4DailyRow[] = [];
    for (const row of data ?? []) {
        const parsed = readGa4DailyPayload(row);
        if (parsed) rows.push(parsed);
    }
    return { rows: dedupeGa4Days(rows), error: '' };
}

function finite(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseBingPayload(value: unknown): BingPayload {
    const off: BingPayload = { enabled: false, unavailable: false, link: null, traffic: [], queries: [], pages: [], truncated: false };
    if (!value || typeof value !== 'object') return { ...off, unavailable: true };
    const body = value as Record<string, unknown>;
    if (body.enabled !== true) return off;
    if (body.unavailable === true) return { ...off, enabled: true, unavailable: true };
    const link = body.link && typeof body.link === 'object'
        ? body.link as { syncStatus?: unknown; lastSyncedAt?: unknown }
        : null;
    const syncStatus: 'active' | 'error' | null = link?.syncStatus === 'active' ? 'active' : link?.syncStatus === 'error' ? 'error' : null;
    const parsedLink = syncStatus
        ? { syncStatus, lastSyncedAt: typeof link?.lastSyncedAt === 'string' ? link.lastSyncedAt : null }
        : null;
    const traffic: BingTrafficDay[] = [];
    if (Array.isArray(body.traffic)) {
        for (const item of body.traffic) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Record<string, unknown>;
            const date = typeof row.date === 'string' ? row.date.slice(0, 10) : '';
            const clicks = finite(row.clicks);
            const impressions = finite(row.impressions);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || clicks == null || impressions == null) continue;
            traffic.push({
                date,
                clicks,
                impressions,
                queriesComplete: row.queriesComplete === true,
                pagesComplete: row.pagesComplete === true,
            });
        }
    }
    const queries: BingQueryWeek[] = [];
    if (Array.isArray(body.queries)) {
        for (const item of body.queries) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Record<string, unknown>;
            const weekEnding = typeof row.weekEnding === 'string' ? row.weekEnding.slice(0, 10) : '';
            const query = typeof row.query === 'string' ? row.query : '';
            const clicks = finite(row.clicks);
            const impressions = finite(row.impressions);
            if (!weekEnding || !query || clicks == null || impressions == null) continue;
            const position = row.avgImpressionPosition == null ? null : finite(row.avgImpressionPosition);
            queries.push({ weekEnding, query, clicks, impressions, avgImpressionPosition: position, stale: row.stale === true });
        }
    }
    const pages: BingPageWeek[] = [];
    if (Array.isArray(body.pages)) {
        for (const item of body.pages) {
            if (!item || typeof item !== 'object') continue;
            const row = item as Record<string, unknown>;
            const weekEnding = typeof row.weekEnding === 'string' ? row.weekEnding.slice(0, 10) : '';
            const page = typeof row.page === 'string' ? row.page : '';
            const clicks = finite(row.clicks);
            const impressions = finite(row.impressions);
            if (!weekEnding || !page || clicks == null || impressions == null) continue;
            const position = row.avgImpressionPosition == null ? null : finite(row.avgImpressionPosition);
            pages.push({ weekEnding, page, clicks, impressions, avgImpressionPosition: position });
        }
    }
    return { enabled: true, unavailable: false, link: parsedLink, traffic, queries, pages, truncated: body.truncated === true };
}

async function loadBing(organizationId: string, clientId: string, start: string, end: string, signal: AbortSignal): Promise<BingPayload> {
    const params = new URLSearchParams({ clientId, orgId: organizationId, start, end });
    try {
        const response = await fetch(`/api/search/bing?${params}`, { signal, credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) return { enabled: false, unavailable: false, link: null, traffic: [], queries: [], pages: [], truncated: false };
        return parseBingPayload(await response.json().catch(() => null));
    } catch {
        if (signal.aborted) throw abortError();
        return { enabled: false, unavailable: false, link: null, traffic: [], queries: [], pages: [], truncated: false };
    }
}

export async function loadSearchDashboard(input: {
    organizationId: string;
    clientId: string;
    signal: AbortSignal;
    now?: Date;
    /** Rolling window. Omitted and any value other than 7 or 90 stays on the 28-day read. */
    windowDays?: number;
}): Promise<DashboardData> {
    const today = ptToday(input.now ?? new Date());
    const windowDays = input.windowDays === 7 || input.windowDays === 90 ? input.windowDays : 28;
    const chunks = historyChunks(today, windowDays);
    const lookback = { start: chunks[chunks.length - 1].start, end: chunks[0].end };
    const [connections, historyParts, gaResult, bing] = await Promise.all([
        loadIntegrationFlags(input.organizationId, input.clientId, input.signal),
        Promise.all(chunks.map(span => loadChunk(input.clientId, span, input.signal))),
        loadGa4Rows(input.organizationId, input.clientId, lookback.start, lookback.end),
        loadBing(input.organizationId, input.clientId, lookback.start, lookback.end, input.signal),
    ]);
    throwIfAborted(input.signal);

    const historyErrors = historyParts.map(part => part.error).filter(Boolean);
    const disconnected = historyErrors.length > 0 && historyErrors.length === chunks.length && historyErrors.every(disconnectedMessage);
    const historyFailed = historyErrors.length === chunks.length && !disconnected;
    const days = historyParts.flatMap(part => part.days);
    const propertyRows = historyParts.flatMap(part => part.rows);
    const gscConnected = !disconnected && (connections.gsc || days.length > 0) && !historyFailed;
    const gaConnected = connections.failed ? gaResult.rows.length > 0 : connections.ga;
    const gaRows = gaConnected || connections.failed ? gaResult.rows : [];
    const gscFlags = days.map(day => ({ date: day.date, isIncomplete: Boolean(day.isIncomplete) }));
    const gaFlags = gaRows.filter(row => row.isFinal).map(row => ({ date: row.date, isIncomplete: false }));
    const bingFlags = bing.traffic.map(day => ({ date: day.date, isIncomplete: false }));
    const window = (gscConnected ? pairedWindows(gscFlags, today, windowDays) : null)
        ?? (gaConnected ? pairedWindows(gaFlags, today, windowDays) : null)
        ?? (bing.enabled ? pairedWindows(bingFlags, today, windowDays) : null);

    let gscPoints: ChartPoint[] = [];
    let gscCurrent = periodMetrics([]);
    let gscPrior: PeriodMetrics | null = null;
    if (window && gscConnected) {
        gscPoints = propertySeries(days, propertyRows, window.current);
        gscCurrent = periodMetrics(gscPoints);
        gscPrior = window.comparable ? periodMetrics(propertySeries(days, propertyRows, window.prior)) : null;
    }

    let queries: InsightQueryRow[] = [];
    let pages: InsightPageRow[] = [];
    let hiddenQueries = 0;
    let hiddenPages = 0;
    let tableError = '';
    if (window && gscConnected) {
        try {
            const insights = await loadSearchInsights(input.clientId, window.current, input.signal);
            const queryTable = insightQueries(insights.queryPageRollups);
            const pageTable = insightPages(insights.pageRollups);
            queries = queryTable.rows;
            pages = pageTable.rows;
            hiddenQueries = queryTable.hidden;
            hiddenPages = pageTable.hidden;
        } catch (reason) {
            if (input.signal.aborted) throw abortError();
            tableError = reason instanceof Error ? reason.message : 'Unable to load Search Insights.';
        }
    }

    let gaPoints: ChartPoint[] = [];
    let gaCurrent: GaPeriod | null = null;
    if (window && gaConnected) {
        gaPoints = gaSeries(gaRows, window.current);
        gaCurrent = gaPeriod(gaRows, window.current);
    }

    const bingView = bing.enabled
        ? buildBingDashboard({
            unavailable: bing.unavailable,
            link: bing.link,
            traffic: bing.traffic,
            queries: bing.queries,
            pages: bing.pages,
            window,
            listTruncated: bing.truncated,
        })
        : null;

    return {
        gscConnected,
        gaConnected,
        window,
        windowLabel: windowChip(window, windowDays),
        gscError: historyFailed ? historyErrors[0] ?? 'Unable to load Search Console.' : '',
        gscPoints,
        gscCurrent,
        gscPrior,
        queries,
        pages,
        hiddenQueries,
        hiddenPages,
        tableError,
        gaError: gaConnected ? gaResult.error : '',
        gaPoints,
        gaCurrent,
        bing,
        bingView,
    };
}
