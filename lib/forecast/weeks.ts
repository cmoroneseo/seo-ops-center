import { formatLocalDate, parseLocalDate } from '../planner/local-date.ts';
import { weekStartFor } from '../timesheets/ledger.ts';

export function addCalendarDays(date: string, days: number): string {
    const parsed = parseLocalDate(date);
    if (!parsed) throw new RangeError(`Invalid date: ${date}`);
    parsed.setDate(parsed.getDate() + days);
    return formatLocalDate(parsed);
}

/** The week that contains `today`, plus the next three. Mondays. */
export function selectableWeekStarts(today: string): string[] {
    const start = weekStartFor(today);
    return [0, 1, 2, 3].map(offset => addCalendarDays(start, offset * 7));
}

export function assertTimeZone(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 100) return null;
    try {
        Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
        return trimmed;
    } catch {
        return null;
    }
}

/**
 * The browser's local date, accepted only when it is the server's date or one
 * day either side. That covers a Pacific evening that is already tomorrow in UTC.
 */
export function resolveClientToday(raw: string | null, serverNow: Date): string | { error: string } {
    const serverToday = formatLocalDate(serverNow);
    if (!raw) return serverToday;
    if (!parseLocalDate(raw)) return { error: 'today must be a yyyy-MM-dd date' };
    const server = parseLocalDate(serverToday);
    const client = parseLocalDate(raw);
    if (!server || !client) return { error: 'today must be a yyyy-MM-dd date' };
    const delta = Math.round((client.getTime() - server.getTime()) / 86_400_000);
    if (Math.abs(delta) > 1) return { error: 'today is too far from the server date' };
    return raw;
}

export function parseSelectableWeeks(today: string, requested: string[]): string[] | { error: string } {
    if (requested.length === 0) return { error: 'Choose at least one week.' };
    const unique = [...new Set(requested.map(week => week.trim()).filter(Boolean))];
    if (unique.length > 4) return { error: 'Choose at most four weeks.' };
    const allowed = new Set(selectableWeekStarts(today));
    for (const week of unique) {
        if (!allowed.has(week)) return { error: 'Weeks must be this week or one of the next three.' };
    }
    return unique.sort();
}

/** Inclusive start and exclusive end, with a two-day buffer for time zones. */
export function loadWindow(weekStarts: string[]): { from: string; to: string } {
    const sorted = [...weekStarts].sort();
    return {
        from: addCalendarDays(sorted[0], -2),
        to: addCalendarDays(sorted[sorted.length - 1], 8),
    };
}
