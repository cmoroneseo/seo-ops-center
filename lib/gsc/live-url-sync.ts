import { normalizeResultUrl, resultUrlPattern } from '@/lib/search-reporting/result-url';
import {
    liveUrlCoverage,
    TOP_RESULT_QUERIES,
    type LiveUrlWindows,
    type UrlMetricRow,
    type UrlQueryRow,
} from '@/lib/search-reporting/url-results';

export const LIVE_URL_REFRESH_LIMIT = 20;
export const LIVE_URL_STALE_MS = 20 * 60 * 60 * 1000;

export interface LiveUrlCheck {
    urlKey: string;
    goLive: string;
    fetchedAt: string;
}

export interface LiveUrlCandidate {
    urlKey: string;
    url: string;
    goLive: string;
}

interface MetricRow {
    keys?: unknown;
    clicks?: unknown;
    impressions?: unknown;
    position?: unknown;
}

function metricValues(row: MetricRow) {
    const clicks = row.clicks;
    const impressions = row.impressions;
    const position = row.position;
    if (![clicks, impressions, position].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) || !Number.isInteger(clicks) || !Number.isInteger(impressions)) {
        throw new Error('Invalid GSC history metrics');
    }
    return { clicks: clicks as number, impressions: impressions as number, position: position as number };
}

function dimensionKeys(row: MetricRow, dimensions: string[]) {
    const keys = row.keys ?? [];
    if (!Array.isArray(keys) || keys.length !== dimensions.length || !keys.every(key => typeof key === 'string' && key.length > 0)) {
        throw new Error('Invalid GSC history dimensions');
    }
    return keys as string[];
}

/** Oldest snapshots first, and a URL whose ship date moved ahead of a fresh snapshot. */
export function selectLiveUrlsToRefresh(input: {
    subjects: readonly { url: string; goLive: string }[];
    checks: readonly LiveUrlCheck[];
    now: number;
    limit?: number;
    staleMs?: number;
}): LiveUrlCandidate[] {
    const limit = input.limit ?? LIVE_URL_REFRESH_LIMIT;
    const staleMs = input.staleMs ?? LIVE_URL_STALE_MS;
    const grouped = new Map<string, LiveUrlCandidate>();
    for (const subject of input.subjects) {
        const urlKey = normalizeResultUrl(subject.url);
        if (!urlKey || !/^\d{4}-\d{2}-\d{2}$/.test(subject.goLive)) continue;
        const current = grouped.get(urlKey);
        if (!current || subject.goLive < current.goLive) {
            grouped.set(urlKey, { urlKey, url: subject.url.trim(), goLive: subject.goLive });
        }
    }
    const checks = new Map(input.checks.map(check => [check.urlKey, check]));
    const stale = [...grouped.values()].flatMap(candidate => {
        const check = checks.get(candidate.urlKey);
        if (!check) return [{ candidate, fetchedAt: '' }];
        const fetchedAt = Date.parse(check.fetchedAt);
        const fresh = Number.isFinite(fetchedAt) && input.now - fetchedAt < staleMs && check.goLive === candidate.goLive;
        return fresh ? [] : [{ candidate, fetchedAt: check.fetchedAt }];
    });
    stale.sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt) || a.candidate.urlKey.localeCompare(b.candidate.urlKey));
    return stale.slice(0, limit).map(item => item.candidate);
}

async function gscQuery(
    property: string,
    token: string,
    body: Record<string, unknown>,
    request: typeof fetch,
    signal?: AbortSignal,
) {
    const response = await request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    if (!response.ok) {
        if (response.status === 429) throw new Error('GSC history request failed (HTTP 429, quota)');
        throw new Error(`GSC history request failed (HTTP ${response.status})`);
    }
    return response.json() as Promise<{ rows?: unknown }>;
}

async function loadRows(
    property: string,
    token: string,
    body: Record<string, unknown>,
    dimensions: string[],
    request: typeof fetch,
    signal: AbortSignal | undefined,
    rowLimit: number,
) {
    const rows: MetricRow[] = [];
    for (let page = 0; page < 3; page += 1) {
        const payload = await gscQuery(property, token, { ...body, rowLimit, startRow: page * rowLimit }, request, signal);
        const batch = payload.rows ?? [];
        if (!Array.isArray(batch) || batch.length > rowLimit) throw new Error('Invalid GSC history response');
        for (const candidate of batch) {
            if (!candidate || typeof candidate !== 'object') throw new Error('Invalid GSC history metrics');
            const row = candidate as MetricRow;
            dimensionKeys(row, dimensions);
            metricValues(row);
            rows.push(row);
        }
        if (batch.length < rowLimit) return rows;
    }
    return rows;
}

function addMetric(
    bucket: Map<string, { clicks: number; impressions: number; weighted: number }>,
    key: string,
    metrics: { clicks: number; impressions: number; position: number },
) {
    const current = bucket.get(key) ?? { clicks: 0, impressions: 0, weighted: 0 };
    current.clicks += metrics.clicks;
    current.impressions += metrics.impressions;
    current.weighted += metrics.position * metrics.impressions;
    bucket.set(key, current);
}

/**
 * Page totals by day, plus the top queries, for one live URL.
 * Search Analytics is filtered to that page. Rows for a different page are dropped.
 */
export async function fetchLiveUrlPerformance(
    property: string,
    token: string,
    url: string,
    span: { start: string; end: string },
    querySpan: { start: string; end: string },
    options: { fetch?: typeof fetch; signal?: AbortSignal; rowLimit?: number } = {},
): Promise<{ rows: UrlMetricRow[]; queries: UrlQueryRow[] }> {
    const urlKey = normalizeResultUrl(url);
    const pattern = resultUrlPattern(url);
    if (!urlKey || !pattern) throw new Error('Invalid live URL');
    if (span.start > span.end || querySpan.start > querySpan.end) throw new Error('Invalid live URL window');
    const request = options.fetch ?? fetch;
    const rowLimit = options.rowLimit ?? 1000;
    const filter = {
        groupType: 'and',
        filters: [{ dimension: 'page', operator: 'includingRegex', expression: pattern }],
    };
    const pageRows = await loadRows(property, token, {
        startDate: span.start,
        endDate: span.end,
        type: 'web',
        dataState: 'all',
        aggregationType: 'byPage',
        dimensions: ['date', 'page'],
        dimensionFilterGroups: [filter],
    }, ['date', 'page'], request, options.signal, rowLimit);
    const queryRows = await loadRows(property, token, {
        startDate: querySpan.start,
        endDate: querySpan.end,
        type: 'web',
        dataState: 'all',
        aggregationType: 'byPage',
        dimensions: ['query', 'page'],
        dimensionFilterGroups: [filter],
    }, ['query', 'page'], request, options.signal, Math.min(rowLimit, 250));

    const days = new Map<string, { clicks: number; impressions: number; weighted: number }>();
    for (const row of pageRows) {
        const [date, page] = dimensionKeys(row, ['date', 'page']);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || normalizeResultUrl(page) !== urlKey) continue;
        addMetric(days, date, metricValues(row));
    }
    const queries = new Map<string, { clicks: number; impressions: number; weighted: number }>();
    for (const row of queryRows) {
        const [query, page] = dimensionKeys(row, ['query', 'page']);
        if (normalizeResultUrl(page) !== urlKey) continue;
        addMetric(queries, query, metricValues(row));
    }
    return {
        rows: [...days.entries()]
            .map(([date, totals]) => ({
                date,
                clicks: totals.clicks,
                impressions: totals.impressions,
                position: totals.impressions > 0 ? totals.weighted / totals.impressions : 0,
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        queries: [...queries.entries()]
            .map(([query, totals]) => ({
                query,
                clicks: totals.clicks,
                impressions: totals.impressions,
                position: totals.impressions > 0 ? totals.weighted / totals.impressions : 0,
            }))
            .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.query.localeCompare(b.query))
            .slice(0, TOP_RESULT_QUERIES),
    };
}

/** One pass of the daily sync. A failed URL is skipped and retried next run. */
export async function refreshLiveUrlBatch(input: {
    subjects: readonly { url: string; goLive: string }[];
    checks: readonly LiveUrlCheck[];
    now: Date;
    today: string;
    limit?: number;
    budgetMs?: number;
    fetchUrl: (candidate: LiveUrlCandidate, windows: LiveUrlWindows) => Promise<{ rows: UrlMetricRow[]; queries: UrlQueryRow[] }>;
    save: (
        candidate: LiveUrlCandidate,
        windows: LiveUrlWindows,
        fetched: { rows: UrlMetricRow[]; queries: UrlQueryRow[] },
        fetchedAt: string,
    ) => Promise<void>;
}): Promise<{ refreshed: number }> {
    const started = Date.now();
    const budgetMs = input.budgetMs ?? 30_000;
    const selected = selectLiveUrlsToRefresh({
        subjects: input.subjects,
        checks: input.checks,
        now: input.now.getTime(),
        limit: input.limit,
    });
    let refreshed = 0;
    for (const candidate of selected) {
        if (Date.now() - started > budgetMs) break;
        const windows = liveUrlCoverage(candidate.goLive, input.today);
        if (!windows) continue;
        try {
            const fetched = await input.fetchUrl(candidate, windows);
            await input.save(candidate, windows, fetched, input.now.toISOString());
            refreshed += 1;
        } catch {
            // The next daily sync retries this URL. A failure is not an empty result.
        }
    }
    return { refreshed };
}
