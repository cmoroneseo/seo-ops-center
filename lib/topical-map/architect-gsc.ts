/**
 * Query context for topical-map generation.
 * Reads the query_page grain of gsc_history_facts. The retired
 * gsc_search_performance table is not a source.
 */

import { readGrainedFacts } from '../search-reporting/fact-read';
import type { SearchReportingAdmin } from '../search-reporting/load';
import { normalizeUrl } from '../url/normalize-url';
import { intentKey } from './page-match';
import {
    aggregatePagePerformance,
    EMPTY_PERFORMANCE,
    PERIOD_DAYS,
    type PerformanceRead,
    type QueryOnPage,
} from './page-performance';

export interface ArchitectGscQuery {
    query: string;
    clicks: number;
    impressions: number;
    position: number;
    page: string;
}

interface QueryPageFact {
    query: string;
    page: string;
    clicks: number;
    impressions: number;
    position: number;
}

/** One search intent: queries that share intentKey, rolled up. */
export interface ArchitectGscCluster {
    /** The query in the group with the most impressions. */
    query: string;
    clicks: number;
    impressions: number;
    /** Impression-weighted. */
    position: number;
    /** Other wordings of the same search, most impressions first (at most CLUSTER_VARIANTS). */
    variants: string[];
    /** clusterKey(query): the join key for demand checks. */
    key: string;
}

/** Recent stored days, matching the site-inventory GSC seed window. */
const DAY_WINDOW = 28;
const QUERY_LIMIT = 50;
/** Stored days read for the grouped searches the generator sees. */
export const CLUSTER_DAY_WINDOW = 90;
const CLUSTER_VARIANTS = 3;

function finiteNumber(value: unknown): number | null {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
            ? Number(value)
            : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function factFromRow(row: Record<string, unknown>): QueryPageFact | null {
    const query = typeof row.query === 'string' ? row.query.trim() : '';
    const clicks = finiteNumber(row.clicks);
    const impressions = finiteNumber(row.impressions);
    const position = finiteNumber(row.position);
    if (!query || clicks == null || impressions == null || position == null) return null;
    return {
        query,
        page: typeof row.page === 'string' ? row.page : '',
        clicks,
        impressions,
        position,
    };
}

/**
 * Roll daily query_page rows into one row per query.
 * Position is impression-weighted. The page is the URL with the most impressions.
 */
export function aggregateQueryPageFacts(rows: readonly Record<string, unknown>[]): ArchitectGscQuery[] {
    return rollUpQueries(rows).slice(0, QUERY_LIMIT);
}

/** Words that say how the service is bought, not which service. "business" stays: it means commercial. */
const SERVICE_FORM_TOKENS: ReadonlySet<string> = new Set([
    'install', 'installation', 'installer', 'installing', 'installed', 'service', 'company', 'contractor',
    'professional', 'pro', 'expert', 'specialist',
].flatMap(word => intentKey(word).split(' ')));

/**
 * The key searches are grouped by: intentKey without the service-form words,
 * so "artificial turf temecula" and "artificial turf installation in temecula,
 * ca" are one group, while pavers, masonry, pet or commercial turf stay
 * separate. intentKey itself (the duplicate-search key) is unchanged.
 */
export function clusterKey(query: string | null | undefined, ignore: ReadonlySet<string> = new Set()): string {
    const key = intentKey(query, ignore);
    const kept = key.split(' ').filter(token => !SERVICE_FORM_TOKENS.has(token));
    return kept.length > 0 ? kept.join(' ') : key;
}

/**
 * Group every query by search intent (clusterKey, so word order, plurals,
 * turf/grass, "near me" and "installation" do not split a search), most
 * impressions first. Uncapped: the prompt shows the top groups, the page-mix
 * check uses all.
 */
export function clusterQueryFacts(
    rows: readonly Record<string, unknown>[],
    ignore: ReadonlySet<string> = new Set(),
): ArchitectGscCluster[] {
    const groups = new Map<string, ArchitectGscQuery[]>();
    for (const query of rollUpQueries(rows)) {
        const key = clusterKey(query.query, ignore);
        if (!key) continue;
        const list = groups.get(key) ?? [];
        list.push(query);
        groups.set(key, list);
    }
    const clusters: ArchitectGscCluster[] = [];
    for (const [key, list] of groups) {
        list.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query));
        const impressions = list.reduce((sum, q) => sum + q.impressions, 0);
        if (impressions <= 0) continue;
        clusters.push({
            query: list[0].query,
            clicks: list.reduce((sum, q) => sum + q.clicks, 0),
            impressions,
            position: list.reduce((sum, q) => sum + q.position * q.impressions, 0) / impressions,
            variants: list.slice(1, CLUSTER_VARIANTS + 1).map(q => q.query),
            key,
        });
    }
    return clusters.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query));
}

function rollUpQueries(rows: readonly Record<string, unknown>[]): ArchitectGscQuery[] {
    const grouped = new Map<string, {
        clicks: number;
        impressions: number;
        weightedPosition: number;
        pages: Map<string, { clicks: number; impressions: number }>;
    }>();

    for (const row of rows) {
        const fact = factFromRow(row);
        if (!fact) continue;
        const current = grouped.get(fact.query) ?? {
            clicks: 0,
            impressions: 0,
            weightedPosition: 0,
            pages: new Map<string, { clicks: number; impressions: number }>(),
        };
        current.clicks += fact.clicks;
        current.impressions += fact.impressions;
        current.weightedPosition += fact.position * fact.impressions;
        const page = current.pages.get(fact.page) ?? { clicks: 0, impressions: 0 };
        page.clicks += fact.clicks;
        page.impressions += fact.impressions;
        current.pages.set(fact.page, page);
        grouped.set(fact.query, current);
    }

    const queries: ArchitectGscQuery[] = [];
    for (const [query, totals] of grouped) {
        let page = '';
        let bestClicks = -1;
        let bestImpressions = -1;
        for (const [url, stats] of totals.pages) {
            const betterImpressions = stats.impressions > bestImpressions;
            const sameImpressions = stats.impressions === bestImpressions && stats.clicks > bestClicks;
            const sameBoth = stats.impressions === bestImpressions && stats.clicks === bestClicks && (page === '' || url < page);
            if (betterImpressions || sameImpressions || sameBoth) {
                page = url;
                bestClicks = stats.clicks;
                bestImpressions = stats.impressions;
            }
        }
        queries.push({
            query,
            clicks: totals.clicks,
            impressions: totals.impressions,
            position: totals.impressions > 0 ? totals.weightedPosition / totals.impressions : 0,
            page,
        });
    }

    queries.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.query.localeCompare(b.query));
    return queries;
}

/** One row per search and page, every search kept. Position is impression-weighted. */
export function aggregateQueryPagePairs(rows: readonly Record<string, unknown>[]): QueryOnPage[] {
    const grouped = new Map<string, QueryOnPage & { weighted: number }>();
    for (const row of rows) {
        const fact = factFromRow(row);
        if (!fact || !fact.page) continue;
        const key = `${fact.query}\u0001${fact.page}`;
        const current = grouped.get(key) ?? { query: fact.query, page: fact.page, clicks: 0, impressions: 0, position: 0, weighted: 0 };
        current.clicks += fact.clicks;
        current.impressions += fact.impressions;
        current.weighted += fact.position * fact.impressions;
        grouped.set(key, current);
    }
    return [...grouped.values()]
        .filter(row => row.impressions > 0)
        .map(({ weighted, ...row }) => ({ ...row, position: weighted / row.impressions }));
}

/** Total impressions per page over the same rows, keyed by normalizeUrl(...).url. */
export function pageImpressionsFromFacts(rows: readonly Record<string, unknown>[]): Map<string, number> {
    const totals = new Map<string, number>();
    for (const row of rows) {
        const impressions = finiteNumber(row.impressions);
        const page = normalizeUrl(typeof row.page === 'string' ? row.page : null);
        if (impressions == null || !page) continue;
        totals.set(page.url, (totals.get(page.url) ?? 0) + impressions);
    }
    return totals;
}

function siteUrlOf(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const siteUrl = (value as { site_url?: unknown }).site_url;
    if (typeof siteUrl !== 'string') return null;
    const trimmed = siteUrl.trim();
    return trimmed.length > 0 ? trimmed : null;
}

export interface ArchitectGscContext {
    queries: ArchitectGscQuery[];
    /** Impressions per normalized page URL over the same days. */
    pageImpressions: Map<string, number>;
    /** Every search and page pair over the same days (not capped like `queries`). */
    queryPages: QueryOnPage[];
    /** Stored days read for queries, pageImpressions and queryPages (at most 28). 0 when Search Console is not connected or could not be read. */
    days: number;
    /** Every search grouped by intent over up to CLUSTER_DAY_WINDOW stored days, most impressions first. */
    clusters: ArchitectGscCluster[];
    /** Stored days the clusters cover. */
    clusterDays: number;
}

/** Top queries only, reading just the recent window. See loadArchitectGscContext. */
export async function loadArchitectGscQueries(
    admin: SearchReportingAdmin,
    input: { organizationId: string; clientId: string },
): Promise<ArchitectGscQuery[]> {
    return (await loadArchitectGscContext(admin, { ...input, clusterDayWindow: DAY_WINDOW })).queries;
}

/**
 * Top queries and per-page impressions for one client from gsc_history_facts
 * (query_page), scoped to the connected Search Console property. One read
 * covers up to 90 stored days: the newest 28 feed queries, pageImpressions
 * and queryPages; all of them feed the intent groups. A missing property or a
 * failed read yields empty results so map generation can continue without
 * invented demand.
 */
export async function loadArchitectGscContext(
    admin: SearchReportingAdmin,
    input: {
        organizationId: string;
        clientId: string;
        /** Brand and domain tokens left out of the intent groups. */
        ignoreTokens?: ReadonlySet<string>;
        /** Stored days for the groups. Defaults to CLUSTER_DAY_WINDOW; never fewer than 28. */
        clusterDayWindow?: number;
    },
): Promise<ArchitectGscContext> {
    const empty: ArchitectGscContext = { queries: [], pageImpressions: new Map(), queryPages: [], days: 0, clusters: [], clusterDays: 0 };
    const window = Math.max(DAY_WINDOW, input.clusterDayWindow ?? CLUSTER_DAY_WINDOW);
    try {
        const integration = await admin.from('client_integrations')
            .select('site_url:credentials->>site_url')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('service', 'gsc')
            .maybeSingle();
        if (integration.error) return empty;
        const property = siteUrlOf(integration.data);
        if (!property) return empty;

        const days = await admin.from('gsc_history_days')
            .select('id')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .order('data_date', { ascending: false })
            .range(0, window - 1);
        if (days.error) return empty;
        const dayIds = (days.data ?? [])
            .map(row => (row && typeof row === 'object' ? (row as { id?: unknown }).id : null))
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (dayIds.length === 0) return empty;

        const facts = await readGrainedFacts(admin, {
            dayIds,
            grains: ['query_page'],
            columns: 'day_id, query, page, clicks, impressions, position',
        });
        if (facts.failedGrains.includes('query_page')) return empty;
        // Days come newest first.
        const recentIds = new Set(dayIds.slice(0, DAY_WINDOW));
        const recent = facts.rows.filter(row => recentIds.has(String(row.day_id)));
        return {
            queries: aggregateQueryPageFacts(recent),
            pageImpressions: pageImpressionsFromFacts(recent),
            queryPages: aggregateQueryPagePairs(recent),
            days: recentIds.size,
            clusters: clusterQueryFacts(facts.rows, input.ignoreTokens),
            clusterDays: dayIds.length,
        };
    } catch {
        return empty;
    }
}

/**
 * Page-grain facts for the last 180 stored days, split into two 90-day
 * periods (see aggregatePagePerformance). The page grain is one row per page
 * per day, far lighter than query_page. A missing property or a failed read
 * yields EMPTY_PERFORMANCE, so generation continues without refresh signals.
 */
export async function loadArchitectPagePerformance(
    admin: SearchReportingAdmin,
    input: { organizationId: string; clientId: string },
): Promise<PerformanceRead> {
    try {
        const integration = await admin.from('client_integrations')
            .select('site_url:credentials->>site_url')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('service', 'gsc')
            .maybeSingle();
        if (integration.error) return EMPTY_PERFORMANCE;
        const property = siteUrlOf(integration.data);
        if (!property) return EMPTY_PERFORMANCE;

        const days = await admin.from('gsc_history_days')
            .select('id, data_date')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .order('data_date', { ascending: false })
            .range(0, PERIOD_DAYS * 2 - 1);
        if (days.error) return EMPTY_PERFORMANCE;
        const dayRows = (days.data ?? [])
            .map(row => row as { id?: unknown; data_date?: unknown })
            .filter((row): row is { id: string; data_date: string } =>
                typeof row?.id === 'string' && row.id.length > 0 && typeof row.data_date === 'string')
            .map(row => ({ id: row.id, date: row.data_date }));
        if (dayRows.length === 0) return EMPTY_PERFORMANCE;

        const facts = await readGrainedFacts(admin, {
            dayIds: dayRows.map(day => day.id),
            grains: ['page'],
            columns: 'day_id, page, clicks, impressions, position',
        });
        if (facts.failedGrains.includes('page')) return EMPTY_PERFORMANCE;
        return aggregatePagePerformance(facts.rows, dayRows);
    } catch {
        return EMPTY_PERFORMANCE;
    }
}
