import type { Ga4CardView } from './ga4';
import {
    addTotals,
    alignSeries,
    displayDomain,
    emptyTotals,
    gscPerformanceUrl,
    metricValue,
    metricView,
    sumSeries,
    type MetricKey,
    type MetricView,
    type SeriesPoint,
    type SortMode,
    type Totals,
} from './metrics';
import { bucketSpine, daysInclusive, formatDay, formatImportedAt, formatSpan, type DashboardRange, type DashboardWindow } from './range';

export type GapReason = 'not_synced' | 'no_data' | 'sync_error';

export const GAP_LABEL: Record<GapReason, string> = {
    not_synced: 'Not synced',
    no_data: 'No data in this range',
    sync_error: 'Sync failed',
};

export interface DashboardClientInput {
    id: string;
    name: string;
    domain: string | null;
    property: string;
    syncStatus: 'active' | 'error';
    lastSyncedAt: string | null;
}

export interface AggregateClient {
    clientId: string;
    current: Totals | null;
    previous: Totals | null;
    series: SeriesPoint[];
    queries: Array<{ query: string; clicks: number }>;
    /** False when the aggregate did not compute queries. The card loads them on open. Omitted means the queries array is complete. */
    queriesKnown?: boolean;
    incomplete: boolean;
}

export interface DashboardCard {
    clientId: string;
    name: string;
    domain: string;
    property: string;
    currentTotals: Totals | null;
    previousTotals: Totals | null;
    points: SeriesPoint[];
    reason: GapReason | null;
    reasonLabel: string | null;
    coverageLabel: string | null;
    syncWarning: string | null;
    metrics: Record<MetricKey, MetricView>;
    series: Record<MetricKey, Array<number | null>>;
    queries: Array<{ query: string; clicks: number }>;
    queriesKnown: boolean;
    /** Shown next to an em dash when the query list is empty. */
    queriesReason: string | null;
    /** Set when the previous window exists but does not cover every day, so the percent would compare unequal history. */
    changeNote: string | null;
    links: { insights: string; plan: string; gsc: string };
    /** Present when Bing is enabled for this organization. Absent keeps the Google dashboard. */
    bing?: import('./bing').BingCardView | null;
    /** Present when the GA4 card flag is on. Absent keeps the Search Console card. */
    ga4?: Ga4CardView;
}

export interface DashboardModel {
    range: DashboardRange;
    currentLabel: string;
    previousLabel: string;
    summary: string;
    /** Dates and freshness, without the client count, so a filter can rewrite the count. */
    rangeLine: string;
    buckets: string[];
    clientsWithData: number;
    clientsConnected: number;
    pairedClients: number;
    settling: boolean;
    kpis: Record<MetricKey, MetricView>;
    kpiSeries: Record<MetricKey, Array<number | null>>;
    cards: DashboardCard[];
    /** True when the Bing Webmaster flag is on for this organization. The toggle stays hidden otherwise. */
    bingEnabled: boolean;
}

const METRIC_KEYS: MetricKey[] = ['clicks', 'impressions', 'ctr', 'position'];

function blankMetrics(): Record<MetricKey, MetricView> {
    return {
        clicks: { value: null, previous: null, change: null, absolute: null },
        impressions: { value: null, previous: null, change: null, absolute: null },
        ctr: { value: null, previous: null, change: null, absolute: null },
        position: { value: null, previous: null, change: null, absolute: null },
    };
}

function blankSeries(length: number): Record<MetricKey, Array<number | null>> {
    const empty = Array.from({ length }, () => null);
    return { clicks: empty, impressions: [...empty], ctr: [...empty], position: [...empty] };
}

function gapReason(client: DashboardClientInput): GapReason {
    if (client.syncStatus === 'error' && !client.lastSyncedAt) return 'sync_error';
    if (!client.lastSyncedAt) return 'not_synced';
    if (client.syncStatus === 'error') return 'sync_error';
    return 'no_data';
}

export const NOT_ENOUGH_HISTORY = 'Not enough history';

/** Defaults are impressions, biggest declines, and all clients. Each departure counts. */
export function activeFilterCount(input: {
    signal: MetricKey;
    sortMode: SortMode;
    coverage: 'all' | 'data' | 'missing';
}): number {
    let count = 0;
    if (input.signal !== 'impressions') count += 1;
    if (input.sortMode !== 'declines') count += 1;
    if (input.coverage !== 'all') count += 1;
    return count;
}

function usable(totals: Totals | null): totals is Totals {
    return totals != null && totals.days > 0;
}

export function assembleDashboard(input: {
    range: DashboardRange;
    window: DashboardWindow | null;
    asOf: string | null;
    clients: DashboardClientInput[];
    aggregates: AggregateClient[];
    freshness: { latestDataDate: string | null; latestImportedAt: string | null; settling: boolean };
}): DashboardModel {
    const spine = input.window ? bucketSpine(input.window.current.start, input.window.current.end, input.window.bucket) : [];
    const expected = input.window ? spine.length === 0 ? 0 : daysInWindow(input.window) : 0;
    // The previous window is the same length. A partial one (12M against ~16 months
    // of stored history) is not a comparison — the missing months read as growth.
    const expectedPrevious = input.window ? daysInclusive(input.window.previous.start, input.window.previous.end) : 0;
    const byClient = new Map(input.aggregates.map(row => [row.clientId, row]));
    const coveredPrevious = (previous: Totals | null): previous is Totals =>
        usable(previous) && (expectedPrevious <= 0 || previous.days >= expectedPrevious);
    const cards = input.clients.map(client => {
        const aggregate = byClient.get(client.id);
        const current = usable(aggregate?.current ?? null) ? aggregate!.current : null;
        const rawPrevious = usable(aggregate?.previous ?? null) ? aggregate!.previous : null;
        const previous = coveredPrevious(rawPrevious) ? rawPrevious : null;
        const changeNote = rawPrevious && !previous ? NOT_ENOUGH_HISTORY : null;
        const reason = current ? null : gapReason(client);
        const metrics = reason
            ? blankMetrics()
            : {
                clicks: metricView(current, previous, 'clicks'),
                impressions: metricView(current, previous, 'impressions'),
                ctr: metricView(current, previous, 'ctr'),
                position: metricView(current, previous, 'position'),
            };
        const points = reason ? [] : aggregate?.series ?? [];
        const series = reason ? blankSeries(spine.length) : {
            clicks: alignSeries(spine, points, 'clicks'),
            impressions: alignSeries(spine, points, 'impressions'),
            ctr: alignSeries(spine, points, 'ctr'),
            position: alignSeries(spine, points, 'position'),
        };
        const coverageLabel = !reason && current && expected > 0 && current.days < expected
            ? `${current.days} of ${expected} days`
            : null;
        // Omitted means the queries array is the answer, including an empty list.
        // False means the aggregate skipped queries and the card loads them on open.
        const queriesKnown = aggregate?.queriesKnown ?? true;
        const queries = reason || !queriesKnown ? [] : (aggregate?.queries ?? []).slice(0, 3);
        return {
            clientId: client.id,
            name: client.name,
            domain: displayDomain(client.domain, client.property),
            property: client.property,
            currentTotals: current,
            previousTotals: previous,
            points: reason ? [] : aggregate?.series ?? [],
            reason,
            reasonLabel: reason ? GAP_LABEL[reason] : null,
            coverageLabel,
            syncWarning: !reason && client.syncStatus === 'error' ? 'Last sync failed' : null,
            metrics,
            series,
            queries,
            queriesKnown: reason ? true : queriesKnown,
            queriesReason: reason ? GAP_LABEL[reason] : queriesKnown && queries.length === 0 ? 'No queries with clicks in this range' : null,
            changeNote: reason ? null : changeNote,
            links: {
                insights: `/workspace/${client.id}?tab=insights`,
                plan: `/workspace/${client.id}?tab=campaign`,
                gsc: gscPerformanceUrl(client.property),
            },
        } satisfies DashboardCard;
    });

    const withData = cards.filter(card => card.reason == null);
    const pairedIds = new Set(input.aggregates.filter(row => usable(row.current) && coveredPrevious(row.previous)).map(row => row.clientId));
    const headline = withData.reduce((total, card) => {
        const row = byClient.get(card.clientId);
        return row?.current ? addTotals(total, row.current) : total;
    }, emptyTotals());
    const pairedRows = input.aggregates.filter(row => pairedIds.has(row.clientId));
    const pairedCurrent = pairedRows.reduce((total, row) => addTotals(total, row.current!), emptyTotals());
    const pairedPrevious = pairedRows.reduce((total, row) => addTotals(total, row.previous!), emptyTotals());
    const currentTotals = withData.length ? headline : null;
    const previousTotals = pairedIds.size ? pairedPrevious : null;
    const currentForChange = pairedIds.size ? pairedCurrent : null;
    // Headline totals include every client with current data. The percent uses
    // only clients that also have the previous window, so a first sync cannot
    // look like infinite growth.
    const kpis = Object.fromEntries(METRIC_KEYS.map(metric => {
        const headlineValue = metricValue(currentTotals, metric);
        const prior = metricValue(previousTotals, metric);
        const paired = metricView(currentForChange, previousTotals, metric);
        return [metric, {
            value: headlineValue,
            previous: prior,
            change: paired.change,
            absolute: headlineValue == null || prior == null || pairedIds.size !== withData.length ? null : headlineValue - prior,
        } satisfies MetricView];
    })) as Record<MetricKey, MetricView>;

    const agencyPoints = sumSeries(spine, withData.map(card => ({ points: byClient.get(card.clientId)?.series ?? [] })));
    const kpiSeries = {
        clicks: agencyPoints.map(point => point ? metricValue({ ...point, days: 1 }, 'clicks') : null),
        impressions: agencyPoints.map(point => point ? metricValue({ ...point, days: 1 }, 'impressions') : null),
        ctr: agencyPoints.map(point => point ? metricValue({ ...point, days: 1 }, 'ctr') : null),
        position: agencyPoints.map(point => point ? metricValue({ ...point, days: 1 }, 'position') : null),
    };
    const currentLabel = input.window ? formatSpan(input.window.current) : '—';
    const previousLabel = input.window ? formatSpan(input.window.previous) : '—';
    const latestDay = formatDay(input.freshness.latestDataDate ?? input.asOf);
    const imported = formatImportedAt(input.freshness.latestImportedAt);
    const count = `${withData.length} of ${cards.length} clients`;
    const ranges = input.window ? `${currentLabel} vs ${previousLabel}` : 'No Search Console history yet';
    const freshness = imported ? `imported ${imported}` : latestDay ? `latest day ${latestDay}` : null;
    const latest = latestDay && imported ? `latest day ${latestDay}` : null;
    const rangeLine = [ranges, latest, freshness].filter(Boolean).join(' · ');
    const summary = [count, rangeLine].filter(Boolean).join(' · ');

    return {
        range: input.range,
        currentLabel,
        previousLabel,
        summary,
        rangeLine,
        buckets: spine,
        clientsWithData: withData.length,
        clientsConnected: cards.length,
        pairedClients: pairedIds.size,
        settling: input.freshness.settling,
        kpis,
        kpiSeries,
        cards,
        bingEnabled: false,
    };
}

function daysInWindow(window: DashboardWindow): number {
    const start = Date.parse(`${window.current.start}T00:00:00Z`);
    const end = Date.parse(`${window.current.end}T00:00:00Z`);
    return Math.round((end - start) / 86400000) + 1;
}

export function comparisonLabel(paired: number, withData: number, shortHistory = 0): string | null {
    if (withData <= 0 || paired >= withData) return null;
    if (shortHistory > 0 && paired === 0 && shortHistory >= withData) return 'Not enough history to compare this range.';
    if (shortHistory > 0 && shortHistory + paired >= withData) {
        return `Change compares ${paired} of ${withData} clients with a full previous period. The others do not have enough history.`;
    }
    if (shortHistory > 0) {
        return `Change compares ${paired} of ${withData} clients with a full previous period. ${shortHistory} do not have enough history. The total includes every client in this view with current data.`;
    }
    return `Change compares ${paired} of ${withData} clients that have both periods. The total includes every client in this view with current data.`;
}

/** KPIs for the cards currently on screen. Search and coverage filters must not leave the unfiltered totals up. */
export function summarizeSelection(model: Pick<DashboardModel, 'rangeLine' | 'buckets'>, cards: readonly DashboardCard[]): {
    summary: string;
    clientsWithData: number;
    clientsConnected: number;
    pairedClients: number;
    comparison: string | null;
    kpis: Record<MetricKey, MetricView>;
    kpiSeries: Record<MetricKey, Array<number | null>>;
} {
    const withData = cards.filter(card => card.reason == null && card.currentTotals);
    const paired = withData.filter(card => card.previousTotals);
    const shortHistory = withData.filter(card => card.changeNote != null).length;
    const headline = withData.reduce((total, card) => addTotals(total, card.currentTotals!), emptyTotals());
    const pairedCurrent = paired.reduce((total, card) => addTotals(total, card.currentTotals!), emptyTotals());
    const pairedPrevious = paired.reduce((total, card) => addTotals(total, card.previousTotals!), emptyTotals());
    const currentTotals = withData.length ? headline : null;
    const previousTotals = paired.length ? pairedPrevious : null;
    const currentForChange = paired.length ? pairedCurrent : null;
    const kpis = Object.fromEntries(METRIC_KEYS.map(metric => {
        const headlineValue = metricValue(currentTotals, metric);
        const prior = metricValue(previousTotals, metric);
        const change = metricView(currentForChange, previousTotals, metric);
        return [metric, {
            value: headlineValue,
            previous: prior,
            change: change.change,
            absolute: headlineValue == null || prior == null || paired.length !== withData.length ? null : headlineValue - prior,
        } satisfies MetricView];
    })) as Record<MetricKey, MetricView>;
    const agencyPoints = sumSeries(model.buckets, withData.map(card => ({ points: card.points })));
    const kpiSeries = {
        clicks: agencyPoints.map(point => point ? metricValue({ ...point, days: 1 }, 'clicks') : null),
        impressions: agencyPoints.map(point => point ? metricValue({ ...point, days: 1 }, 'impressions') : null),
        ctr: agencyPoints.map(point => point ? metricValue({ ...point, days: 1 }, 'ctr') : null),
        position: agencyPoints.map(point => point ? metricValue({ ...point, days: 1 }, 'position') : null),
    };
    const summary = [`${withData.length} of ${cards.length} clients`, model.rangeLine].filter(Boolean).join(' · ');
    return {
        summary,
        clientsWithData: withData.length,
        clientsConnected: cards.length,
        pairedClients: paired.length,
        comparison: comparisonLabel(paired.length, withData.length, shortHistory),
        kpis,
        kpiSeries,
    };
}

export function filterCards(cards: readonly DashboardCard[], input: {
    query: string;
    coverage: 'all' | 'data' | 'missing';
}): DashboardCard[] {
    const query = input.query.trim().toLowerCase();
    return cards.filter(card => {
        if (input.coverage === 'data' && card.reason != null) return false;
        if (input.coverage === 'missing' && card.reason == null) return false;
        if (!query) return true;
        return card.name.toLowerCase().includes(query) || card.domain.toLowerCase().includes(query);
    });
}
