import { buildImpact } from './impact';
import {
    mergeGa4,
    mergeGa4Site,
    pageDaysFromFacts,
    propertyDaysFromFacts,
    queryDaysFromFacts,
    type Ga4PageRow,
    type Ga4SiteRow,
    type GscFactRow,
    type HistoryDayRow,
} from './facts';
import { ga4PathFor } from './match';
import type { ImpactModel, SeoChange } from './types';

export function impactsFromRows(input: {
    changes: readonly SeoChange[];
    now: Date;
    gscConnected: boolean;
    ga4Connected: boolean;
    historyDays: readonly HistoryDayRow[];
    pageFacts: readonly GscFactRow[];
    propertyFacts: readonly GscFactRow[];
    queryFacts: readonly GscFactRow[];
    ga4Pages: readonly Ga4PageRow[];
    ga4Site: readonly Ga4SiteRow[];
}): Record<string, ImpactModel> {
    const sitewide = mergeGa4Site(propertyDaysFromFacts(input.historyDays, input.propertyFacts), input.ga4Site);
    const impacts: Record<string, ImpactModel> = {};
    for (const change of input.changes) {
        const urls = change.pages.map(page => page.url);
        const paths = change.pages.flatMap(page => {
            const path = ga4PathFor(page.url);
            return path ? [path] : [];
        });
        const pageDays = mergeGa4(pageDaysFromFacts(input.historyDays, input.pageFacts, urls), input.ga4Pages, paths);
        impacts[change.id] = buildImpact({
            liveOn: change.liveOn,
            kpi: change.kpi,
            now: input.now,
            compareLastYear: change.compareLastYear,
            gscConnected: input.gscConnected,
            ga4Connected: input.ga4Connected,
            pageDays,
            sitewideDays: sitewide,
            yoyPageDays: pageDays,
            yoySitewideDays: sitewide,
            queries: change.queries.map(query => ({
                query: query.query,
                days: queryDaysFromFacts(input.historyDays, input.queryFacts, urls, query.normalized),
            })),
        });
    }
    return impacts;
}
