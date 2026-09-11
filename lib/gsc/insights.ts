import { dateOffset, historyWindow } from './history';

export interface HistoryDay { id: string; date: string; importedAt: string; pageLimited: boolean; queryLimited: boolean }
export interface HistoryRow { id: number; dayId: string; page: string; query: string; clicks: number; impressions: number; position: number }
export interface HistoryResponse {
    property: string; start: string; end: string; grain: string; days: HistoryDay[];
    missingDates: string[]; rows: HistoryRow[]; nextOffset: number | null; coverageNote: string;
}
export interface Candidate { query: string; page: string; clicks: number; impressions: number; position: number; ctr: number; observedDays: number }
export interface PageCandidate { page: string; clicks: number; impressions: number; position: number; ctr: number; observedDays: number }
export interface OverlapCandidate { query: string; clicks: number; impressions: number; position: number; ctr: number; observedDays: number; pages: Candidate[] }
export interface SearchInsightsResponse {
    property: string; start: string; end: string; days: HistoryDay[]; missingDates: string[];
    propertyRows: HistoryRow[]; queryPageRollups: Candidate[]; pageRollups: PageCandidate[];
    visibilityRollups: Candidate[]; overlapRollups: OverlapCandidate[]; expandedEvidenceAvailable: boolean; coverageNote: string;
}
export type SearchInsightsAggregate = Pick<SearchInsightsResponse, 'days' | 'propertyRows' | 'queryPageRollups' | 'pageRollups' | 'visibilityRollups' | 'overlapRollups' | 'expandedEvidenceAvailable'>;

export function parseSearchInsightsAggregate(value: unknown): SearchInsightsAggregate {
    if (!value || typeof value !== 'object') throw new Error('Invalid Search Insights aggregate');
    const aggregate = value as Record<string, unknown>;
    if (!Array.isArray(aggregate.days) || !Array.isArray(aggregate.propertyRows) || !Array.isArray(aggregate.queryPageRollups)) throw new Error('Invalid Search Insights aggregate');
    const expandedArrays = [aggregate.pageRollups, aggregate.visibilityRollups, aggregate.overlapRollups];
    const expandedCount = expandedArrays.filter(Array.isArray).length;
    if (expandedCount !== 0 && expandedCount !== expandedArrays.length) throw new Error('Invalid Search Insights aggregate');
    const normalized = {
        ...aggregate,
        pageRollups: Array.isArray(aggregate.pageRollups) ? aggregate.pageRollups : [],
        visibilityRollups: Array.isArray(aggregate.visibilityRollups) ? aggregate.visibilityRollups : [],
        overlapRollups: Array.isArray(aggregate.overlapRollups) ? aggregate.overlapRollups : [],
        expandedEvidenceAvailable: expandedCount === expandedArrays.length,
    };
    const finite = (number: unknown) => typeof number === 'number' && Number.isFinite(number) && number >= 0;
    const integer = (number: unknown) => finite(number) && Number.isInteger(number);
    const text = (item: Record<string, unknown>, key: string) => typeof item[key] === 'string' && item[key].length > 0;
    const validDays = aggregate.days.every(value => {
        if (!value || typeof value !== 'object') return false;
        const day = value as Record<string, unknown>;
        return text(day, 'id') && text(day, 'date') && text(day, 'importedAt') && typeof day.pageLimited === 'boolean' && typeof day.queryLimited === 'boolean';
    });
    const validPropertyRows = aggregate.propertyRows.every(value => {
        if (!value || typeof value !== 'object') return false;
        const row = value as Record<string, unknown>;
        return integer(row.id) && text(row, 'dayId') && typeof row.page === 'string' && typeof row.query === 'string' && integer(row.clicks) && integer(row.impressions) && finite(row.position);
    });
    const validCandidate = (value: unknown) => {
        if (!value || typeof value !== 'object') return false;
        const row = value as Record<string, unknown>;
        return text(row, 'query') && text(row, 'page') && integer(row.clicks) && integer(row.impressions) && finite(row.position) && finite(row.ctr) && integer(row.observedDays);
    };
    const validPage = (value: unknown) => {
        if (!value || typeof value !== 'object') return false;
        const row = value as Record<string, unknown>;
        return text(row, 'page') && integer(row.clicks) && integer(row.impressions) && finite(row.position) && finite(row.ctr) && integer(row.observedDays);
    };
    const validOverlap = (value: unknown) => {
        if (!value || typeof value !== 'object') return false;
        const row = value as Record<string, unknown>;
        return text(row, 'query') && integer(row.clicks) && integer(row.impressions) && finite(row.position) && finite(row.ctr) && integer(row.observedDays) && Array.isArray(row.pages) && row.pages.every(validCandidate);
    };
    const validRollups = aggregate.queryPageRollups.every(validCandidate) && normalized.pageRollups.every(validPage) && normalized.visibilityRollups.every(validCandidate) && normalized.overlapRollups.every(validOverlap);
    if (!validDays || !validPropertyRows || !validRollups) throw new Error('Invalid Search Insights aggregate');
    return normalized as unknown as SearchInsightsAggregate;
}

export async function loadSearchInsights(clientId: string, range: {start: string; end: string}, signal: AbortSignal, request: typeof fetch = fetch): Promise<SearchInsightsResponse> {
    const params = new URLSearchParams({ clientId, ...range });
    const response = await request(`/api/integrations/google/gsc/insights?${params}`, { signal, cache: 'no-store' });
    if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Your session has expired. Sign in again to view Search Insights.');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to load Search Insights. Try again.');
    return payload as SearchInsightsResponse;
}

export function filterRankingCandidates(rows: Candidate[], brand: string): Candidate[] {
    return rows.filter(row => !isExcludedCandidate(row.query, row.page, brand))
        .sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query) || a.page.localeCompare(b.page));
}

export function filterPageCandidates(rows: PageCandidate[]): PageCandidate[] {
    return rows.filter(row => !isExcludedPage(row.page))
        .sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page));
}

export function filterVisibilityCandidates(rows: Candidate[], brand: string): Candidate[] {
    return filterRankingCandidates(rows, brand);
}

export function filterOverlapCandidates(rows: OverlapCandidate[], brand: string): OverlapCandidate[] {
    return rows.flatMap(row => {
        if (isBrandQuery(row.query, brand)) return [];
        const pages = row.pages.filter(page => !isExcludedPage(page.page))
            .sort((a, b) => b.impressions - a.impressions || a.page.localeCompare(b.page));
        const impressions = pages.reduce((sum, page) => sum + page.impressions, 0);
        if (pages.length < 2 || impressions < 100) return [];
        const clicks = pages.reduce((sum, page) => sum + page.clicks, 0);
        const position = pages.reduce((sum, page) => sum + page.position * page.impressions, 0) / impressions;
        const observedDays = Math.max(...pages.map(page => page.observedDays));
        return [{ ...row, pages, clicks, impressions, position, ctr: clicks / impressions, observedDays }];
    }).sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
}

function isExcludedCandidate(query: string, page: string, brand: string) {
    if (isExcludedPage(page)) return true;
    return isBrandQuery(query, brand);
}

function isExcludedPage(page: string) {
    const safe = safePageUrl(page);
    if (!safe) return true;
    const path = new URL(safe).pathname;
    return /(?:^|\/)(?:terms(?:[-/]|$)|privacy(?:[-/]|$)|author(?:\/|$)|tag(?:\/|$)|wp-admin(?:\/|$)|login(?:\/|$))/.test(path.toLowerCase());
}

function isBrandQuery(query: string, brand: string) {
    const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const normalizedBrand = normalize(brand);
    return !!normalizedBrand && normalize(query).includes(normalizedBrand);
}

export function insightsRange(days: 7 | 28, now = new Date()) {
    const { end } = historyWindow(now);
    return { start: dateOffset(end, 1 - days), end };
}
export function evidenceIsComplete(days: HistoryDay[], missingDates: string[], grain: 'page' | 'query') {
    return missingDates.length === 0 && !days.some(day => grain === 'page' ? day.pageLimited : day.queryLimited);
}
export function summarizePerformance(rows: HistoryRow[]) {
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    return { clicks, impressions, ctr: impressions ? clicks / impressions : null,
        position: impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : null };
}
export function safePageUrl(value: string): string | undefined {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; }
    catch { return undefined; }
}

// These thresholds identify candidates for investigation, not predicted ranking gains.
export function rankingCandidates(rows: HistoryRow[], brand: string): Candidate[] {
    const groups = new Map<string, HistoryRow[]>();
    for (const row of rows) {
        if (isExcludedCandidate(row.query, row.page, brand)) continue;
        const key = JSON.stringify([row.query, row.page]);
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.values()].flatMap(group => {
        const metrics = summarizePerformance(group);
        const observedDays = new Set(group.map(row => row.dayId)).size;
        if (metrics.impressions < 100 || observedDays < 3 || metrics.position === null || metrics.position < 4 || metrics.position > 20) return [];
        return [{ query: group[0].query, page: group[0].page, ...metrics, position: metrics.position, ctr: metrics.ctr ?? 0, observedDays }];
    }).sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query) || a.page.localeCompare(b.page));
}

export async function loadHistory(clientId: string, range: {start: string; end: string}, grain: 'property' | 'query_page', signal: AbortSignal, request: typeof fetch = fetch) {
    let result: HistoryResponse | undefined;
    let offset = 0;
    const seen = new Set<number>();
    // Keep browser work bounded; partial query data is explicitly ineligible for recommendations.
    for (let batch = 0; batch < 40; batch++) {
        const params = new URLSearchParams({ clientId, ...range, grain, offset: String(offset) });
        if (result) params.set('property', result.property);
        const response = await request(`/api/integrations/google/gsc/history?${params}`, { signal, cache: 'no-store' });
        if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Your session has expired. Sign in again to view Search Insights.');
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load Search Insights. Try again.');
        const page = payload as HistoryResponse;
        if (result && (result.property !== page.property || JSON.stringify(result.days) !== JSON.stringify(page.days))) throw new Error('History changed while loading. Refresh to get a consistent view.');
        for (const row of page.rows) {
            if (seen.has(row.id)) throw new Error('History changed while loading. Refresh to get a consistent view.');
            seen.add(row.id);
        }
        result = result ? { ...page, rows: [...result.rows, ...page.rows] } : page;
        if (page.nextOffset === null) return { ...result, truncated: false };
        if (page.nextOffset <= offset) throw new Error('Unable to load the next history page. Try again.');
        offset = page.nextOffset;
    }
    return { ...result!, truncated: true };
}
