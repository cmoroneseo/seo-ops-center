import type { ClientAgreement } from '@/lib/agreements/types';
import { agreementPeriod, formatHoursAgainstQuota } from '@/lib/agreements/logic';
import { phaseAnchor, phaseAt, phaseRank } from '@/lib/agreements/phase';
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
    type Totals,
} from './metrics';
import { bucketSpine, formatDay, formatImportedAt, formatSpan, type DashboardRange, type DashboardWindow } from './range';

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
    accountManager: string | null;
    seoHours: number | null;
    property: string;
    syncStatus: 'active' | 'error';
    lastSyncedAt: string | null;
    /** Null when the hours read failed. Zero means the ledger was read and nothing counted. */
    loggedHours: number | null;
    agreements: ClientAgreement[];
    agreementsKnown: boolean;
}

export interface AggregateClient {
    clientId: string;
    current: Totals | null;
    previous: Totals | null;
    series: SeriesPoint[];
    queries: Array<{ query: string; clicks: number }>;
    incomplete: boolean;
}

export interface DashboardCard {
    clientId: string;
    name: string;
    domain: string;
    property: string;
    accountManager: string | null;
    hoursLabel: string;
    phaseLabel: string | null;
    reason: GapReason | null;
    reasonLabel: string | null;
    coverageLabel: string | null;
    syncWarning: string | null;
    metrics: Record<MetricKey, MetricView>;
    series: Record<MetricKey, Array<number | null>>;
    queries: Array<{ query: string; clicks: number }>;
    links: { insights: string; plan: string; gsc: string };
}

export interface DashboardModel {
    range: DashboardRange;
    currentLabel: string;
    previousLabel: string;
    summary: string;
    clientsWithData: number;
    clientsConnected: number;
    pairedClients: number;
    settling: boolean;
    kpis: Record<MetricKey, MetricView>;
    kpiSeries: Record<MetricKey, Array<number | null>>;
    cards: DashboardCard[];
    managers: string[];
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

function phaseLabel(agreements: ClientAgreement[], today: string): string | null {
    const anchor = phaseAnchor(agreements);
    const phase = phaseAt(anchor, today);
    if (!phase) return null;
    return phase === 'onboarding' ? 'Onboarding' : `Month ${phaseRank(phase)}`;
}

function hoursLabel(client: DashboardClientInput, month: string): string {
    if (client.loggedHours == null) return '—';
    let budget: number | null = null;
    if (client.agreementsKnown && client.agreements.length > 0) {
        budget = agreementPeriod(client.agreements, month).monthlyBudget;
    } else if (client.agreementsKnown) {
        budget = client.seoHours;
    }
    return formatHoursAgainstQuota(client.loggedHours, budget);
}

function usable(totals: Totals | null): totals is Totals {
    return totals != null && totals.days > 0;
}

export function assembleDashboard(input: {
    range: DashboardRange;
    window: DashboardWindow | null;
    asOf: string | null;
    today: string;
    hoursMonth: string;
    clients: DashboardClientInput[];
    aggregates: AggregateClient[];
    freshness: { latestDataDate: string | null; latestImportedAt: string | null; settling: boolean };
}): DashboardModel {
    const spine = input.window ? bucketSpine(input.window.current.start, input.window.current.end, input.window.bucket) : [];
    const expected = input.window ? spine.length === 0 ? 0 : daysInWindow(input.window) : 0;
    const byClient = new Map(input.aggregates.map(row => [row.clientId, row]));
    const cards = input.clients.map(client => {
        const aggregate = byClient.get(client.id);
        const current = usable(aggregate?.current ?? null) ? aggregate!.current : null;
        const previous = usable(aggregate?.previous ?? null) ? aggregate!.previous : null;
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
        return {
            clientId: client.id,
            name: client.name,
            domain: displayDomain(client.domain, client.property),
            property: client.property,
            accountManager: client.accountManager?.trim() || null,
            hoursLabel: hoursLabel(client, input.hoursMonth),
            phaseLabel: client.agreementsKnown ? phaseLabel(client.agreements, input.today) : null,
            reason,
            reasonLabel: reason ? GAP_LABEL[reason] : null,
            coverageLabel,
            syncWarning: !reason && client.syncStatus === 'error' ? 'Last sync failed' : null,
            metrics,
            series,
            queries: reason ? [] : (aggregate?.queries ?? []).slice(0, 3),
            links: {
                insights: `/workspace/${client.id}?tab=insights`,
                plan: `/workspace/${client.id}?tab=campaign`,
                gsc: gscPerformanceUrl(client.property),
            },
        } satisfies DashboardCard;
    });

    const withData = cards.filter(card => card.reason == null);
    const pairedIds = new Set(input.aggregates.filter(row => usable(row.current) && usable(row.previous)).map(row => row.clientId));
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
    const managers = [...new Set(cards.flatMap(card => card.accountManager ? [card.accountManager] : []))].sort((a, b) => a.localeCompare(b));
    const currentLabel = input.window ? formatSpan(input.window.current) : '—';
    const previousLabel = input.window ? formatSpan(input.window.previous) : '—';
    const latestDay = formatDay(input.freshness.latestDataDate ?? input.asOf);
    const imported = formatImportedAt(input.freshness.latestImportedAt);
    const count = `${withData.length} of ${cards.length} clients`;
    const ranges = input.window ? `${currentLabel} vs ${previousLabel}` : 'No Search Console history yet';
    const freshness = imported ? `imported ${imported}` : latestDay ? `latest day ${latestDay}` : null;
    const latest = latestDay && imported ? `latest day ${latestDay}` : null;
    const summary = [count, ranges, latest, freshness].filter(Boolean).join(' · ');

    return {
        range: input.range,
        currentLabel,
        previousLabel,
        summary,
        clientsWithData: withData.length,
        clientsConnected: cards.length,
        pairedClients: pairedIds.size,
        settling: input.freshness.settling,
        kpis,
        kpiSeries,
        cards,
        managers,
    };
}

function daysInWindow(window: DashboardWindow): number {
    const start = Date.parse(`${window.current.start}T00:00:00Z`);
    const end = Date.parse(`${window.current.end}T00:00:00Z`);
    return Math.round((end - start) / 86400000) + 1;
}

export function filterCards(cards: readonly DashboardCard[], input: {
    query: string;
    manager: string | null;
    coverage: 'all' | 'data' | 'missing';
}): DashboardCard[] {
    const query = input.query.trim().toLowerCase();
    return cards.filter(card => {
        if (input.manager && card.accountManager !== input.manager) return false;
        if (input.coverage === 'data' && card.reason != null) return false;
        if (input.coverage === 'missing' && card.reason == null) return false;
        if (!query) return true;
        return card.name.toLowerCase().includes(query) || card.domain.toLowerCase().includes(query);
    });
}
