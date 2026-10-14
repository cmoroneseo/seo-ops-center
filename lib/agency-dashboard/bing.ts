/**
 * Bing view for the agency dashboard.
 *
 * Position is impression-weighted AvgImpressionPosition:
 * positionWeight / positionImpressions. It is not divided by all impressions.
 * AvgClickPosition is never read. A missing Bing read does not change Google totals.
 */

import {
    percentChange,
    type MetricKey,
    type MetricView,
    type Totals,
} from './metrics';
import { NOT_ENOUGH_HISTORY, comparisonLabel, type DashboardCard } from './portfolio';
import { addDays, bucketStart, type DashboardBucket } from './range';

export type SearchEngine = 'google' | 'bing' | 'all';

export type BingGap = 'not_connected' | 'not_synced' | 'no_data' | 'sync_error' | 'unavailable';

export const BING_GAP_LABEL: Record<BingGap, string> = {
    not_connected: 'Bing: not connected',
    not_synced: 'Not synced',
    no_data: 'No data in this range',
    sync_error: 'Sync failed',
    unavailable: 'Bing data could not be loaded',
};

export const BING_PAGES_UNAVAILABLE = 'Bing pages could not be loaded';

/** Columns for bing_page_weeks. Avg click position stays in the table and off this read. */
export const BING_PAGE_COLUMNS = 'client_id, site_url, page, clicks, impressions, avg_impression_position, week_ending';

/** Bing connection row. site_url is the only credentials field. */
export const BING_LINK_COLUMNS = 'client_id, sync_status, last_synced_at, site_url:credentials->>site_url';

export const EMPTY_BING_PAYLOAD = {
    current: [],
    previous: [],
    series: [],
    positionSeries: [],
    queries: [],
} as const;

export interface BingPeriod {
    clicks: number | null;
    impressions: number | null;
    days: number | null;
    positionWeight: number | null;
    positionImpressions: number;
}

export interface BingBucketPoint {
    clicks: number | null;
    impressions: number | null;
    positionWeight: number | null;
    positionImpressions: number;
}

export interface BingRow {
    label: string;
    clicks: number;
    impressions: number;
    position: number | null;
}

export interface BingCardView {
    connected: boolean;
    reason: BingGap | null;
    reasonLabel: string | null;
    syncWarning: string | null;
    coverageLabel: string | null;
    changeNote: string | null;
    current: BingPeriod | null;
    previous: BingPeriod | null;
    points: Array<BingBucketPoint | null>;
    metrics: Record<MetricKey, MetricView>;
    series: Record<MetricKey, Array<number | null>>;
    queries: BingRow[];
    queriesReason: string | null;
    queriesNote: string | null;
    pages: BingRow[];
    pagesReason: string | null;
    pagesNote: string | null;
    clickShare: number | null;
    combinedCtr: MetricView;
}

export interface BingLinkInput {
    clientId: string;
    syncStatus: 'active' | 'error';
    lastSyncedAt: string | null;
    siteUrl: string;
}

export interface BingPageSource {
    clientId: string;
    siteUrl: string;
    page: string;
    clicks: number;
    impressions: number;
    avgImpressionPosition: number | null;
    weekEnding: string;
}

export interface BingAttachInput {
    bucket: DashboardBucket;
    expectedDays: number;
    expectedPreviousDays: number;
    failed?: boolean;
    links?: BingLinkInput[];
    payload?: unknown;
    pages?: BingPageSource[];
    pagesFailed?: boolean;
}

interface ParsedClient {
    current: BingPeriod | null;
    previous: BingPeriod | null;
    queriesComplete: boolean | null;
    pagesComplete: boolean | null;
    queryStale: boolean;
    queries: BingRow[];
    points: Array<BingBucketPoint | null>;
}

const METRICS: MetricKey[] = ['clicks', 'impressions', 'ctr', 'position'];

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function num(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return null;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

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

function blankPoints(length: number): Array<BingBucketPoint | null> {
    return Array.from({ length }, () => null);
}

/** Bing position uses the impressions that carried a position, not every impression. */
export function bingPosition(weight: number | null, positionImpressions: number): number | null {
    if (weight == null || !Number.isFinite(weight) || weight < 0) return null;
    if (!Number.isFinite(positionImpressions) || positionImpressions <= 0) return null;
    return weight / positionImpressions;
}

export function bingMetricValue(period: BingPeriod | null, metric: MetricKey): number | null {
    if (!period) return null;
    if (metric === 'position') return bingPosition(period.positionWeight, period.positionImpressions);
    if (period.days == null || period.days <= 0 || period.clicks == null || period.impressions == null) return null;
    if (metric === 'clicks') return period.clicks;
    if (metric === 'impressions') return period.impressions;
    if (period.impressions <= 0) return null;
    return period.clicks / period.impressions;
}

function bingMetricView(current: BingPeriod | null, previous: BingPeriod | null, metric: MetricKey): MetricView {
    const value = bingMetricValue(current, metric);
    const prior = bingMetricValue(previous, metric);
    return {
        value,
        previous: prior,
        change: percentChange(value, prior),
        absolute: value == null || prior == null ? null : value - prior,
    };
}

function metricsFor(current: BingPeriod | null, previous: BingPeriod | null): Record<MetricKey, MetricView> {
    return {
        clicks: bingMetricView(current, previous, 'clicks'),
        impressions: bingMetricView(current, previous, 'impressions'),
        ctr: bingMetricView(current, previous, 'ctr'),
        position: bingMetricView(current, previous, 'position'),
    };
}

function seriesFor(points: Array<BingBucketPoint | null>): Record<MetricKey, Array<number | null>> {
    return {
        clicks: points.map(point => point?.clicks ?? null),
        impressions: points.map(point => point?.impressions ?? null),
        ctr: points.map(point => {
            if (point?.clicks == null || point.impressions == null || point.impressions <= 0) return null;
            return point.clicks / point.impressions;
        }),
        position: points.map(point => point ? bingPosition(point.positionWeight, point.positionImpressions) : null),
    };
}

function volumeCtr(clicks: number | null, impressions: number | null): number | null {
    if (clicks == null || impressions == null || impressions <= 0) return null;
    return clicks / impressions;
}

/** Combined CTR is summed clicks over summed impressions. A missing side is left out, not treated as zero. */
export function combinedCtrValue(google: Totals | null, bing: BingPeriod | null): number | null {
    const googleOk = google != null && google.days > 0;
    const bingOk = bing != null && bing.days != null && bing.days > 0 && bing.clicks != null && bing.impressions != null;
    if (!googleOk && !bingOk) return null;
    const clicks = (googleOk ? google.clicks : 0) + (bingOk ? bing.clicks! : 0);
    const impressions = (googleOk ? google.impressions : 0) + (bingOk ? bing.impressions! : 0);
    return volumeCtr(clicks, impressions);
}

function combinedCtrView(card: DashboardCard, current: BingPeriod | null, previous: BingPeriod | null): MetricView {
    const bingUsed = current != null && current.days != null && current.days > 0 && current.clicks != null && current.impressions != null;
    const value = combinedCtrValue(card.currentTotals, bingUsed ? current : null);
    const prior = bingUsed && previous == null ? null : combinedCtrValue(card.previousTotals, bingUsed ? previous : null);
    return {
        value,
        previous: prior,
        change: percentChange(value, prior),
        absolute: value == null || prior == null ? null : value - prior,
    };
}

function clickShare(googleClicks: number | null, bing: BingPeriod | null): number | null {
    if (googleClicks == null || !bing || bing.clicks == null || bing.days == null || bing.days <= 0) return null;
    const total = googleClicks + bing.clicks;
    if (total <= 0) return null;
    return bing.clicks / total;
}

export function bingShareLabel(card: DashboardCard): string | null {
    const bing = card.bing;
    if (!bing) return null;
    if (bing.reason === 'unavailable') return `— ${bing.reasonLabel ?? BING_GAP_LABEL.unavailable}`;
    if (!bing.connected || bing.reason === 'not_connected') return 'Bing: not connected';
    if (bing.reasonLabel) return `— ${bing.reasonLabel}`;
    if (bing.clickShare == null) {
        if (card.reasonLabel) return `— ${card.reasonLabel}`;
        return '— No clicks in this range';
    }
    return `Bing ${Math.round(bing.clickShare * 100)}% of clicks`;
}

export function displayPage(page: string): string {
    try {
        const url = new URL(page);
        const path = `${url.pathname}${url.search}`;
        if (path && path !== '/') return path;
        return url.hostname.replace(/^www\./i, '') || page;
    } catch {
        return page;
    }
}

function periodFrom(row: Record<string, unknown> | null): BingPeriod | null {
    if (!row) return null;
    const clicks = row.clicks == null ? null : num(row.clicks);
    const impressions = row.impressions == null ? null : num(row.impressions);
    const days = row.days == null ? null : num(row.days);
    if (row.clicks != null && (clicks == null || clicks < 0)) throw new Error('Invalid Bing dashboard');
    if (row.impressions != null && (impressions == null || impressions < 0)) throw new Error('Invalid Bing dashboard');
    if (row.days != null && (days == null || days < 0)) throw new Error('Invalid Bing dashboard');
    const rawWeight = row.positionWeight == null ? null : num(row.positionWeight);
    if (row.positionWeight != null && rawWeight == null) throw new Error('Invalid Bing dashboard');
    const weight = rawWeight != null && rawWeight < 0 ? null : rawWeight;
    const rawImpressions = row.positionImpressions == null ? 0 : num(row.positionImpressions);
    if (rawImpressions == null || rawImpressions < 0) throw new Error('Invalid Bing dashboard');
    const hasTraffic = clicks != null && impressions != null && days != null && days > 0;
    const hasPosition = weight != null && rawImpressions > 0;
    if (!hasTraffic && !hasPosition) return null;
    return {
        clicks: hasTraffic ? clicks : null,
        impressions: hasTraffic ? impressions : null,
        days: hasTraffic ? days : null,
        positionWeight: weight,
        positionImpressions: rawImpressions,
    };
}

function queryRows(value: unknown): BingRow[] {
    if (!Array.isArray(value)) throw new Error('Invalid Bing dashboard');
    const rows: BingRow[] = [];
    for (const item of value) {
        const row = record(item);
        const label = text(row?.query);
        const clicks = num(row?.clicks);
        const impressions = num(row?.impressions);
        if (!label || clicks == null || impressions == null || clicks < 0 || impressions < 0) throw new Error('Invalid Bing dashboard');
        if (clicks <= 0) continue;
        const rawPosition = row?.avgImpressionPosition == null ? null : num(row.avgImpressionPosition);
        if (row?.avgImpressionPosition != null && rawPosition == null) throw new Error('Invalid Bing dashboard');
        rows.push({
            label,
            clicks,
            impressions,
            position: rawPosition != null && rawPosition < 0 ? null : rawPosition,
        });
    }
    return rows.slice(0, 3);
}

function alignPoints(
    spine: readonly string[],
    bucket: DashboardBucket,
    series: Array<Record<string, unknown>>,
    positions: Array<Record<string, unknown>>,
): Array<BingBucketPoint | null> {
    const byBucket = new Map<string, BingBucketPoint>();
    const touch = (key: string): BingBucketPoint => {
        const existing = byBucket.get(key);
        if (existing) return existing;
        const created: BingBucketPoint = { clicks: null, impressions: null, positionWeight: null, positionImpressions: 0 };
        byBucket.set(key, created);
        return created;
    };
    for (const row of series) {
        const key = text(row.bucket)?.slice(0, 10);
        const clicks = num(row.clicks);
        const impressions = num(row.impressions);
        if (!key || clicks == null || impressions == null || clicks < 0 || impressions < 0) throw new Error('Invalid Bing dashboard');
        const point = touch(key);
        point.clicks = (point.clicks ?? 0) + clicks;
        point.impressions = (point.impressions ?? 0) + impressions;
    }
    for (const row of positions) {
        const week = text(row.weekEnding)?.slice(0, 10);
        const rawWeight = row.positionWeight == null ? null : num(row.positionWeight);
        const rawImpressions = row.positionImpressions == null ? 0 : num(row.positionImpressions);
        if (!week || (row.positionWeight != null && rawWeight == null) || rawImpressions == null || rawImpressions < 0) {
            throw new Error('Invalid Bing dashboard');
        }
        const weight = rawWeight != null && rawWeight < 0 ? null : rawWeight;
        const keys = bucket === 'day'
            ? spine.filter(day => day <= week && day >= addDays(week, -6))
            : [bucketStart(week, bucket)];
        for (const key of keys) {
            if (!spine.includes(key) || weight == null || rawImpressions <= 0) continue;
            const point = touch(key);
            point.positionWeight = (point.positionWeight ?? 0) + weight;
            point.positionImpressions += rawImpressions;
        }
    }
    return spine.map(key => byBucket.get(key) ?? null);
}

export function parseBingPayload(
    value: unknown,
    spine: readonly string[],
    bucket: DashboardBucket,
): Map<string, ParsedClient> {
    const body = record(value);
    if (!body || !Array.isArray(body.current) || !Array.isArray(body.previous) || !Array.isArray(body.series) || !Array.isArray(body.positionSeries) || !Array.isArray(body.queries)) {
        throw new Error('Invalid Bing dashboard');
    }
    const clients = new Map<string, ParsedClient>();
    const ensure = (clientId: string): ParsedClient => {
        const existing = clients.get(clientId);
        if (existing) return existing;
        const created: ParsedClient = {
            current: null,
            previous: null,
            queriesComplete: null,
            pagesComplete: null,
            queryStale: false,
            queries: [],
            points: blankPoints(spine.length),
        };
        clients.set(clientId, created);
        return created;
    };

    for (const item of body.current) {
        const row = record(item);
        const clientId = text(row?.clientId);
        if (!row || !clientId) throw new Error('Invalid Bing dashboard');
        const parsed = ensure(clientId);
        parsed.current = periodFrom(row);
        if (row.queriesComplete != null && typeof row.queriesComplete !== 'boolean') throw new Error('Invalid Bing dashboard');
        if (row.pagesComplete != null && typeof row.pagesComplete !== 'boolean') throw new Error('Invalid Bing dashboard');
        parsed.queriesComplete = row.queriesComplete === true ? true : row.queriesComplete === false ? false : null;
        parsed.pagesComplete = row.pagesComplete === true ? true : row.pagesComplete === false ? false : null;
    }
    for (const item of body.previous) {
        const row = record(item);
        const clientId = text(row?.clientId);
        if (!row || !clientId) throw new Error('Invalid Bing dashboard');
        ensure(clientId).previous = periodFrom(row);
    }

    const seriesByClient = new Map<string, Array<Record<string, unknown>>>();
    const positionByClient = new Map<string, Array<Record<string, unknown>>>();
    for (const item of body.series) {
        const row = record(item);
        const clientId = text(row?.clientId);
        if (!row || !clientId) throw new Error('Invalid Bing dashboard');
        ensure(clientId);
        const list = seriesByClient.get(clientId) ?? [];
        list.push(row);
        seriesByClient.set(clientId, list);
    }
    for (const item of body.positionSeries) {
        const row = record(item);
        const clientId = text(row?.clientId);
        if (!row || !clientId) throw new Error('Invalid Bing dashboard');
        ensure(clientId);
        const list = positionByClient.get(clientId) ?? [];
        list.push(row);
        positionByClient.set(clientId, list);
    }
    for (const [clientId, parsed] of clients) {
        parsed.points = alignPoints(spine, bucket, seriesByClient.get(clientId) ?? [], positionByClient.get(clientId) ?? []);
    }

    for (const item of body.queries) {
        const row = record(item);
        const clientId = text(row?.clientId);
        if (!row || !clientId || typeof row.stale !== 'boolean') throw new Error('Invalid Bing dashboard');
        const parsed = ensure(clientId);
        parsed.queryStale = row.stale;
        parsed.queries = queryRows(row.queries);
        parsed.points = alignPoints(spine, bucket, seriesByClient.get(clientId) ?? [], positionByClient.get(clientId) ?? []);
    }
    return clients;
}

function hasBingData(period: BingPeriod | null): boolean {
    if (!period) return false;
    return (period.days != null && period.days > 0) || bingPosition(period.positionWeight, period.positionImpressions) != null;
}

function covered(period: BingPeriod | null, expected: number): BingPeriod | null {
    if (!period) return null;
    if (expected <= 0) return period;
    if (period.days == null || period.days < expected) return null;
    return period;
}

export function topBingPages(rows: readonly BingPageSource[], limit = 3): Map<string, BingRow[]> {
    const grouped = new Map<string, Map<string, { clicks: number; impressions: number; weight: number; weightImpressions: number }>>();
    for (const row of rows) {
        if (row.clicks < 0 || row.impressions < 0) continue;
        const pages = grouped.get(row.clientId) ?? new Map();
        const current = pages.get(row.page) ?? { clicks: 0, impressions: 0, weight: 0, weightImpressions: 0 };
        current.clicks += row.clicks;
        current.impressions += row.impressions;
        if (row.avgImpressionPosition != null && row.avgImpressionPosition >= 0 && row.impressions > 0) {
            current.weight += row.avgImpressionPosition * row.impressions;
            current.weightImpressions += row.impressions;
        }
        pages.set(row.page, current);
        grouped.set(row.clientId, pages);
    }
    const result = new Map<string, BingRow[]>();
    for (const [clientId, pages] of grouped) {
        const ranked = [...pages.entries()]
            .filter(([, page]) => page.clicks > 0)
            .sort((left, right) => right[1].clicks - left[1].clicks || left[0].localeCompare(right[0]))
            .slice(0, limit)
            .map(([page, value]) => ({
                label: displayPage(page),
                clicks: value.clicks,
                impressions: value.impressions,
                position: value.weightImpressions > 0 ? value.weight / value.weightImpressions : null,
            }));
        result.set(clientId, ranked);
    }
    return result;
}

function emptyView(length: number, card: DashboardCard, patch: Partial<BingCardView>): BingCardView {
    const current = patch.current ?? null;
    const previous = patch.previous ?? null;
    return {
        connected: false,
        reason: 'not_connected',
        reasonLabel: BING_GAP_LABEL.not_connected,
        syncWarning: null,
        coverageLabel: null,
        changeNote: null,
        current,
        previous,
        points: blankPoints(length),
        metrics: blankMetrics(),
        series: blankSeries(length),
        queries: [],
        queriesReason: null,
        queriesNote: null,
        pages: [],
        pagesReason: null,
        pagesNote: null,
        clickShare: null,
        combinedCtr: combinedCtrView(card, current, previous),
        ...patch,
    };
}

function viewForCard(
    card: DashboardCard,
    input: BingAttachInput,
    parsed: Map<string, ParsedClient>,
    pages: Map<string, BingRow[]>,
    link: BingLinkInput | undefined,
): BingCardView {
    const length = card.series.clicks.length;
    if (!link) return emptyView(length, card, {});
    const row = parsed.get(card.clientId);
    const rawCurrent = row?.current ?? null;
    const rawPrevious = row?.previous ?? null;
    const previous = covered(rawPrevious, input.expectedPreviousDays);
    const changeNote = rawPrevious && !previous ? NOT_ENOUGH_HISTORY : null;
    const connected = true;
    if (!hasBingData(rawCurrent)) {
        let reason: BingGap = 'no_data';
        if (link.syncStatus === 'error' && !link.lastSyncedAt) reason = 'sync_error';
        else if (!link.lastSyncedAt) reason = 'not_synced';
        else if (link.syncStatus === 'error') reason = 'sync_error';
        return emptyView(length, card, {
            connected,
            reason,
            reasonLabel: BING_GAP_LABEL[reason],
            changeNote: null,
        });
    }
    const points = row?.points ?? blankPoints(length);
    const queries = row?.queries ?? [];
    const queryIncomplete = row?.queryStale === true || row?.queriesComplete === false;
    const pageRows = pages.get(card.clientId) ?? [];
    const pagesIncomplete = row?.pagesComplete === false;
    let pagesReason: string | null = null;
    let pagesNote: string | null = null;
    if (input.pagesFailed) pagesReason = BING_PAGES_UNAVAILABLE;
    else if (pageRows.length === 0) pagesReason = pagesIncomplete ? 'Pages were not stored for this range' : 'No pages with clicks in this range';
    else if (pagesIncomplete) pagesNote = 'Page list may be incomplete';
    return emptyView(length, card, {
        connected,
        reason: null,
        reasonLabel: null,
        syncWarning: link.syncStatus === 'error' ? 'Last sync failed' : null,
        coverageLabel: rawCurrent?.days != null && input.expectedDays > 0 && rawCurrent.days < input.expectedDays
            ? `${rawCurrent.days} of ${input.expectedDays} days`
            : null,
        changeNote,
        current: rawCurrent,
        previous,
        points,
        metrics: metricsFor(rawCurrent, previous),
        series: seriesFor(points),
        queries,
        queriesReason: queries.length === 0 ? (queryIncomplete ? 'Query list may be incomplete' : 'No queries with clicks in this range') : null,
        queriesNote: queries.length > 0 && queryIncomplete ? 'Query list may be incomplete' : null,
        pages: input.pagesFailed ? [] : pageRows,
        pagesReason,
        pagesNote,
        clickShare: clickShare(card.currentTotals ? card.currentTotals.clicks : null, rawCurrent),
        combinedCtr: combinedCtrView(card, rawCurrent, previous),
    });
}

export function attachBingDashboard<T extends { cards: DashboardCard[]; buckets: string[] }>(model: T, input: BingAttachInput): T & { bingEnabled: true } {
    const length = model.buckets.length;
    if (input.failed) {
        return {
            ...model,
            bingEnabled: true,
            cards: model.cards.map(card => ({
                ...card,
                bing: emptyView(length, card, {
                    reason: 'unavailable',
                    reasonLabel: BING_GAP_LABEL.unavailable,
                }),
            })),
        };
    }
    let parsed = new Map<string, ParsedClient>();
    try {
        parsed = parseBingPayload(input.payload ?? EMPTY_BING_PAYLOAD, model.buckets, input.bucket);
    } catch {
        return attachBingDashboard(model, { ...input, failed: true });
    }
    const links = new Map((input.links ?? []).map(link => [link.clientId, link]));
    const allowed = new Set((input.links ?? []).map(link => `${link.clientId}\0${link.siteUrl}`));
    const pages = topBingPages((input.pages ?? []).filter(page => allowed.has(`${page.clientId}\0${page.siteUrl}`)));
    return {
        ...model,
        bingEnabled: true,
        cards: model.cards.map(card => ({
            ...card,
            bing: viewForCard(card, input, parsed, pages, links.get(card.clientId)),
        })),
    };
}

export interface EngineFace {
    metrics: Record<MetricKey, MetricView>;
    series: Record<MetricKey, Array<number | null>>;
    overlay: Record<MetricKey, Array<number | null>> | null;
    reason: string | null;
    reasonLabel: string | null;
    changeNote: string | null;
    coverageLabel: string | null;
}

export function engineFace(card: DashboardCard, engine: SearchEngine): EngineFace {
    if (engine === 'google' || !card.bing) {
        return {
            metrics: card.metrics,
            series: card.series,
            overlay: null,
            reason: card.reason,
            reasonLabel: card.reasonLabel,
            changeNote: card.changeNote,
            coverageLabel: card.coverageLabel,
        };
    }
    if (engine === 'bing') {
        return {
            metrics: card.bing.metrics,
            series: card.bing.series,
            overlay: null,
            reason: card.bing.reason,
            reasonLabel: card.bing.reasonLabel,
            changeNote: card.bing.changeNote,
            coverageLabel: card.bing.coverageLabel,
        };
    }
    const metrics = { ...card.metrics, ctr: card.bing.combinedCtr };
    return {
        metrics,
        series: card.series,
        overlay: card.bing.connected ? card.bing.series : null,
        reason: card.reason,
        reasonLabel: card.reasonLabel,
        changeNote: card.changeNote,
        coverageLabel: card.coverageLabel,
    };
}

function sumPeriods(cards: readonly DashboardCard[], which: 'current' | 'previous'): BingPeriod | null {
    let clicks = 0;
    let impressions = 0;
    let days = 0;
    let positionWeight = 0;
    let positionImpressions = 0;
    let traffic = false;
    let positioned = false;
    for (const card of cards) {
        const period = card.bing?.[which];
        if (!period || card.bing?.reason) continue;
        if (which === 'previous' && card.bing?.changeNote) continue;
        if (period.clicks != null && period.impressions != null && period.days != null && period.days > 0) {
            traffic = true;
            clicks += period.clicks;
            impressions += period.impressions;
            days += period.days;
        }
        if (period.positionWeight != null && period.positionImpressions > 0) {
            positioned = true;
            positionWeight += period.positionWeight;
            positionImpressions += period.positionImpressions;
        }
    }
    if (!traffic && !positioned) return null;
    return {
        clicks: traffic ? clicks : null,
        impressions: traffic ? impressions : null,
        days: traffic ? days : null,
        positionWeight: positioned ? positionWeight : null,
        positionImpressions,
    };
}

function sumPoints(cards: readonly DashboardCard[], length: number): Array<BingBucketPoint | null> {
    return Array.from({ length }, (_, index) => {
        let clicks: number | null = null;
        let impressions: number | null = null;
        let positionWeight: number | null = null;
        let positionImpressions = 0;
        let any = false;
        for (const card of cards) {
            const point = card.bing?.points[index];
            if (!point) continue;
            any = true;
            if (point.clicks != null) clicks = (clicks ?? 0) + point.clicks;
            if (point.impressions != null) impressions = (impressions ?? 0) + point.impressions;
            if (point.positionWeight != null && point.positionImpressions > 0) {
                positionWeight = (positionWeight ?? 0) + point.positionWeight;
                positionImpressions += point.positionImpressions;
            }
        }
        if (!any) return null;
        return { clicks, impressions, positionWeight, positionImpressions };
    });
}

function bingTraffic(period: BingPeriod | null): period is BingPeriod & { clicks: number; impressions: number; days: number } {
    return period != null && period.days != null && period.days > 0 && period.clicks != null && period.impressions != null;
}

/** One client's contribution to combined CTR. Missing Bing is omitted. A short Bing previous drops the comparison. */
function combinedSide(card: DashboardCard, which: 'current' | 'previous'): { clicks: number; impressions: number } | null {
    const google = which === 'current' ? card.currentTotals : card.previousTotals;
    const googleOk = google != null && google.days > 0;
    const bing = card.bing?.[which] ?? null;
    const bingOk = bingTraffic(bing) && !(which === 'previous' && card.bing?.changeNote);
    const currentBing = bingTraffic(card.bing?.current ?? null);
    if (which === 'previous' && currentBing && !bingOk) return null;
    if (!googleOk && !bingOk) return null;
    return {
        clicks: (googleOk ? google.clicks : 0) + (bingOk ? bing.clicks : 0),
        impressions: (googleOk ? google.impressions : 0) + (bingOk ? bing.impressions : 0),
    };
}

function combinedPortfolio(cards: readonly DashboardCard[], which: 'current' | 'previous'): { clicks: number; impressions: number } | null {
    let clicks = 0;
    let impressions = 0;
    let any = false;
    for (const card of cards) {
        const side = combinedSide(card, which);
        if (!side) continue;
        any = true;
        clicks += side.clicks;
        impressions += side.impressions;
    }
    return any ? { clicks, impressions } : null;
}

function combinedSeries(cards: readonly DashboardCard[], length: number): Array<number | null> {
    return Array.from({ length }, (_, index) => {
        let clicks = 0;
        let impressions = 0;
        let any = false;
        for (const card of cards) {
            const googleClicks = card.series.clicks[index];
            const googleImpressions = card.series.impressions[index];
            if (googleClicks != null && googleImpressions != null) {
                any = true;
                clicks += googleClicks;
                impressions += googleImpressions;
            }
            const point = card.bing?.points[index];
            if (point?.clicks != null && point.impressions != null) {
                any = true;
                clicks += point.clicks;
                impressions += point.impressions;
            }
        }
        return any ? volumeCtr(clicks, impressions) : null;
    });
}

export function engineHeadline(
    google: {
        kpis: Record<MetricKey, MetricView>;
        kpiSeries: Record<MetricKey, Array<number | null>>;
        comparison: string | null;
    },
    cards: readonly DashboardCard[],
    engine: SearchEngine,
): {
    kpis: Record<MetricKey, MetricView>;
    kpiSeries: Record<MetricKey, Array<number | null>>;
    overlay: Record<MetricKey, Array<number | null>> | null;
    comparison: string | null;
} {
    if (engine === 'google' || cards.every(card => !card.bing)) {
        return { kpis: google.kpis, kpiSeries: google.kpiSeries, overlay: null, comparison: google.comparison };
    }
    const length = google.kpiSeries.clicks.length;
    if (engine === 'all') {
        const current = combinedPortfolio(cards, 'current');
        const comparable = cards.filter(card => combinedSide(card, 'current') && combinedSide(card, 'previous'));
        const previous = comparable.length === cards.filter(card => combinedSide(card, 'current')).length
            ? combinedPortfolio(comparable, 'previous')
            : null;
        const value = current ? volumeCtr(current.clicks, current.impressions) : google.kpis.ctr.value;
        const prior = previous ? volumeCtr(previous.clicks, previous.impressions) : current ? null : google.kpis.ctr.previous;
        const ctr: MetricView = {
            value,
            previous: prior,
            change: percentChange(value, prior),
            absolute: value == null || prior == null ? null : value - prior,
        };
        const overlay = seriesFor(sumPoints(cards, length));
        return {
            kpis: { ...google.kpis, ctr },
            kpiSeries: { ...google.kpiSeries, ctr: combinedSeries(cards, length) },
            overlay,
            comparison: google.comparison,
        };
    }

    const withData = cards.filter(card => card.bing && card.bing.reason == null && hasBingData(card.bing.current));
    const current = sumPeriods(withData, 'current');
    const previous = sumPeriods(withData, 'previous');
    const paired = withData.filter(card => card.bing?.previous && !card.bing.changeNote).length;
    const kpis = metricsFor(current, paired === withData.length ? previous : null);
    if (paired !== withData.length && paired > 0) {
        const pairedCards = withData.filter(card => card.bing?.previous && !card.bing.changeNote);
        const pairedMetrics = metricsFor(sumPeriods(pairedCards, 'current'), sumPeriods(pairedCards, 'previous'));
        for (const metric of METRICS) {
            kpis[metric] = {
                ...kpis[metric],
                change: pairedMetrics[metric].change,
                absolute: null,
            };
        }
    }
    const points = sumPoints(withData, length);
    return {
        kpis,
        kpiSeries: seriesFor(points),
        overlay: null,
        comparison: comparisonLabel(paired, withData.length, withData.filter(card => card.bing?.changeNote).length),
    };
}

export function readBingPageRow(row: Record<string, unknown>): BingPageSource | null {
    const clientId = text(row.client_id);
    const siteUrl = text(row.site_url);
    const page = text(row.page);
    const clicks = num(row.clicks);
    const impressions = num(row.impressions);
    const weekEnding = text(row.week_ending)?.slice(0, 10) ?? null;
    if (!clientId || !siteUrl || !page || !weekEnding || clicks == null || impressions == null || clicks < 0 || impressions < 0) return null;
    const rawPosition = row.avg_impression_position == null ? null : num(row.avg_impression_position);
    if (row.avg_impression_position != null && rawPosition == null) return null;
    return {
        clientId,
        siteUrl,
        page,
        clicks,
        impressions,
        avgImpressionPosition: rawPosition != null && rawPosition < 0 ? null : rawPosition,
        weekEnding,
    };
}

export function readBingLink(row: Record<string, unknown>): BingLinkInput | null {
    const clientId = text(row.client_id);
    const siteUrl = text(row.site_url);
    const syncStatus = row.sync_status === 'error' ? 'error' : row.sync_status === 'active' ? 'active' : null;
    if (!clientId || !siteUrl || !syncStatus) return null;
    const synced = text(row.last_synced_at);
    return { clientId, siteUrl, syncStatus, lastSyncedAt: synced };
}
