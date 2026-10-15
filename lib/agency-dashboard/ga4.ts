/**
 * GA4 totals for the agency cards. A missing measurement stays null.
 * A stored zero is a real zero. Engagement rate is engaged sessions
 * divided by sessions, and is null when either side is missing.
 */

import {
    compareCards,
    formatCompact,
    percentChange,
    type MetricView,
    type SortDirection,
    type SortMode,
} from './metrics';
import { NOT_ENOUGH_HISTORY } from './portfolio';

export const GA4_PROPERTY_ID = /^properties\/[0-9]+$/;

export const CARD_METRICS = ['clicks', 'organic-sessions', 'key-events'] as const;
export type CardMetric = typeof CARD_METRICS[number];

export const CARD_METRIC_LABEL: Record<CardMetric, string> = {
    clicks: 'Clicks',
    'organic-sessions': 'Organic sessions',
    'key-events': 'Key events',
};

export const GA4_NOT_CONNECTED = 'GA4 not connected';
export const GA4_CONNECT_LABEL = 'Connect GA4';
export const GA4_UNAVAILABLE = 'GA4 history is not available';

export type Ga4CountKey = 'organicSessions' | 'sessions' | 'keyEvents';
export type Ga4MetricKey = Ga4CountKey | 'engagementRate';

export interface Ga4Period {
    organicSessions: number | null;
    sessions: number | null;
    engagedSessions: number | null;
    keyEvents: number | null;
    days: number;
}

export interface Ga4Point {
    bucket: string;
    organicSessions: number | null;
    keyEvents: number | null;
}

export interface Ga4ClientAggregate {
    clientId: string;
    current: Ga4Period | null;
    previous: Ga4Period | null;
    series: Ga4Point[];
}

export interface Ga4Aggregate {
    clients: Ga4ClientAggregate[];
}

export const EMPTY_GA4_AGGREGATE: Ga4Aggregate = { clients: [] };

export interface Ga4MetricView {
    value: number | null;
    previous: number | null;
    change: number | null;
}

export interface Ga4CardView {
    mapped: boolean;
    /** The history read failed. The card does not offer Connect GA4. */
    unavailable: boolean;
    metrics: Record<Ga4MetricKey, Ga4MetricView>;
    series: {
        organicSessions: Array<number | null>;
        keyEvents: Array<number | null>;
    };
    changeNote: string | null;
}

export interface Ga4AttachInput {
    /** Null when the integration list could not be read. */
    links: ReadonlyArray<{ clientId: string; property: string }> | null;
    /** Null when the aggregate could not be read. */
    aggregate: Ga4Aggregate | null;
    expectedPreviousDays: number;
}

interface Ga4DashboardSlice {
    buckets: string[];
    cards: Array<{ clientId: string; ga4?: Ga4CardView }>;
}

export function parseCardMetric(value: string | null | undefined): CardMetric {
    if (value === 'organic-sessions' || value === 'key-events' || value === 'clicks') return value;
    return 'clicks';
}

/** Keeps the other query params. Clicks is the default and leaves `metric` off the URL. */
export function cardMetricSearch(current: string, metric: CardMetric): string {
    const params = new URLSearchParams(current.startsWith('?') ? current.slice(1) : current);
    if (metric === 'clicks') params.delete('metric');
    else params.set('metric', metric);
    const text = params.toString();
    return text ? `?${text}` : '';
}

export function ga4HeroKey(metric: CardMetric): 'organicSessions' | 'keyEvents' | null {
    if (metric === 'organic-sessions') return 'organicSessions';
    if (metric === 'key-events') return 'keyEvents';
    return null;
}

/** Card hero and the GA4 bottom row. Full thousands separators, matching the card mock. */
export function formatCardCount(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value);
    if (Math.abs(rounded) >= 1_000_000) return formatCompact(rounded);
    return rounded.toLocaleString('en-US');
}

export function formatGa4Metric(metric: Ga4MetricKey, value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '—';
    if (metric === 'engagementRate') return `${(value * 100).toFixed(1)}%`;
    return formatCardCount(value);
}

/** Null when sessions or engaged sessions were not measured, or when there were no sessions. */
export function engagementRate(period: Ga4Period | null): number | null {
    if (!period || period.days <= 0) return null;
    if (period.sessions == null || period.engagedSessions == null) return null;
    if (period.sessions <= 0) return null;
    return period.engagedSessions / period.sessions;
}

function countValue(period: Ga4Period | null, metric: Ga4CountKey): number | null {
    if (!period || period.days <= 0) return null;
    return period[metric];
}

function metricView(current: number | null, previous: number | null): Ga4MetricView {
    return { value: current, previous, change: percentChange(current, previous) };
}

function blankMetric(): Ga4MetricView {
    return { value: null, previous: null, change: null };
}

function blankCard(length: number, mapped: boolean, unavailable: boolean): Ga4CardView {
    const empty = Array.from({ length }, () => null);
    return {
        mapped,
        unavailable,
        metrics: {
            organicSessions: blankMetric(),
            sessions: blankMetric(),
            engagementRate: blankMetric(),
            keyEvents: blankMetric(),
        },
        series: { organicSessions: [...empty], keyEvents: [...empty] },
        changeNote: null,
    };
}

function align(spine: readonly string[], points: readonly Ga4Point[], metric: 'organicSessions' | 'keyEvents'): Array<number | null> {
    const byBucket = new Map(points.map(point => [point.bucket, point[metric]]));
    return spine.map(bucket => (byBucket.has(bucket) ? byBucket.get(bucket) ?? null : null));
}

function measuredCard(
    row: Ga4ClientAggregate,
    spine: readonly string[],
    expectedPreviousDays: number,
): Ga4CardView {
    const current = row.current && row.current.days > 0 ? row.current : null;
    const rawPrevious = row.previous && row.previous.days > 0 ? row.previous : null;
    const previous = rawPrevious && (expectedPreviousDays <= 0 || rawPrevious.days >= expectedPreviousDays)
        ? rawPrevious
        : null;
    const counts: Ga4CountKey[] = ['organicSessions', 'sessions', 'keyEvents'];
    const metrics = {
        organicSessions: blankMetric(),
        sessions: blankMetric(),
        engagementRate: metricView(engagementRate(current), engagementRate(previous)),
        keyEvents: blankMetric(),
    };
    for (const metric of counts) {
        metrics[metric] = metricView(countValue(current, metric), countValue(previous, metric));
    }
    return {
        mapped: true,
        unavailable: false,
        metrics,
        series: {
            organicSessions: align(spine, row.series, 'organicSessions'),
            keyEvents: align(spine, row.series, 'keyEvents'),
        },
        changeNote: rawPrevious && !previous ? NOT_ENOUGH_HISTORY : null,
    };
}

export function attachGa4Dashboard<T extends Ga4DashboardSlice>(model: T, input: Ga4AttachInput): T {
    const linksKnown = input.links != null;
    const aggregateKnown = input.aggregate != null;
    const mapped = new Set((input.links ?? []).map(link => link.clientId));
    const byClient = new Map((input.aggregate?.clients ?? []).map(row => [row.clientId, row]));
    return {
        ...model,
        cards: model.cards.map(card => {
            if (!linksKnown) return { ...card, ga4: blankCard(model.buckets.length, false, true) };
            if (!mapped.has(card.clientId)) return { ...card, ga4: blankCard(model.buckets.length, false, false) };
            if (!aggregateKnown) return { ...card, ga4: blankCard(model.buckets.length, true, true) };
            const row = byClient.get(card.clientId);
            if (!row) return { ...card, ga4: blankCard(model.buckets.length, true, false) };
            return { ...card, ga4: measuredCard(row, model.buckets, input.expectedPreviousDays) };
        }),
    };
}

function ga4Rankable(
    card: { name: string; ga4?: Ga4CardView | null },
    metric: 'organicSessions' | 'keyEvents',
): { name: string; reason: string | null; metrics: Record<'clicks' | 'impressions' | 'ctr' | 'position', MetricView> } {
    const ready = card.ga4 && card.ga4.mapped && !card.ga4.unavailable ? card.ga4.metrics[metric] : null;
    const view: MetricView = {
        value: ready?.value ?? null,
        previous: ready?.previous ?? null,
        change: ready?.change ?? null,
        absolute: null,
    };
    const blank: MetricView = { value: null, previous: null, change: null, absolute: null };
    return {
        name: card.name,
        reason: ready && ready.value != null ? null : 'no_data',
        metrics: { clicks: view, impressions: blank, ctr: blank, position: blank },
    };
}

export function compareGa4Cards(
    left: { name: string; ga4?: Ga4CardView | null },
    right: { name: string; ga4?: Ga4CardView | null },
    metric: 'organicSessions' | 'keyEvents',
    sort: { mode: SortMode; direction: SortDirection },
): number {
    return compareCards(ga4Rankable(left, metric), ga4Rankable(right, metric), {
        mode: sort.mode,
        metric: 'clicks',
        direction: sort.direction,
    });
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function num(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return null;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Null stays null. A negative or non-numeric measurement rejects the payload. */
function optionalCount(value: unknown): number | null {
    if (value == null) return null;
    const parsed = num(value);
    if (parsed == null || parsed < 0) throw new Error('Invalid GA4 aggregate');
    return parsed;
}

function period(value: unknown): Ga4Period {
    const row = record(value);
    const days = num(row?.days);
    if (!row || days == null || days <= 0) throw new Error('Invalid GA4 aggregate');
    return {
        organicSessions: optionalCount(row.organicSessions),
        sessions: optionalCount(row.sessions),
        engagedSessions: optionalCount(row.engagedSessions),
        keyEvents: optionalCount(row.keyEvents),
        days,
    };
}

/** Reject a payload that is missing pieces instead of turning them into zeros. */
export function parseGa4Aggregate(value: unknown): Ga4Aggregate {
    const body = record(value);
    if (!body || !Array.isArray(body.current) || !Array.isArray(body.previous) || !Array.isArray(body.series)) {
        throw new Error('Invalid GA4 aggregate');
    }
    const current = new Map<string, Ga4Period>();
    const previous = new Map<string, Ga4Period>();
    const series = new Map<string, Ga4Point[]>();
    for (const item of body.current) {
        const row = record(item);
        const clientId = text(row?.clientId);
        if (!clientId) throw new Error('Invalid GA4 aggregate');
        current.set(clientId, period(row));
    }
    for (const item of body.previous) {
        const row = record(item);
        const clientId = text(row?.clientId);
        if (!clientId) throw new Error('Invalid GA4 aggregate');
        previous.set(clientId, period(row));
    }
    for (const item of body.series) {
        const row = record(item);
        const clientId = text(row?.clientId);
        const bucket = text(row?.bucket)?.slice(0, 10) ?? null;
        if (!clientId || !bucket) throw new Error('Invalid GA4 aggregate');
        const list = series.get(clientId) ?? [];
        list.push({
            bucket,
            organicSessions: optionalCount(row?.organicSessions),
            keyEvents: optionalCount(row?.keyEvents),
        });
        series.set(clientId, list);
    }
    const ids = new Set([...current.keys(), ...previous.keys(), ...series.keys()]);
    return {
        clients: [...ids].map(clientId => ({
            clientId,
            current: current.get(clientId) ?? null,
            previous: previous.get(clientId) ?? null,
            series: series.get(clientId) ?? [],
        })),
    };
}
