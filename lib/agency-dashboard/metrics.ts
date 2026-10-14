/** Portfolio math. Missing history stays null. A stored zero is a real zero. */

export const METRICS = ['clicks', 'impressions', 'ctr', 'position'] as const;
export type MetricKey = typeof METRICS[number];

export const METRIC_LABEL: Record<MetricKey, string> = {
    clicks: 'Clicks',
    impressions: 'Impressions',
    ctr: 'CTR',
    position: 'Avg. position',
};

/** Shown on the position label. The number is sum(position × impressions) / impressions. */
export const POSITION_LABEL_TITLE = 'Impression-weighted average';

export interface Totals {
    clicks: number;
    impressions: number;
    /** Sum of daily position × impressions. Null when the period has no impressions. */
    positionWeight: number | null;
    days: number;
}

export interface MetricView {
    value: number | null;
    previous: number | null;
    /** Fraction. +0.042 is +4.2%. Null when a percent would be invented. */
    change: number | null;
    /** Current minus previous. For position, negative means the rank improved. */
    absolute: number | null;
}

export interface SeriesPoint {
    bucket: string;
    clicks: number;
    impressions: number;
    positionWeight: number | null;
}

export type SortMode = 'declines' | 'metric';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
    mode: SortMode;
    metric: MetricKey;
    direction: SortDirection;
}

export function emptyTotals(): Totals {
    return { clicks: 0, impressions: 0, positionWeight: null, days: 0 };
}

export function addTotals(left: Totals, right: Totals): Totals {
    const weights = [left.positionWeight, right.positionWeight].filter((value): value is number => value != null);
    return {
        clicks: left.clicks + right.clicks,
        impressions: left.impressions + right.impressions,
        positionWeight: weights.length ? weights.reduce((sum, value) => sum + value, 0) : null,
        days: left.days + right.days,
    };
}

/** Clicks and impressions can be zero. CTR and position need impressions. */
export function metricValue(totals: Totals | null, metric: MetricKey): number | null {
    if (!totals || totals.days <= 0) return null;
    if (metric === 'clicks') return totals.clicks;
    if (metric === 'impressions') return totals.impressions;
    if (totals.impressions <= 0) return null;
    if (metric === 'ctr') return totals.clicks / totals.impressions;
    return totals.positionWeight == null ? null : totals.positionWeight / totals.impressions;
}

/**
 * Percent change. Previous zero with a new value has no honest percent.
 * Previous zero and current zero is a real flat change.
 */
export function percentChange(current: number | null, previous: number | null): number | null {
    if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
    if (previous === 0) return current === 0 ? 0 : null;
    return (current - previous) / Math.abs(previous);
}

export function metricView(current: Totals | null, previous: Totals | null, metric: MetricKey): MetricView {
    const value = metricValue(current, metric);
    const prior = metricValue(previous, metric);
    return {
        value,
        previous: prior,
        change: percentChange(value, prior),
        absolute: value == null || prior == null ? null : value - prior,
    };
}

/** Lower position is better. Volume metrics improve when they rise. */
export function changeIsGood(metric: MetricKey, change: number | null): boolean | null {
    if (change == null || change === 0) return null;
    return metric === 'position' ? change < 0 : change > 0;
}

export type Tone = 'up' | 'down' | 'flat';

export function changeTone(metric: MetricKey, change: number | null): Tone {
    const good = changeIsGood(metric, change);
    if (good == null) return 'flat';
    return good ? 'up' : 'down';
}

/** 0 is no wash. 4 is the strongest tint. */
export function tintStrength(change: number | null): 0 | 1 | 2 | 3 | 4 {
    if (change == null) return 0;
    const magnitude = Math.abs(change);
    if (magnitude < 0.005) return 0;
    if (magnitude < 0.02) return 1;
    if (magnitude < 0.08) return 2;
    if (magnitude < 0.2) return 3;
    return 4;
}

export function cardTint(metric: MetricKey, change: number | null): { tone: Tone; strength: 0 | 1 | 2 | 3 | 4 } {
    const strength = tintStrength(change);
    return { tone: strength === 0 ? 'flat' : changeTone(metric, change), strength };
}

export function alignSeries(spine: readonly string[], points: readonly SeriesPoint[], metric: MetricKey): Array<number | null> {
    const byBucket = new Map(points.map(point => [point.bucket, point]));
    return spine.map(bucket => {
        const point = byBucket.get(bucket);
        if (!point) return null;
        return metricValue({ ...point, days: 1 }, metric);
    });
}

export function sumSeries(spine: readonly string[], rows: readonly { points: readonly SeriesPoint[] }[]): Array<SeriesPoint | null> {
    return spine.map(bucket => {
        const matches = rows.flatMap(row => row.points.filter(point => point.bucket === bucket));
        if (matches.length === 0) return null;
        return matches.reduce<SeriesPoint>((total, point) => ({
            bucket,
            clicks: total.clicks + point.clicks,
            impressions: total.impressions + point.impressions,
            positionWeight: point.positionWeight == null
                ? total.positionWeight
                : (total.positionWeight ?? 0) + point.positionWeight,
        }), { bucket, clicks: 0, impressions: 0, positionWeight: null });
    });
}

/** Bigger score is a worse move. Position rising is a decline. */
export function declineScore(metric: MetricKey, change: number | null): number | null {
    if (change == null) return null;
    return metric === 'position' ? change : -change;
}

export function formatCompact(value: number): string {
    const absolute = Math.abs(value);
    if (absolute >= 1_000_000) {
        const scaled = value / 1_000_000;
        return `${trimNumber(scaled, absolute >= 10_000_000 ? 0 : 1)}M`;
    }
    if (absolute >= 10_000) {
        const scaled = value / 1_000;
        return `${trimNumber(scaled, absolute >= 100_000 ? 0 : 1)}K`;
    }
    return Math.round(value).toLocaleString('en-US');
}

function trimNumber(value: number, digits: number): string {
    const text = value.toFixed(digits);
    return digits === 0 ? text : text.replace(/\.0$/, '');
}

export function formatMetric(metric: MetricKey, value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '—';
    if (metric === 'ctr') return `${(value * 100).toFixed(1)}%`;
    if (metric === 'position') return value.toFixed(1);
    return formatCompact(value);
}

/** A non-zero value that rounds to 0.0 is "<0.1", never "-0.0". */
function signedTenths(value: number, suffix: string): string {
    const rounded = Number(value.toFixed(1));
    if (rounded === 0) {
        if (value === 0) return `0.0${suffix}`;
        return value > 0 ? `<0.1${suffix}` : `−<0.1${suffix}`;
    }
    const text = `${Math.abs(rounded).toFixed(1)}${suffix}`;
    return rounded > 0 ? `+${text}` : `-${text}`;
}

export function formatChange(change: number | null): string {
    if (change == null || !Number.isFinite(change)) return '—';
    return signedTenths(change * 100, '%');
}

export function formatAbsolute(metric: MetricKey, absolute: number | null): string {
    if (absolute == null || !Number.isFinite(absolute)) return '—';
    if (metric === 'position') return signedTenths(absolute, '');
    if (metric === 'ctr') return signedTenths(absolute * 100, ' pts');
    if (absolute === 0) return '0';
    if (Math.abs(absolute) < 0.5) return absolute > 0 ? '<1' : '−<1';
    const text = formatCompact(Math.abs(absolute));
    return absolute > 0 ? `+${text}` : `-${text}`;
}

export function gscPerformanceUrl(property: string): string {
    return `https://search.google.com/search-console/performance/search-analytics?resource_id=${encodeURIComponent(property)}`;
}

export function displayDomain(domain: string | null, property: string): string {
    const source = (domain && domain.trim()) || property || '';
    const cleaned = source
        .trim()
        .replace(/^sc-domain:/i, '')
        .replace(/^https?:\/\//i, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./i, '');
    return cleaned || '—';
}

export interface Rankable {
    name: string;
    reason: string | null;
    metrics: Record<MetricKey, MetricView>;
}

export function compareCards(left: Rankable, right: Rankable, sort: SortState): number {
    if ((left.reason == null) !== (right.reason == null)) return left.reason == null ? -1 : 1;
    if (sort.mode === 'declines') {
        const leftScore = declineScore(sort.metric, left.metrics[sort.metric].change);
        const rightScore = declineScore(sort.metric, right.metrics[sort.metric].change);
        if (leftScore == null && rightScore == null) return left.name.localeCompare(right.name);
        if (leftScore == null) return 1;
        if (rightScore == null) return -1;
        if (leftScore !== rightScore) return rightScore - leftScore;
        return left.name.localeCompare(right.name);
    }
    const leftValue = left.metrics[sort.metric].value;
    const rightValue = right.metrics[sort.metric].value;
    if (leftValue == null && rightValue == null) return left.name.localeCompare(right.name);
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    if (leftValue !== rightValue) {
        const direction = sort.direction === 'asc' ? 1 : -1;
        return (leftValue - rightValue) * direction;
    }
    return left.name.localeCompare(right.name);
}
