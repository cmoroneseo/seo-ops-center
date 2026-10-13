export interface EndOfDayLog {
    userId: string;
    date: string;
    hours: number;
    status?: string;
}

export type EndOfDayReason =
    | 'needs_logs'
    | 'before_hour'
    | 'already_shown'
    | 'dismissed'
    | 'query_failed'
    | 'missing_user'
    | 'logged_today'
    | 'remind';

export interface EndOfDayDecision {
    show: boolean;
    localDate: string;
    reason: EndOfDayReason;
}

export interface EndOfDayInput {
    now: Date;
    timeZone: string;
    userId: string;
    /**
     * undefined: the day has not been loaded yet.
     * null: the query failed. That is not zero hours.
     */
    logs: EndOfDayLog[] | null | undefined;
    shownForDate: string | null;
    dismissedForDate: string | null;
    hourThreshold?: number;
}

/** Calendar date in an IANA time zone. `Date#toISOString` is UTC and must not be used here. */
export function calendarDateInTimeZone(now: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function hourInTimeZone(now: Date, timeZone: string): number {
    const hour = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now).find(part => part.type === 'hour')?.value ?? '';
    const value = Number(hour);
    if (!Number.isFinite(value)) return -1;
    return value === 24 ? 0 : value;
}

/** `time_logs.date` is a date. A timestamptz-shaped string still contributes its calendar day. */
export function normalizeLogDate(value: string): string {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    return match ? match[1] : '';
}

export function memberLoggedOnDate(logs: EndOfDayLog[], userId: string, localDate: string): boolean {
    return logs.some(log =>
        log.userId === userId
        && normalizeLogDate(log.date) === localDate
        && (log.hours > 0 || log.status === 'in_progress'),
    );
}

/**
 * Whether to show the end-of-day reminder.
 * A failed read never counts as an empty day, and a reminder already presented
 * for this local date stays down across navigations.
 */
export function decideEndOfDayReminder(input: EndOfDayInput): EndOfDayDecision {
    const threshold = input.hourThreshold ?? 16;
    let localDate = '';
    let hour = -1;
    try {
        localDate = calendarDateInTimeZone(input.now, input.timeZone);
        hour = hourInTimeZone(input.now, input.timeZone);
    } catch {
        return { show: false, localDate: '', reason: 'query_failed' };
    }
    if (!input.userId) return { show: false, localDate, reason: 'missing_user' };
    if (hour < threshold) return { show: false, localDate, reason: 'before_hour' };
    if (input.dismissedForDate === localDate) return { show: false, localDate, reason: 'dismissed' };
    if (input.shownForDate === localDate) return { show: false, localDate, reason: 'already_shown' };
    if (input.logs === undefined) return { show: false, localDate, reason: 'needs_logs' };
    if (input.logs === null) return { show: false, localDate, reason: 'query_failed' };
    if (memberLoggedOnDate(input.logs, input.userId, localDate)) return { show: false, localDate, reason: 'logged_today' };
    return { show: true, localDate, reason: 'remind' };
}

/** Query shape for the reminder. `throwOnError` keeps a failed read from looking like zero hours. */
export function endOfDayLogLookup(localDate: string, userId: string): {
    onDate: string;
    userId: string;
    throwOnError: true;
    includeInProgress: true;
} {
    return { onDate: localDate, userId, throwOnError: true, includeInProgress: true };
}
