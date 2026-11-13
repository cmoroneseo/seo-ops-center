import { parseLocalDate } from '../planner/local-date.ts';
import { weekStartFor } from '../timesheets/ledger.ts';
import { addCalendarDays, selectableWeekStarts } from './weeks.ts';

/** Calendar day for a timestamp. Kept here so a browser save does not import the forecast hasher. */
function calendarDay(instant: string, timeZone: string): string | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(instant)) return parseLocalDate(instant) ? instant : null;
    const parsed = new Date(instant);
    if (Number.isNaN(parsed.getTime())) return null;
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(parsed);
        const year = parts.find(part => part.type === 'year')?.value;
        const month = parts.find(part => part.type === 'month')?.value;
        const day = parts.find(part => part.type === 'day')?.value;
        if (!year || !month || !day) return null;
        return `${year}-${month}-${day}`;
    } catch {
        return null;
    }
}

/** This week, the three ahead, and the week that just ended. */
export function forecastPushWindow(today: string): string[] {
    const current = weekStartFor(today);
    return [addCalendarDays(current, -7), ...selectableWeekStarts(today)];
}

/** Mondays in the push window for the calendar days of these instants. */
export function forecastWeeksForInstants(
    today: string,
    timeZone: string,
    instants: readonly (string | null | undefined)[],
): string[] {
    let allowed: Set<string>;
    try {
        allowed = new Set(forecastPushWindow(today));
    } catch {
        return [];
    }
    const weeks = new Set<string>();
    for (const instant of instants) {
        if (!instant?.trim()) continue;
        const day = calendarDay(instant, timeZone);
        if (!day) continue;
        try {
            const week = weekStartFor(day);
            if (allowed.has(week)) weeks.add(week);
        } catch {
            // A date that is not a real calendar day is not a week to sync.
        }
    }
    return [...weeks].sort();
}

export function browserTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

/**
 * Ask the server to sync the affected weeks. Never throws and never waits
 * on Campaign Desk. The save that called this has already succeeded.
 */
export function nudgeForecastSync(input: {
    organizationId: string | undefined;
    instants: readonly (string | null | undefined)[];
}): void {
    try {
        if (typeof fetch !== 'function' || typeof window === 'undefined') return;
        if (!input.organizationId) return;
        const timeZone = browserTimeZone();
        const today = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
        const weekStarts = forecastWeeksForInstants(today, timeZone, input.instants);
        if (weekStarts.length === 0) return;
        void fetch('/api/forecast/push', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                organizationId: input.organizationId,
                weekStarts,
                today,
                timeZone,
            }),
            keepalive: true,
        }).catch(() => undefined);
    } catch {
        // A forecast nudge must not change the result of the save.
    }
}
