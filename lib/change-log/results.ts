import { headlineFields, nextCheck } from './list';
import { dataReadyOn } from './schedule';
import type { CheckpointDays } from './thresholds';
import { formatDayWithYear } from './time';
import {
    KPI_LABEL,
    type ImpactModel,
    type Kpi,
    type MetricRead,
    type QueryCompare,
} from './types';

export type ResultsMetric = 'clicks' | 'impressions' | 'ctr' | 'avg_position' | 'rest_clicks';
export type ResultsKind = 'daily' | 'rate' | 'position';
export type ChangeTone = 'good' | 'bad' | 'flat' | 'missing';

export interface ResultsRow {
    id: ResultsMetric;
    label: string;
    /** Plain note such as "Lower is better". Null when the row needs none. */
    note: string | null;
    watched: boolean;
    /** Null when that side was not measured. A real zero stays 0. */
    before: number | null;
    after: number | null;
    /**
     * Relative change, (after − before) / |before|.
     * Null when either side is missing, or when before is 0 and after is not.
     * Both zeros are 0, not a made-up percent.
     */
    change: number | null;
    lowerIsBetter: boolean;
    kind: ResultsKind;
}

export interface ResultsNotReady {
    days: CheckpointDays;
    dueOn: string;
    /** Exactly the due date plus the Google lag. */
    dataReadyOn: string;
}

export interface ResultsTableModel {
    /** A finished check supplies the After column. */
    ready: boolean;
    /** Latest finished check. Null when none has finished. */
    days: CheckpointDays | null;
    /** True only for a finished check whose counts are still small. */
    lowData: boolean;
    notReady: ResultsNotReady | null;
    rows: ResultsRow[];
}

export const EARLY_ESTIMATE_NOTE = 'Early estimate. These numbers come from a small amount of data.';

const ROWS: Array<{
    id: ResultsMetric;
    label: string;
    note: string | null;
    kpi: Kpi | null;
    kind: ResultsKind;
    lowerIsBetter: boolean;
}> = [
    { id: 'clicks', label: 'Clicks', note: null, kpi: 'clicks', kind: 'daily', lowerIsBetter: false },
    { id: 'impressions', label: 'Times shown in Google', note: null, kpi: 'impressions', kind: 'daily', lowerIsBetter: false },
    { id: 'ctr', label: 'Click rate', note: null, kpi: 'ctr', kind: 'rate', lowerIsBetter: false },
    { id: 'avg_position', label: 'Average position', note: 'Lower is better', kpi: 'avg_position', kind: 'position', lowerIsBetter: true },
    { id: 'rest_clicks', label: 'Rest of the site clicks', note: null, kpi: null, kind: 'daily', lowerIsBetter: false },
];

/** Daily rate. Missing days are left out, not treated as zero. An unmeasured window is null. */
export function dailyAverage(total: number | null, daysPresent: number, measured: boolean): number | null {
    if (!measured || total == null || !Number.isFinite(total) || daysPresent <= 0) return null;
    return total / daysPresent;
}

/**
 * Relative change. Null is "we can't say", never a stand-in 0, except when
 * both sides are a real zero.
 */
export function percentChange(before: number | null, after: number | null): number | null {
    if (before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after)) return null;
    if (before === 0) return after === 0 ? 0 : null;
    return (after - before) / Math.abs(before);
}

/** Position flips the color: a lower rank number is the helpful direction. */
export function changeTone(change: number | null, lowerIsBetter: boolean): ChangeTone {
    if (change == null || !Number.isFinite(change)) return 'missing';
    const points = Math.round(change * 1000) / 10;
    if (points === 0) return 'flat';
    const helpful = lowerIsBetter ? points < 0 : points > 0;
    return helpful ? 'good' : 'bad';
}

export function formatResultsValue(kind: ResultsKind, value: number | null): string {
    if (value == null || !Number.isFinite(value)) return '—';
    if (kind === 'rate') return `${(value * 100).toFixed(2)}%`;
    if (kind === 'position') return value.toFixed(1);
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded)
        ? new Intl.NumberFormat('en-US').format(rounded)
        : rounded.toFixed(1);
}

export function formatChangePercent(change: number | null): string {
    if (change == null || !Number.isFinite(change)) return '—';
    const points = Math.round(change * 1000) / 10;
    if (points === 0) return '0%';
    const body = Number.isInteger(points) ? String(Math.abs(points)) : Math.abs(points).toFixed(1);
    return `${points > 0 ? '+' : '−'}${body}%`;
}

export function notReadyCopy(notReady: ResultsNotReady | null): string | null {
    if (!notReady) return null;
    return `Not ready yet. The ${notReady.days}-day check is due ${formatDayWithYear(notReady.dueOn)}. Google's numbers are ready around ${formatDayWithYear(notReady.dataReadyOn)}.`;
}

/**
 * Plain caption for the indexed chart.
 * Null when there is nothing to compare, so the page does not render an empty line.
 */
export function chartCaption(controlLabel: string): string | null {
    if (controlLabel === 'No comparison') return null;
    return "Compared with the rest of the site. 100 = the page's normal level before the change.";
}

export const TERM_NOT_REPORTED = '— not reported yet';

export const TERMS_EMPTY_COPY = {
    none: 'No search terms were saved on this change.',
    unmeasured: "These terms haven't been reported yet.",
} as const;

export const TERMS_MISSING_NOTE = "— not reported yet means that term wasn't measured for that period. It isn't zero.";

export type TermsEmpty = keyof typeof TERMS_EMPTY_COPY;

/** A measured zero stays 0. An unmeasured side stays null and reads as not reported. */
export function formatTermValue(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return TERM_NOT_REPORTED;
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded)
        ? new Intl.NumberFormat('en-US').format(rounded)
        : rounded.toFixed(1);
}

export function searchTermsEmpty(queries: readonly QueryCompare[]): TermsEmpty | null {
    if (queries.length === 0) return 'none';
    const measured = queries.some(query => (
        query.beforeClicks != null || query.afterClicks != null
        || query.beforeImpressions != null || query.afterImpressions != null
        || query.beforePosition != null || query.afterPosition != null
    ));
    return measured ? null : 'unmeasured';
}

export function termsHaveGaps(queries: readonly QueryCompare[]): boolean {
    return queries.some(query => (
        query.beforeClicks == null || query.afterClicks == null
        || query.beforeImpressions == null || query.afterImpressions == null
        || query.beforePosition == null || query.afterPosition == null
    ));
}

export function answerLine(
    kpi: Kpi,
    impact: Pick<ImpactModel, 'headline' | 'liveOn' | 'finalThrough'>,
): string {
    const head = impact.headline;
    if (!head.ready) {
        const upcoming = nextCheck(impact.liveOn, impact.finalThrough);
        if (upcoming.nextCheckOn && upcoming.nextCheckDays != null) {
            const readyOn = dataReadyOn(upcoming.nextCheckOn);
            const due = formatDayWithYear(upcoming.nextCheckOn);
            if (readyOn) {
                return `Too early to tell. The ${upcoming.nextCheckDays}-day check is due ${due}. Google's numbers are ready around ${formatDayWithYear(readyOn)}.`;
            }
            return `Too early to tell. The ${upcoming.nextCheckDays}-day check is due ${due}.`;
        }
        return head.note;
    }
    const pct = headlineFields(head).headlinePct;
    if (pct == null) return head.note;
    const name = KPI_LABEL[kpi];
    const amount = absPercent(pct);
    let sentence: string;
    if (pct === 0) {
        sentence = `${name} matches pages we didn't change, ${head.days} days after going live.`;
    } else if (kpi === 'avg_position') {
        sentence = pct > 0
            ? `${name} is ahead of pages we didn't change by ${amount}%, ${head.days} days after going live.`
            : `${name} is behind pages we didn't change by ${amount}%, ${head.days} days after going live.`;
    } else {
        const verb = kpi === 'ctr' ? 'is' : 'are';
        sentence = `${name} ${verb} ${pct > 0 ? 'up' : 'down'} ${amount}% compared with pages we didn't change, ${head.days} days after going live.`;
    }
    if (head.estimate || head.days < 28) return `${sentence} It's an early sign.`;
    return sentence;
}

function absPercent(pct: number): string {
    const rounded = Math.round(Math.abs(pct) * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Before is the 28 days before go-live. After is the latest finished check.
 * Counts are daily averages. Click rate and position stay window rates.
 * Nothing here is filled in with zero.
 */
export function buildResultsTable(impact: ImpactModel): ResultsTableModel {
    const head = impact.headline;
    const ready = head.ready;
    const notReady = ready ? null : unfinished(impact);
    return {
        ready,
        days: ready ? head.days : null,
        lowData: ready && head.lowData,
        notReady,
        rows: ROWS.map(spec => {
            const before = readSide(spec.id, spec.id === 'rest_clicks' ? impact.baselineControl : impact.baseline);
            const after = ready
                ? readSide(spec.id, spec.id === 'rest_clicks' ? head.restOfSite : head.page)
                : null;
            return {
                id: spec.id,
                label: spec.label,
                note: spec.note,
                watched: spec.kpi != null && spec.kpi === impact.kpi,
                before,
                after,
                change: percentChange(before, after),
                lowerIsBetter: spec.lowerIsBetter,
                kind: spec.kind,
            };
        }),
    };
}

function unfinished(impact: ImpactModel): ResultsNotReady | null {
    const upcoming = nextCheck(impact.liveOn, impact.finalThrough);
    if (!upcoming.nextCheckOn || upcoming.nextCheckDays == null) return null;
    const readyOn = dataReadyOn(upcoming.nextCheckOn);
    if (!readyOn) return null;
    return { days: upcoming.nextCheckDays, dueOn: upcoming.nextCheckOn, dataReadyOn: readyOn };
}

function readSide(id: ResultsMetric, read: MetricRead | null): number | null {
    if (!read?.measured) return null;
    if (id === 'clicks' || id === 'rest_clicks') return dailyAverage(read.clicks, read.daysPresent, true);
    if (id === 'impressions') return dailyAverage(read.impressions, read.daysPresent, true);
    if (id === 'ctr') return read.ctr;
    return read.position;
}
