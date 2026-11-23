import { eachDate } from '@/lib/search-reporting/range';
import { sumMetrics } from '@/lib/search-reporting/metrics';
import { normalizeResultUrl } from '@/lib/search-reporting/result-url';

import { gbpDaysFromFacts, isOrganicSurface, type GscFactRow, type HistoryDayRow } from './facts';
import { pageMatchesChange } from './match';
import { sumWindow } from './metrics';
import { NEAR_ZERO_QUERY_IMPRESSIONS, VERDICT_THRESHOLDS } from './thresholds';
import { afterWindow, baselineWindow } from './time';
import type { ImpactModel, QueryCompare, SearchTermContext, SeoChange } from './types';
import { normalizeQuery } from './validate';

type Period = 'before' | 'after';
type BetterPage = SearchTermContext['warnings'][number]['betterPages'][number];

export function addDetailContext(input: {
    change: SeoChange;
    impact: ImpactModel;
    days: readonly HistoryDayRow[];
    pageQueryFacts: readonly GscFactRow[];
    siteQueryFacts: readonly GscFactRow[];
    taggedPageFacts: readonly GscFactRow[];
}): void {
    const { change, impact } = input;
    const urls = change.pages.map(page => page.url);
    const before = baselineWindow(change.liveOn);
    const after = afterWindow(change.liveOn, impact.headline.ready ? impact.headline.days : 28);
    const days = input.days.filter(day => !day.preliminary && day.date <= impact.finalThrough
        && (inSpan(day.date, before) || inSpan(day.date, after)));
    const beforeIds = new Set(days.filter(day => inSpan(day.date, before)).map(day => day.id));
    const afterIds = new Set(days.filter(day => inSpan(day.date, after)).map(day => day.id));
    const elapsedAfter = eachDate(after.start, after.end).filter(date => date <= impact.finalThrough).length;
    const beforeCovered = beforeIds.size >= VERDICT_THRESHOLDS.minBaselineDays;
    const afterCovered = elapsedAfter >= 7 && afterIds.size / elapsedAfter >= VERDICT_THRESHOLDS.minAfterCoverage;

    if (change.queries.length > 0) {
        const betterPages = competingPages(input.siteQueryFacts, urls, impact.queries, beforeIds, afterIds);
        const warnings = impact.queries.flatMap(query => {
            const before = sparseImpressions(query.beforeImpressions, beforeCovered);
            const after = sparseImpressions(query.afterImpressions, afterCovered);
            const competitors = betterPages.get(normalizeQuery(query.query)) ?? [];
            return before != null || after != null || competitors.length > 0
                ? [{ query: query.query, before, after, betterPages: competitors }]
                : [];
        });
        impact.searchTermContext = {
            warnings,
            suggestions: warnings.some(warning => warning.before != null || warning.after != null)
                ? topQueries(input.pageQueryFacts, beforeIds, urls, new Set(change.queries.map(query => query.normalized)))
                : [],
        };
    }

    const gbpDays = gbpDaysFromFacts(days, input.taggedPageFacts, urls);
    if (gbpDays.length > 0) {
        impact.gbp = {
            before: sumWindow(gbpDays, before.start, before.end, impact.finalThrough),
            after: sumWindow(gbpDays, after.start, after.end, impact.finalThrough),
        };
    }
}

function inSpan(date: string, span: { start: string; end: string }): boolean {
    return date >= span.start && date <= span.end;
}

function sparseImpressions(impressions: number | null, covered: boolean): number | null {
    // No row means zero *reported* impressions when the period has saved data.
    const reported = impressions ?? 0;
    return covered && reported < NEAR_ZERO_QUERY_IMPRESSIONS ? reported : null;
}

function topQueries(
    facts: readonly GscFactRow[],
    beforeIds: ReadonlySet<string>,
    urls: readonly string[],
    tracked: ReadonlySet<string>,
): SearchTermContext['suggestions'] {
    const groups = new Map<string, GscFactRow[]>();
    for (const fact of facts) {
        if (fact.grain !== 'query_page' || !beforeIds.has(fact.dayId) || !isOrganicSurface(fact.surface)) continue;
        const query = normalizeQuery(fact.query);
        if (!query || tracked.has(query) || !urls.some(url => pageMatchesChange(fact.page, url))) continue;
        const list = groups.get(query) ?? [];
        list.push(fact);
        groups.set(query, list);
    }
    return [...groups].map(([query, rows]) => {
        const { impressions, position } = sumMetrics(rows);
        return { query, impressions, position };
    }).filter(row => row.impressions >= NEAR_ZERO_QUERY_IMPRESSIONS)
        .sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query))
        .slice(0, 3);
}

function competingPages(
    facts: readonly GscFactRow[],
    urls: readonly string[],
    tracked: readonly QueryCompare[],
    beforeIds: ReadonlySet<string>,
    afterIds: ReadonlySet<string>,
): Map<string, BetterPage[]> {
    const targetKeys = new Set(urls.map(normalizeResultUrl));
    const hosts = new Set([...targetKeys].map(key => key?.split('/')[0]));
    const groups = new Map<string, Record<Period, Map<string, GscFactRow[]>>>();
    for (const fact of facts) {
        if (fact.grain !== 'query_page' || !isOrganicSurface(fact.surface) || fact.position <= 0 || fact.impressions <= 0) continue;
        const period = beforeIds.has(fact.dayId) ? 'before' : afterIds.has(fact.dayId) ? 'after' : null;
        if (!period) continue;
        const key = normalizeResultUrl(fact.page);
        if (!key || targetKeys.has(key) || !hosts.has(key.split('/')[0])) continue;
        const query = normalizeQuery(fact.query);
        const periods = groups.get(query) ?? { before: new Map(), after: new Map() };
        const pages = periods[period];
        const rows = pages.get(key) ?? [];
        rows.push(fact);
        pages.set(key, rows);
        groups.set(query, periods);
    }
    const result = new Map<string, BetterPage[]>();
    for (const query of tracked) {
        const key = normalizeQuery(query.query);
        const periods = groups.get(key);
        if (!periods) continue;
        const better: BetterPage[] = [];
        for (const period of ['before', 'after'] as const) {
            const pagePosition = period === 'before' ? query.beforePosition : query.afterPosition;
            if (pagePosition == null || pagePosition <= 0) continue;
            let best: BetterPage | undefined;
            for (const rows of periods[period].values()) {
                const { position } = sumMetrics(rows);
                if (position == null || position >= (best?.position ?? pagePosition)) continue;
                best = { period, url: rows[0].page, position, pagePosition };
            }
            if (best) better.push(best);
        }
        if (better.length > 0) result.set(key, better);
    }
    return result;
}
