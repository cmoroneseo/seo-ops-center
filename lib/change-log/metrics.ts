import { eachDate } from '@/lib/search-reporting/range';
import { sumMetrics } from '@/lib/search-reporting/metrics';

import type { DayPoint, Kpi, MetricRead, RateDelta } from './types';

const EMPTY: MetricRead = {
    measured: false,
    clicks: 0,
    impressions: 0,
    ctr: null,
    position: null,
    organicSessions: null,
    keyEvents: null,
    daysPresent: 0,
    daysExpected: 0,
};

export function isGaKpi(kpi: Kpi): boolean {
    return kpi === 'organic_sessions' || kpi === 'key_events';
}

export function kpiNumber(read: MetricRead, kpi: Kpi): number | null {
    if (!read.measured) return null;
    switch (kpi) {
        case 'clicks':
            return read.clicks;
        case 'impressions':
            return read.impressions;
        case 'ctr':
            return read.ctr;
        case 'avg_position':
            return read.position;
        case 'organic_sessions':
            return read.organicSessions;
        case 'key_events':
            return read.keyEvents;
        default: {
            const never: never = kpi;
            return never;
        }
    }
}

export function dayKpi(day: DayPoint, kpi: Kpi): number | null {
    switch (kpi) {
        case 'clicks':
            return day.clicks;
        case 'impressions':
            return day.impressions;
        case 'ctr':
            return day.impressions > 0 ? day.clicks / day.impressions : null;
        case 'avg_position':
            return day.impressions > 0 ? day.position : null;
        case 'organic_sessions':
            return day.organicSessions;
        case 'key_events':
            return day.keyEvents;
        default: {
            const never: never = kpi;
            return never;
        }
    }
}

function addNullable(values: Array<number | null>): number | null {
    const nums = values.filter((value): value is number => value != null && Number.isFinite(value));
    if (nums.length === 0) return null;
    return nums.reduce((sum, value) => sum + value, 0);
}

/**
 * Sum a closed date range. Days after `finalThroughDate`, preliminary days,
 * and days with no row are left out. They are not counted as zero.
 */
export function sumWindow(
    days: readonly DayPoint[],
    start: string,
    end: string,
    finalThroughDate: string,
): MetricRead {
    const byDate = new Map(days.map(day => [day.date, day]));
    const rows: DayPoint[] = [];
    let expected = 0;
    for (const date of eachDate(start, end)) {
        expected += 1;
        if (date > finalThroughDate) continue;
        const day = byDate.get(date);
        if (!day || day.preliminary) continue;
        rows.push(day);
    }
    if (rows.length === 0) return { ...EMPTY, daysExpected: expected };
    const gsc = sumMetrics(rows.map(row => ({
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
    })));
    return {
        measured: true,
        clicks: gsc.clicks,
        impressions: gsc.impressions,
        ctr: gsc.ctr,
        position: gsc.position,
        organicSessions: addNullable(rows.map(row => row.organicSessions)),
        keyEvents: addNullable(rows.map(row => row.keyEvents)),
        daysPresent: rows.length,
        daysExpected: expected,
    };
}

export function rateDelta(before: number | null, after: number | null, lowerIsBetter: boolean): RateDelta {
    if (before == null || after == null) {
        return { helpful: null, absolute: null, before, after, fromZero: false };
    }
    const absolute = after - before;
    if (before === 0) {
        return {
            helpful: after === 0 ? 0 : null,
            absolute,
            before,
            after,
            fromZero: after !== 0,
        };
    }
    const raw = (after - before) / Math.abs(before);
    return {
        helpful: lowerIsBetter ? -raw : raw,
        absolute,
        before,
        after,
        fromZero: false,
    };
}

/**
 * Counts are compared as a daily rate so a 7-day window is not scored
 * against a 28-day total. CTR and position are already window rates.
 */
export function comparable(kpi: Kpi, read: MetricRead): number | null {
    const value = kpiNumber(read, kpi);
    if (value == null || !read.measured) return null;
    if (kpi === 'ctr' || kpi === 'avg_position') return value;
    if (read.daysPresent <= 0) return null;
    return value / read.daysPresent;
}

export function moveFor(kpi: Kpi, before: MetricRead, after: MetricRead): RateDelta {
    return rateDelta(comparable(kpi, before), comparable(kpi, after), kpi === 'avg_position');
}
