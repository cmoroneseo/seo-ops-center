/**
 * Query context for topical-map generation.
 * Reads the query_page grain of gsc_history_facts. The retired
 * gsc_search_performance table is not a source.
 */

import { readGrainedFacts } from '../search-reporting/fact-read';
import type { SearchReportingAdmin } from '../search-reporting/load';

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

/** Recent stored days, matching the site-inventory GSC seed window. */
const DAY_WINDOW = 28;
const QUERY_LIMIT = 50;

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
    return queries.slice(0, QUERY_LIMIT);
}

function siteUrlOf(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const siteUrl = (value as { site_url?: unknown }).site_url;
    if (typeof siteUrl !== 'string') return null;
    const trimmed = siteUrl.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Top queries for one client from gsc_history_facts (query_page), scoped to the
 * connected Search Console property. A missing property or a failed read yields
 * an empty list so map generation can continue without invented demand.
 */
export async function loadArchitectGscQueries(
    admin: SearchReportingAdmin,
    input: { organizationId: string; clientId: string },
): Promise<ArchitectGscQuery[]> {
    try {
        const integration = await admin.from('client_integrations')
            .select('site_url:credentials->>site_url')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('service', 'gsc')
            .maybeSingle();
        if (integration.error) return [];
        const property = siteUrlOf(integration.data);
        if (!property) return [];

        const days = await admin.from('gsc_history_days')
            .select('id')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .order('data_date', { ascending: false })
            .range(0, DAY_WINDOW - 1);
        if (days.error) return [];
        const dayIds = (days.data ?? [])
            .map(row => (row && typeof row === 'object' ? (row as { id?: unknown }).id : null))
            .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (dayIds.length === 0) return [];

        const facts = await readGrainedFacts(admin, {
            dayIds,
            grains: ['query_page'],
            columns: 'query, page, clicks, impressions, position',
        });
        if (facts.failedGrains.includes('query_page')) return [];
        return aggregateQueryPageFacts(facts.rows);
    } catch {
        return [];
    }
}
