import { dateOffset } from '@/lib/gsc/history';
import { monthFinality, type MonthFinality } from '@/lib/gsc/monthly';
import { monthBounds, previousMonth, ptToday } from '@/lib/sync/months';
import type { DistortedReason, StoredDay } from './types';

export const ROLLING_DAYS = 28;
/** GSC keeps about 16 months. Day metadata for the default window stays inside that. */
export const LOOKBACK_DAYS = 486;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface DateSpan {
    start: string;
    end: string;
}

export interface RangePreset {
    kind: '28d' | 'month';
    key: string;
    month: string | null;
}

export interface WindowCoverage {
    start: string;
    end: string;
    daysExpected: number;
    daysPresent: number;
    finalDays: number;
    firstStored: string | null;
    final: boolean;
    completeThrough: string | null;
}

export interface ResolvedRange {
    preset: RangePreset;
    current: DateSpan;
    prior: DateSpan;
    earlier: DateSpan;
    finality: MonthFinality;
    today: string;
}

export function parseRange(value: string | null): RangePreset | null {
    if (value == null || value.trim() === '' || value === '28d') return { kind: '28d', key: '28d', month: null };
    if (!MONTH.test(value)) return null;
    return { kind: 'month', key: value, month: value };
}

export function inclusiveDays(start: string, end: string): number {
    return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

export function eachDate(start: string, end: string): string[] {
    const count = inclusiveDays(start, end);
    return Array.from({ length: count }, (_, index) => dateOffset(start, index));
}

export function rollingSpan(end: string, days = ROLLING_DAYS): DateSpan {
    return { start: dateOffset(end, 1 - days), end };
}

/** Latest stored day that is not preliminary, on or before today. */
export function lastFinalDate(days: Pick<StoredDay, 'date' | 'isIncomplete'>[], today: string): string | null {
    let last: string | null = null;
    for (const day of days) {
        if (day.isIncomplete || day.date > today) continue;
        if (last == null || day.date > last) last = day.date;
    }
    return last;
}

export function coverWindow(span: DateSpan, days: Pick<StoredDay, 'date' | 'isIncomplete'>[]): WindowCoverage {
    const byDate = new Map<string, Pick<StoredDay, 'date' | 'isIncomplete'>>();
    for (const day of days) {
        if (day.date < span.start || day.date > span.end) continue;
        byDate.set(day.date, day);
    }
    const dates = [...byDate.keys()].sort();
    const daysExpected = inclusiveDays(span.start, span.end);
    let completeThrough: string | null = null;
    for (let index = 0; index < daysExpected; index++) {
        const date = dateOffset(span.start, index);
        const day = byDate.get(date);
        if (!day || day.isIncomplete) break;
        completeThrough = date;
    }
    const stored = [...byDate.values()];
    const final = stored.length === daysExpected && stored.every(day => !day.isIncomplete);
    return {
        start: span.start,
        end: span.end,
        daysExpected,
        daysPresent: stored.length,
        finalDays: stored.filter(day => !day.isIncomplete).length,
        firstStored: dates[0] ?? null,
        final,
        completeThrough,
    };
}

function toFinality(coverage: WindowCoverage): MonthFinality {
    return {
        complete_through: coverage.completeThrough,
        days_present: coverage.daysPresent,
        days_expected: coverage.daysExpected,
        final: coverage.final,
    };
}

/**
 * A comparison is distorted when the two windows cannot be read as the same kind of period.
 * Fully final months of different lengths stay comparable. A gap on only one side is unequal coverage.
 */
export function comparisonDistortion(current: WindowCoverage, prior: WindowCoverage): { distorted: boolean; reason: DistortedReason | null } {
    const startsLate = (window: WindowCoverage) => window.firstStored != null && window.firstStored > window.start;
    if (startsLate(current) || startsLate(prior)) return { distorted: true, reason: 'history starts mid-period' };
    const currentGap = current.daysExpected - current.finalDays;
    const priorGap = prior.daysExpected - prior.finalDays;
    if (currentGap !== priorGap) {
        return { distorted: true, reason: current.final ? 'unequal coverage' : 'partial period' };
    }
    if (!current.final || !prior.final) return { distorted: true, reason: 'partial period' };
    return { distorted: false, reason: null };
}

export function historySpan(preset: RangePreset, today: string): DateSpan {
    if (preset.kind === 'month' && preset.month) {
        const earlier = previousMonth(previousMonth(preset.month));
        return { start: monthBounds(earlier).start, end: monthBounds(preset.month).end > today ? today : monthBounds(preset.month).end };
    }
    return { start: dateOffset(today, -LOOKBACK_DAYS), end: today };
}

export function resolveRange(preset: RangePreset, days: Pick<StoredDay, 'date' | 'isIncomplete'>[], now: Date): ResolvedRange {
    const today = ptToday(now);
    if (preset.kind === 'month' && preset.month) {
        const current = { start: monthBounds(preset.month).start, end: monthBounds(preset.month).end };
        const priorMonth = previousMonth(preset.month);
        const earlierMonth = previousMonth(priorMonth);
        const inMonth = days.filter(day => day.date >= current.start && day.date <= current.end);
        return {
            preset,
            current,
            prior: { start: monthBounds(priorMonth).start, end: monthBounds(priorMonth).end },
            earlier: { start: monthBounds(earlierMonth).start, end: monthBounds(earlierMonth).end },
            finality: monthFinality(preset.month, inMonth.map(day => ({ date: day.date, isIncomplete: day.isIncomplete }))),
            today,
        };
    }
    const end = lastFinalDate(days, today) ?? today;
    const current = rollingSpan(end);
    const prior = rollingSpan(dateOffset(current.start, -1));
    const earlier = rollingSpan(dateOffset(prior.start, -1));
    return {
        preset,
        current,
        prior,
        earlier,
        finality: toFinality(coverWindow(current, days)),
        today,
    };
}

export function finalDates(span: DateSpan, days: Pick<StoredDay, 'date' | 'isIncomplete'>[]): Set<string> {
    const dates = new Set<string>();
    for (const day of days) {
        if (day.date < span.start || day.date > span.end || day.isIncomplete) continue;
        dates.add(day.date);
    }
    return dates;
}
