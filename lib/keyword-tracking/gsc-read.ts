/**
 * Search Console metrics for tracked keywords.
 *
 * Ground truth is gsc_history_facts at the query_page grain (all devices and
 * countries — the v1 GSC target). Clicks, impressions, and average position
 * are impression-weighted across pages in the window, same rounding as
 * sumMetrics. The best URL is the lowest impression-weighted position after
 * normalizeUrl, not the page with the most impressions.
 *
 * A window with no impressions is "not measurable". That covers a keyword
 * Search Console never returned and a keyword whose rows sum to zero
 * impressions. Neither case is reported as 0.
 */

import { chunkList, HEAVY_DAY_CHUNK } from '../search-reporting/fact-read';
import type { SearchQuery, SearchReportingAdmin } from '../search-reporting/load';
import { sumMetrics } from '../search-reporting/metrics';
import { normalizeTrackerQuery } from '../search-reporting/tracker';
import { createClient } from '../supabase/client';
import { normalizeUrl } from '../url/normalize-url';
import { keywordTrackingEnabled } from './flag';

/** Copy for a window that cannot be measured. Never a stand-in for zero. */
export const GSC_NOT_MEASURABLE = 'not measurable';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 1000;
const MAX_PAGES = 25;

export interface GscReadWindow {
    start: string;
    end: string;
}

export interface GscQueryPageFact {
    date: string;
    query: string;
    page: string;
    clicks: number;
    impressions: number;
    position: number;
    /** Other grains are ignored. Omitted rows are treated as query_page. */
    grain?: string;
}

export interface MeasuredKeywordWindow {
    status: 'measured';
    clicks: number;
    impressions: number;
    avgPosition: number;
    /** Normalized absolute URL, or null when no page survived normalizeUrl. */
    bestUrl: string | null;
}

export interface UnmeasuredKeywordWindow {
    status: typeof GSC_NOT_MEASURABLE;
    clicks: null;
    impressions: null;
    avgPosition: null;
    bestUrl: null;
}

export type KeywordGscWindow = MeasuredKeywordWindow | UnmeasuredKeywordWindow;

export interface TrackedKeywordGscRow {
    id: string;
    keyword: string;
    normalizedKey: string;
    current: KeywordGscWindow;
    compare: KeywordGscWindow;
}

export type KeywordGscLoadResult =
    | { enabled: false }
    | { enabled: true; ok: false; error: string }
    | {
        enabled: true;
        ok: true;
        /**
         * True when a GSC property is connected. False when it is not.
         * Null when no keyword needed a read, so the property was not checked.
         */
        connected: boolean | null;
        rows: TrackedKeywordGscRow[];
    };

export interface TrackedKeywordRef {
    id: string;
    keyword: string;
}

function unmeasured(): UnmeasuredKeywordWindow {
    return {
        status: GSC_NOT_MEASURABLE,
        clicks: null,
        impressions: null,
        avgPosition: null,
        bestUrl: null,
    };
}

export function validGscWindow(window: GscReadWindow): boolean {
    return ISO_DATE.test(window.start) && ISO_DATE.test(window.end) && window.start <= window.end;
}

function finiteMetric(value: number): boolean {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function usableFact(fact: GscQueryPageFact): boolean {
    return ISO_DATE.test(fact.date)
        && finiteMetric(fact.clicks)
        && finiteMetric(fact.impressions)
        && finiteMetric(fact.position);
}

function inWindow(date: string, window: GscReadWindow): boolean {
    return date >= window.start && date <= window.end;
}

function factsFor(facts: readonly GscQueryPageFact[], normalizedKey: string, window: GscReadWindow): GscQueryPageFact[] {
    if (!normalizedKey) return [];
    return facts.filter(fact => {
        if (fact.grain != null && fact.grain !== 'query_page') return false;
        if (!usableFact(fact) || !inWindow(fact.date, window)) return false;
        return normalizeTrackerQuery(fact.query) === normalizedKey;
    });
}

function bestNormalizedUrl(rows: readonly GscQueryPageFact[]): string | null {
    const pages = new Map<string, GscQueryPageFact[]>();
    for (const row of rows) {
        const normalized = normalizeUrl(row.page);
        if (!normalized || row.impressions <= 0) continue;
        const list = pages.get(normalized.url);
        if (list) list.push(row);
        else pages.set(normalized.url, [row]);
    }
    let bestUrl: string | null = null;
    let bestPosition = Number.POSITIVE_INFINITY;
    let bestImpressions = -1;
    for (const [url, group] of pages) {
        const impressions = group.reduce((sum, row) => sum + row.impressions, 0);
        if (impressions <= 0) continue;
        const position = group.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions;
        const lowerPosition = position < bestPosition;
        const samePosition = position === bestPosition;
        const better = lowerPosition
            || (samePosition && impressions > bestImpressions)
            || (samePosition && impressions === bestImpressions && (bestUrl == null || url < bestUrl));
        if (!better) continue;
        bestUrl = url;
        bestPosition = position;
        bestImpressions = impressions;
    }
    return bestUrl;
}

function measureWindow(rows: readonly GscQueryPageFact[]): KeywordGscWindow {
    const totals = sumMetrics([...rows]);
    if (totals.impressions <= 0 || totals.position == null) return unmeasured();
    return {
        status: 'measured',
        clicks: totals.clicks,
        impressions: totals.impressions,
        avgPosition: totals.position,
        bestUrl: bestNormalizedUrl(rows),
    };
}

export function readTrackedKeywordGsc(input: {
    keywords: readonly TrackedKeywordRef[];
    facts: readonly GscQueryPageFact[];
    current: GscReadWindow;
    compare: GscReadWindow;
}): TrackedKeywordGscRow[] {
    if (!validGscWindow(input.current) || !validGscWindow(input.compare)) {
        throw new Error('Invalid date window');
    }
    return input.keywords.map(keyword => {
        const normalizedKey = normalizeTrackerQuery(keyword.keyword);
        return {
            id: keyword.id,
            keyword: keyword.keyword,
            normalizedKey,
            current: measureWindow(factsFor(input.facts, normalizedKey, input.current)),
            compare: measureWindow(factsFor(input.facts, normalizedKey, input.compare)),
        };
    });
}

function countOf(value: unknown): number | null {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
            ? Number(value)
            : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function isoDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const date = value.slice(0, 10);
    return ISO_DATE.test(date) ? date : null;
}

function siteUrlOf(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const siteUrl = (value as { site_url?: unknown }).site_url;
    if (typeof siteUrl !== 'string') return null;
    const trimmed = siteUrl.trim();
    return trimmed.length > 0 ? trimmed : null;
}

async function readPages(build: () => SearchQuery): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const from = page * PAGE_SIZE;
        const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error('Unable to read Search Console history');
        const batch = Array.isArray(data) ? data as Record<string, unknown>[] : null;
        if (!batch) throw new Error('Unable to read Search Console history');
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) return rows;
    }
    throw new Error('Unable to read Search Console history');
}

function queryKeys(keywords: readonly TrackedKeywordRef[]): string[] {
    const keys = new Set<string>();
    for (const keyword of keywords) {
        const normalized = normalizeTrackerQuery(keyword.keyword);
        if (!normalized) continue;
        keys.add(normalized);
        const raw = keyword.keyword.trim().replace(/\s+/g, ' ');
        if (raw) keys.add(raw);
    }
    return [...keys];
}

function emptyResult(rows: TrackedKeywordGscRow[]): KeywordGscLoadResult {
    return { enabled: true, ok: true, connected: null, rows };
}

export async function loadTrackedKeywordGsc(input: {
    organizationId: string;
    clientId: string;
    keywords: readonly TrackedKeywordRef[];
    current: GscReadWindow;
    compare: GscReadWindow;
    /** Injected in tests. Omitted uses the signed-in browser client. */
    client?: SearchReportingAdmin | null;
}): Promise<KeywordGscLoadResult> {
    if (!keywordTrackingEnabled()) return { enabled: false };
    if (!validGscWindow(input.current) || !validGscWindow(input.compare)) {
        return { enabled: true, ok: false, error: 'Invalid date window.' };
    }
    const blank = readTrackedKeywordGsc({
        keywords: input.keywords,
        facts: [],
        current: input.current,
        compare: input.compare,
    });
    const queries = queryKeys(input.keywords);
    if (queries.length === 0) return emptyResult(blank);

    const admin = input.client === undefined
        ? createClient() as unknown as SearchReportingAdmin | undefined
        : input.client;
    if (!admin) return { enabled: true, ok: false, error: 'Keyword tracking is unavailable.' };

    try {
        const integration = await admin.from('client_integrations')
            .select('site_url:credentials->>site_url')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('service', 'gsc')
            .maybeSingle();
        if (integration.error) throw new Error('Unable to read Search Console history');
        const property = siteUrlOf(integration.data);
        if (!property) return { enabled: true, ok: true, connected: false, rows: blank };

        const spanStart = input.current.start < input.compare.start ? input.current.start : input.compare.start;
        const spanEnd = input.current.end > input.compare.end ? input.current.end : input.compare.end;
        const dayRows = await readPages(() => admin.from('gsc_history_days')
            .select('id, data_date')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .gte('data_date', spanStart)
            .lte('data_date', spanEnd)
            .order('data_date', { ascending: true }));
        const dayDates = new Map<string, string>();
        for (const row of dayRows) {
            const id = typeof row.id === 'string' ? row.id : '';
            const date = isoDate(row.data_date);
            if (!id || !date) continue;
            if (!inWindow(date, input.current) && !inWindow(date, input.compare)) continue;
            dayDates.set(id, date);
        }
        const facts: GscQueryPageFact[] = [];
        if (dayDates.size > 0) {
            const dayIds = [...dayDates.keys()];
            for (const chunk of chunkList(dayIds, HEAVY_DAY_CHUNK)) {
                const rows = await readPages(() => admin.from('gsc_history_facts')
                    .select('day_id, grain, query, page, clicks, impressions, position')
                    .eq('grain', 'query_page')
                    .in('day_id', chunk)
                    .in('query', queries)
                    .order('day_id', { ascending: true })
                    .order('id', { ascending: true }));
                for (const row of rows) {
                    const date = typeof row.day_id === 'string' ? dayDates.get(row.day_id) : undefined;
                    const clicks = countOf(row.clicks);
                    const impressions = countOf(row.impressions);
                    const position = countOf(row.position);
                    if (!date || clicks == null || impressions == null || position == null) continue;
                    if (row.grain != null && row.grain !== 'query_page') continue;
                    facts.push({
                        date,
                        query: typeof row.query === 'string' ? row.query : '',
                        page: typeof row.page === 'string' ? row.page : '',
                        clicks,
                        impressions,
                        position,
                        grain: 'query_page',
                    });
                }
            }
        }
        return {
            enabled: true,
            ok: true,
            connected: true,
            rows: readTrackedKeywordGsc({
                keywords: input.keywords,
                facts,
                current: input.current,
                compare: input.compare,
            }),
        };
    } catch {
        console.error('Could not read Search Console history for tracked keywords.');
        return { enabled: true, ok: false, error: 'Could not read Search Console history for tracked keywords.' };
    }
}
