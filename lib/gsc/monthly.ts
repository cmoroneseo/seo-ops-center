import { dateOffset } from './history';
import { monthBounds } from '@/lib/sync/months';
import type { MetricValues } from '@/lib/sync/fetch-result';

export interface DaySnapshot {
    date: string;
    isIncomplete: boolean;
    /** A saved day with no property row is a real zero. Omit the day entirely when it was not saved. */
    property: { clicks: number; impressions: number; position: number } | null;
}

export interface MonthFinality {
    complete_through: string | null;
    days_present: number;
    days_expected: number;
    final: boolean;
}

export interface MonthlyGsc {
    data: MetricValues;
    provenance: {
        source: 'gsc_history';
        grain: 'property';
        timezone: 'America/Los_Angeles';
        range: { start: string; end: string };
        finality: MonthFinality;
        method: string;
    };
}

const METHOD = 'Sum of stored daily property totals for the Pacific calendar month. Days with no snapshot are omitted, not treated as zero.';

export function monthFinality(month: string, days: Pick<DaySnapshot, 'date' | 'isIncomplete'>[]): MonthFinality {
    const bounds = monthBounds(month);
    const byDate = new Map<string, Pick<DaySnapshot, 'date' | 'isIncomplete'>>();
    for (const day of days) {
        if (day.date < bounds.start || day.date > bounds.end) continue;
        byDate.set(day.date, day);
    }
    let completeThrough: string | null = null;
    for (let index = 0; index < bounds.days; index++) {
        const date = dateOffset(bounds.start, index);
        const day = byDate.get(date);
        if (!day || day.isIncomplete) break;
        completeThrough = date;
    }
    const final = byDate.size === bounds.days && [...byDate.values()].every(day => !day.isIncomplete);
    return {
        complete_through: completeThrough,
        days_present: byDate.size,
        days_expected: bounds.days,
        final,
    };
}

/** Null when the month has no stored days. A stored day of zeros is a real zero. */
export function deriveMonthlyGsc(month: string, days: DaySnapshot[]): MonthlyGsc | null {
    const bounds = monthBounds(month);
    const byDate = new Map<string, DaySnapshot>();
    for (const day of days) {
        if (day.date < bounds.start || day.date > bounds.end) continue;
        byDate.set(day.date, day);
    }
    const finality = monthFinality(month, [...byDate.values()]);
    if (finality.days_present === 0) return null;
    let clicks = 0;
    let impressions = 0;
    let positionSum = 0;
    for (const day of byDate.values()) {
        const property = day.property ?? { clicks: 0, impressions: 0, position: 0 };
        if (!Number.isInteger(property.clicks) || !Number.isInteger(property.impressions) || property.clicks < 0 || property.impressions < 0 || !Number.isFinite(property.position) || property.position < 0) {
            throw new Error('Invalid stored Search Console day');
        }
        clicks += property.clicks;
        impressions += property.impressions;
        positionSum += property.position * property.impressions;
    }
    return {
        data: {
            organic_clicks: clicks,
            impressions,
            avg_position: impressions > 0 ? Math.round((positionSum / impressions) * 10) / 10 : null,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : null,
        },
        provenance: {
            source: 'gsc_history',
            grain: 'property',
            timezone: 'America/Los_Angeles',
            range: { start: bounds.start, end: bounds.end },
            finality,
            method: METHOD,
        },
    };
}
