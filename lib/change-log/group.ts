import { dailyAverage, percentChange, type ResultsKind } from './results';
import { type CheckpointDays } from './thresholds';
import { afterWindow, baselineWindow } from './time';
import type { DayPoint, ImpactModel, MetricRead, PageImpactRow } from './types';
import { sumWindow } from './metrics';

export const GROUP_SUMMARY_NOTE = 'Control period is the 28 days before this went live. Test period is the latest finished check. Counts are per day. Click rate and average position are for the whole period.';

export interface GroupSummaryRow {
    id: 'clicks' | 'site_clicks' | 'impressions' | 'avg_position' | 'ctr';
    label: string;
    /** Short qualifier such as "Lower is better". Null when the row needs none. */
    note: string | null;
    before: number | null;
    after: number | null;
    change: number | null;
    lowerIsBetter: boolean;
    kind: ResultsKind;
}

export interface GroupSummary {
    ready: boolean;
    days: CheckpointDays | null;
    rows: GroupSummaryRow[];
}

const SUMMARY: Array<{
    id: GroupSummaryRow['id'];
    label: string;
    note: string | null;
    kind: ResultsKind;
    lowerIsBetter: boolean;
    site: boolean;
    daily: boolean;
}> = [
    { id: 'clicks', label: 'Clicks per day', note: null, kind: 'daily', lowerIsBetter: false, site: false, daily: true },
    { id: 'site_clicks', label: 'Site clicks per day', note: 'Whole site, including these pages.', kind: 'daily', lowerIsBetter: false, site: true, daily: true },
    { id: 'impressions', label: 'Impressions per day', note: null, kind: 'daily', lowerIsBetter: false, site: false, daily: true },
    { id: 'avg_position', label: 'Average position', note: 'Lower is better', kind: 'position', lowerIsBetter: true, site: false, daily: false },
    { id: 'ctr', label: 'Click rate', note: null, kind: 'rate', lowerIsBetter: false, site: false, daily: false },
];

/**
 * Group summary. Page rows are the changed URLs added together.
 * Site clicks are the sitewide series already used to build the control,
 * not a new comparison and not the untouched remainder.
 */
export function buildGroupSummary(impact: ImpactModel): GroupSummary {
    const ready = impact.headline.ready;
    return {
        ready,
        days: ready ? impact.headline.days : null,
        rows: SUMMARY.map(spec => {
            const beforeRead = spec.site ? impact.baselineSite : impact.baseline;
            const afterRead = ready
                ? (spec.site ? impact.headline.sitewide : impact.headline.page)
                : null;
            const before = readMetric(spec, beforeRead);
            const after = readMetric(spec, afterRead);
            return {
                id: spec.id,
                label: spec.label,
                note: spec.note,
                before,
                after,
                change: percentChange(before, after),
                lowerIsBetter: spec.lowerIsBetter,
                kind: spec.kind,
            };
        }),
    };
}

function readMetric(
    spec: { daily: boolean; id: GroupSummaryRow['id'] },
    read: MetricRead | null,
): number | null {
    if (!read?.measured) return null;
    if (spec.id === 'clicks' || spec.id === 'site_clicks') return dailyAverage(read.clicks, read.daysPresent, true);
    if (spec.id === 'impressions') return dailyAverage(read.impressions, read.daysPresent, true);
    if (spec.id === 'ctr') return read.ctr;
    return read.position;
}

/**
 * One row per logged URL. Change percents use the same before/after windows
 * as the group summary. An unmeasured side stays null. A measured zero stays 0.
 * No verdict badge: the group keeps the one result on the change.
 */
export function buildPageImpactRows(input: {
    pages: readonly { url: string; label: string }[];
    series: readonly (readonly DayPoint[])[];
    liveOn: string;
    finalThrough: string;
    afterDays: CheckpointDays | null;
}): PageImpactRow[] {
    const beforeSpan = baselineWindow(input.liveOn);
    const afterSpan = input.afterDays ? afterWindow(input.liveOn, input.afterDays) : null;
    return input.pages.map((page, index) => {
        const days = input.series[index] ?? [];
        const before = sumWindow(days, beforeSpan.start, beforeSpan.end, input.finalThrough);
        const after = afterSpan
            ? sumWindow(days, afterSpan.start, afterSpan.end, input.finalThrough)
            : null;
        return {
            url: page.url,
            label: page.label,
            clicksChange: percentChange(
                dailyAverage(before.clicks, before.daysPresent, before.measured),
                after ? dailyAverage(after.clicks, after.daysPresent, after.measured) : null,
            ),
            impressionsChange: percentChange(
                dailyAverage(before.impressions, before.daysPresent, before.measured),
                after ? dailyAverage(after.impressions, after.daysPresent, after.measured) : null,
            ),
            positionChange: percentChange(
                before.measured ? before.position : null,
                after?.measured ? after.position : null,
            ),
            ctrChange: percentChange(
                before.measured ? before.ctr : null,
                after?.measured ? after.ctr : null,
            ),
        };
    });
}

/** Add page-level days into one series. Position stays impression-weighted. */
export function sumDaySeries(series: readonly (readonly DayPoint[])[]): DayPoint[] {
    const grouped = new Map<string, DayPoint>();
    for (const days of series) {
        for (const day of days) {
            const current = grouped.get(day.date);
            if (!current) {
                grouped.set(day.date, { ...day });
                continue;
            }
            const impressions = current.impressions + day.impressions;
            const weighted = current.position * current.impressions + day.position * day.impressions;
            current.clicks += day.clicks;
            current.impressions = impressions;
            current.position = impressions > 0 ? weighted / impressions : 0;
            current.organicSessions = addNullable(current.organicSessions, day.organicSessions);
            current.keyEvents = addNullable(current.keyEvents, day.keyEvents);
            current.preliminary = Boolean(current.preliminary || day.preliminary);
        }
    }
    return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function addNullable(left: number | null, right: number | null): number | null {
    if (left == null) return right;
    if (right == null) return left;
    return left + right;
}
