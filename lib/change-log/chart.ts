import { dateOffset } from '@/lib/gsc/history';
import { eachDate } from '@/lib/search-reporting/range';

import { BASELINE_DAYS, GSC_LAG_DAYS } from './thresholds';

/** Metrics the day-by-day chart can plot. Counts stay in their own units. */
export const CHART_METRICS = ['clicks', 'impressions', 'ctr', 'avg_position'] as const;
export type ChartMetric = (typeof CHART_METRICS)[number];

export const CHART_METRIC_LABEL: Record<ChartMetric, string> = {
    clicks: 'Clicks',
    impressions: 'Times shown in Google',
    ctr: 'Click rate',
    avg_position: 'Average position',
};

export const LAG_LABEL = "Waiting for Google's data";
export const WEEKLY_NOTE = "Showing weekly totals, in groups of 7 days. There isn't enough day-by-day data yet.";
export const REVERSED_NOTE = 'Higher on the chart is better.';
export const ALIGNED_NOTE = 'The 28 days before this went live, lined up with the 28 days after. Day 1 is the start of each window.';
export const ALIGNED_WEEKLY_NOTE = "Weekly totals, lined up. Week 1 is the start of each window. There isn't enough day-by-day data yet.";

/** A stored day. Days that were not stored are omitted, never passed in as zero. */
export interface MeasuredDay {
    date: string;
    clicks: number;
    impressions: number;
    position: number;
}

export interface ChartMarkerInput {
    id: string;
    title: string;
    liveOn: string;
    pageKeys: readonly string[];
}

export interface ChartMarker {
    id: string;
    title: string;
    liveOn: string;
}

export interface PlottedPoint {
    date: string;
    /** UTC midnight, so the axis is a real calendar, not a list of categories. */
    time: number;
    /** Null is a gap. Zero is a measured zero. */
    value: number | null;
    beforeAverage: number | null;
    afterAverage: number | null;
}

export interface PlottedMarker {
    id: string;
    title: string;
    date: string;
    time: number;
    /** Where the dot sits so it can be seen. The tooltip names the change, not this number. */
    value: number;
}

export interface DailyChartModel {
    metric: ChartMetric;
    title: string;
    points: PlottedPoint[];
    reversed: boolean;
    reversedNote: string | null;
    weekly: boolean;
    weeklyNote: string | null;
    lagStart: string | null;
    lagEnd: string | null;
    lagLabel: string;
    wentLive: string;
    wentLiveTime: number;
    markers: PlottedMarker[];
    beforeAverage: number | null;
    afterAverage: number | null;
}

export interface AlignedPoint {
    day: number;
    before: number | null;
    after: number | null;
}

export interface AlignedChartModel {
    points: AlignedPoint[];
    weekly: boolean;
    note: string;
    reversed: boolean;
    reversedNote: string | null;
    /**
     * Overlay lines both start at day 1. There is no went-live marker.
     * Timeline keeps that marker; this view does not.
     */
    wentLiveMarker: false;
}

export interface IndexedPoint {
    date: string;
    time: number;
    page: number | null;
    control: number | null;
}

/** Overlay heading. The two windows share a day number, so this is not a calendar timeline. */
export function overlayChartTitle(metric: ChartMetric, weekly = false): string {
    const base = dailyChartTitle(metric, false).replace(', day by day', '');
    return weekly ? `${base}, weekly` : `${base}, before and after`;
}

export function dailyChartTitle(metric: ChartMetric, weekly = false): string {
    const cadence = weekly ? 'week by week' : 'day by day';
    if (metric === 'clicks') return `Clicks from Google, ${cadence}`;
    if (metric === 'impressions') return `Times shown in Google, ${cadence}`;
    if (metric === 'ctr') return `Click rate from Google, ${cadence}`;
    return `Average position from Google, ${cadence}`;
}

export function dayTime(iso: string): number {
    const [year, month, day] = iso.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

export function chartDomain(liveOn: string, finalThrough: string): { start: string; end: string } {
    const start = dateOffset(liveOn, -BASELINE_DAYS);
    const windowEnd = dateOffset(liveOn, 55);
    const lagEnd = dateOffset(finalThrough, GSC_LAG_DAYS);
    const end = windowEnd < lagEnd ? windowEnd : lagEnd;
    return { start, end: end < start ? start : end };
}

/** The last GSC_LAG_DAYS, clipped to the chart. Null when that wait sits outside the window. */
export function lagWindow(
    finalThrough: string,
    domain: { start: string; end: string },
): { start: string; end: string } | null {
    const start = dateOffset(finalThrough, 1);
    const end = dateOffset(finalThrough, GSC_LAG_DAYS);
    if (end < domain.start || start > domain.end) return null;
    const clippedStart = start < domain.start ? domain.start : start;
    const clippedEnd = end > domain.end ? domain.end : end;
    if (clippedStart > clippedEnd) return null;
    return { start: clippedStart, end: clippedEnd };
}

function metricValue(day: MeasuredDay, metric: ChartMetric): number | null {
    if (metric === 'clicks') return day.clicks;
    if (metric === 'impressions') return day.impressions;
    if (day.impressions <= 0) return null;
    if (metric === 'ctr') return day.clicks / day.impressions;
    return day.position;
}

function mean(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Index baseline. A zero total cannot be the base, matching the chart this view replaces. */
function indexBase(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const total = values.reduce((sum, value) => sum + value, 0);
    return total === 0 ? null : total / values.length;
}

function weekValue(days: readonly MeasuredDay[], metric: ChartMetric): number | null {
    if (days.length === 0) return null;
    if (metric === 'clicks') return days.reduce((sum, day) => sum + day.clicks, 0);
    if (metric === 'impressions') return days.reduce((sum, day) => sum + day.impressions, 0);
    const impressions = days.reduce((sum, day) => sum + day.impressions, 0);
    if (impressions <= 0) return null;
    if (metric === 'ctr') return days.reduce((sum, day) => sum + day.clicks, 0) / impressions;
    const weighted = days.reduce((sum, day) => sum + day.position * day.impressions, 0);
    return weighted / impressions;
}

function weeklyBuckets(
    dates: readonly string[],
    byDate: ReadonlyMap<string, MeasuredDay>,
    metric: ChartMetric,
): Array<{ date: string; value: number | null }> {
    const buckets: Array<{ date: string; value: number | null }> = [];
    for (let index = 0; index < dates.length; index += 7) {
        const week = dates.slice(index, index + 7);
        const measured = week.flatMap(date => {
            const day = byDate.get(date);
            return day ? [day] : [];
        });
        buckets.push({ date: week[0], value: weekValue(measured, metric) });
    }
    return buckets;
}

function placeMarkers(
    markers: readonly ChartMarker[],
    domain: { start: string; end: string },
    points: readonly PlottedPoint[],
    liveOn: string,
    beforeAverage: number | null,
    afterAverage: number | null,
): PlottedMarker[] {
    const grouped = new Map<string, ChartMarker[]>();
    for (const marker of markers) {
        if (marker.liveOn < domain.start || marker.liveOn > domain.end) continue;
        const list = grouped.get(marker.liveOn) ?? [];
        list.push(marker);
        grouped.set(marker.liveOn, list);
    }
    const placed: PlottedMarker[] = [];
    for (const [date, group] of grouped) {
        const point = points.find(item => item.date === date);
        const value = point?.value ?? (date < liveOn ? beforeAverage : afterAverage);
        if (value == null) continue;
        placed.push({
            id: group.map(item => item.id).join(','),
            title: group.map(item => item.title).join(' · '),
            date,
            time: dayTime(date),
            value,
        });
    }
    return placed;
}

export function buildDailyChart(input: {
    metric: ChartMetric;
    liveOn: string;
    finalThrough: string;
    days: readonly MeasuredDay[];
    lowData: boolean;
    markers?: readonly ChartMarker[];
}): DailyChartModel {
    const domain = chartDomain(input.liveOn, input.finalThrough);
    const lag = lagWindow(input.finalThrough, domain);
    const byDate = new Map<string, MeasuredDay>();
    for (const day of input.days) {
        if (day.date < domain.start || day.date > domain.end || day.date > input.finalThrough) continue;
        byDate.set(day.date, day);
    }
    const calendar = eachDate(domain.start, domain.end);
    const beforeDates = calendar.filter(date => date < input.liveOn);
    const afterDates = calendar.filter(date => date >= input.liveOn && date <= input.finalThrough);
    let plotted: Array<{ date: string; value: number | null }>;
    if (input.lowData) {
        plotted = [
            ...weeklyBuckets(beforeDates, byDate, input.metric),
            ...weeklyBuckets(afterDates, byDate, input.metric),
        ];
        if (lag && (plotted.length === 0 || plotted[plotted.length - 1].date < lag.end)) {
            plotted = [...plotted, { date: lag.end, value: null }];
        }
    } else {
        plotted = calendar.map(date => {
            if (date > input.finalThrough) return { date, value: null };
            const day = byDate.get(date);
            return { date, value: day ? metricValue(day, input.metric) : null };
        });
    }
    const beforeValues = plotted.flatMap(point => point.date < input.liveOn && point.value != null ? [point.value] : []);
    const afterValues = plotted.flatMap(point => (
        point.date >= input.liveOn && point.date <= input.finalThrough && point.value != null ? [point.value] : []
    ));
    const beforeAverage = mean(beforeValues);
    const afterAverage = mean(afterValues);
    const points = plotted.map(point => ({
        date: point.date,
        time: dayTime(point.date),
        value: point.value,
        beforeAverage: point.date < input.liveOn && beforeAverage != null ? beforeAverage : null,
        afterAverage: point.date >= input.liveOn && point.date <= input.finalThrough && afterAverage != null ? afterAverage : null,
    }));
    return {
        metric: input.metric,
        title: dailyChartTitle(input.metric, input.lowData),
        points,
        reversed: input.metric === 'avg_position',
        reversedNote: input.metric === 'avg_position' ? REVERSED_NOTE : null,
        weekly: input.lowData,
        weeklyNote: input.lowData ? WEEKLY_NOTE : null,
        lagStart: lag?.start ?? null,
        lagEnd: lag?.end ?? null,
        lagLabel: LAG_LABEL,
        wentLive: input.liveOn,
        wentLiveTime: dayTime(input.liveOn),
        markers: placeMarkers(input.markers ?? [], domain, points, input.liveOn, beforeAverage, afterAverage),
        beforeAverage,
        afterAverage,
    };
}

export function buildSideBySide(input: {
    metric: ChartMetric;
    liveOn: string;
    finalThrough: string;
    days: readonly MeasuredDay[];
    lowData: boolean;
}): AlignedChartModel {
    const byDate = new Map<string, MeasuredDay>();
    for (const day of input.days) {
        if (day.date <= input.finalThrough) byDate.set(day.date, day);
    }
    const beforeDates = eachDate(dateOffset(input.liveOn, -BASELINE_DAYS), dateOffset(input.liveOn, -1));
    const afterDates = eachDate(input.liveOn, dateOffset(input.liveOn, BASELINE_DAYS - 1));
    const reversed = input.metric === 'avg_position';
    const reversedNote = reversed ? REVERSED_NOTE : null;
    if (input.lowData) {
        const beforeWeeks = weeklyBuckets(beforeDates, byDate, input.metric);
        const afterWeeks = weeklyBuckets(afterDates, byDate, input.metric);
        return {
            points: beforeWeeks.map((week, index) => ({
                day: index + 1,
                before: week.value,
                after: afterWeeks[index]?.value ?? null,
            })),
            weekly: true,
            note: ALIGNED_WEEKLY_NOTE,
            reversed,
            reversedNote,
            wentLiveMarker: false,
        };
    }
    return {
        points: beforeDates.map((date, index) => {
            const afterDate = afterDates[index];
            const before = byDate.get(date);
            const after = afterDate && afterDate <= input.finalThrough ? byDate.get(afterDate) : undefined;
            return {
                day: index + 1,
                before: before ? metricValue(before, input.metric) : null,
                after: after ? metricValue(after, input.metric) : null,
            };
        }),
        weekly: false,
        note: ALIGNED_NOTE,
        reversed,
        reversedNote,
        wentLiveMarker: false,
    };
}

/**
 * Both lines start at 100 so a small page can be read next to the rest of the site.
 * Missing days stay null. They are not filled in.
 */
export function indexToBaseline(
    points: readonly { date: string; page: number | null; control: number | null }[],
    liveOn: string,
): { points: IndexedPoint[]; hasControl: boolean } {
    const pageBase = indexBase(points.flatMap(point => point.date < liveOn && point.page != null ? [point.page] : []));
    const controlBase = indexBase(points.flatMap(point => point.date < liveOn && point.control != null ? [point.control] : []));
    const indexed = points.map(point => ({
        date: point.date,
        time: dayTime(point.date),
        page: point.page == null || pageBase == null ? null : (point.page / pageBase) * 100,
        control: point.control == null || controlBase == null ? null : (point.control / controlBase) * 100,
    }));
    return { points: indexed, hasControl: indexed.some(point => point.control != null) };
}

/** Other logged changes that touch one of this change's pages. */
export function samePageMarkers(
    focus: { id: string; pageKeys: readonly string[] },
    others: readonly ChartMarkerInput[],
): ChartMarker[] {
    const keys = new Set(focus.pageKeys.filter(key => key.length > 0));
    return others
        .filter(change => change.id !== focus.id && change.pageKeys.some(key => keys.has(key)))
        .map(change => ({ id: change.id, title: change.title, liveOn: change.liveOn }))
        .sort((a, b) => a.liveOn.localeCompare(b.liveOn) || a.title.localeCompare(b.title));
}

export function measuredDaysFromSeries(points: readonly {
    date: string;
    preliminary?: boolean;
    clicks: number | null;
    impressions: number | null;
    position: number | null;
}[]): MeasuredDay[] {
    return points.flatMap(point => {
        if (point.preliminary || point.clicks == null || point.impressions == null) return [];
        return [{
            date: point.date,
            clicks: point.clicks,
            impressions: point.impressions,
            position: point.position ?? 0,
        }];
    });
}
