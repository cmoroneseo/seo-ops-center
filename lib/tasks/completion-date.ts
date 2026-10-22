import { zonedWallTimeToUtc } from '../timer/manual-segment';

const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * A completion chosen a few seconds ahead of the server clock is still "now".
 * A later instant is a future day and is rejected.
 */
export const COMPLETION_FUTURE_SKEW_MS = 2 * 60 * 1000;

export const COMPLETION_FUTURE_ERROR = 'Pick today or a past day.';
export const COMPLETION_INVALID_ERROR = 'Enter a real date.';

export type CompletionChoice =
    | { kind: 'today' }
    | { kind: 'yesterday' }
    | { kind: 'day'; day: string };

/** Calendar day of an instant in an IANA zone, as YYYY-MM-DD. */
export function completionCalendarDay(instant: Date, timeZone: string): string | null {
    if (Number.isNaN(instant.getTime())) return null;
    try {
        const day = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(instant);
        return DAY.test(day) ? day : null;
    } catch {
        return null;
    }
}

/** Shift a calendar day by whole days. Invalid dates return null. */
export function shiftCalendarDay(day: string, deltaDays: number): string | null {
    const match = DAY.exec(day);
    if (!match || !Number.isFinite(deltaDays)) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const date = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, date));
    if (
        utc.getUTCFullYear() !== year
        || utc.getUTCMonth() !== month - 1
        || utc.getUTCDate() !== date
    ) {
        return null;
    }
    utc.setUTCDate(utc.getUTCDate() + deltaDays);
    const next = [
        String(utc.getUTCFullYear()).padStart(4, '0'),
        String(utc.getUTCMonth() + 1).padStart(2, '0'),
        String(utc.getUTCDate()).padStart(2, '0'),
    ].join('-');
    return DAY.test(next) ? next : null;
}

/**
 * The instant to store on tasks.completed_at.
 * Today is the current time, so a morning completion is not a future midday.
 * Any other day is midday in the person's zone, which stays on that calendar day.
 */
export function resolveCompletionInstant(input: {
    choice: CompletionChoice;
    now: Date;
    timeZone: string;
}): { ok: true; completedAt: string; day: string } | { ok: false; error: string } {
    if (Number.isNaN(input.now.getTime())) return { ok: false, error: COMPLETION_INVALID_ERROR };
    const today = completionCalendarDay(input.now, input.timeZone);
    if (!today) return { ok: false, error: COMPLETION_INVALID_ERROR };

    if (input.choice.kind === 'today') {
        return { ok: true, completedAt: input.now.toISOString(), day: today };
    }

    const day = input.choice.kind === 'yesterday'
        ? shiftCalendarDay(today, -1)
        : input.choice.day;
    if (!day || !DAY.test(day)) return { ok: false, error: COMPLETION_INVALID_ERROR };
    if (day > today) return { ok: false, error: COMPLETION_FUTURE_ERROR };
    if (day === today) return { ok: true, completedAt: input.now.toISOString(), day: today };

    const midday = zonedWallTimeToUtc(day, '12:00', input.timeZone);
    if (!midday) return { ok: false, error: COMPLETION_INVALID_ERROR };
    if (midday.getTime() > input.now.getTime()) return { ok: false, error: COMPLETION_FUTURE_ERROR };
    return { ok: true, completedAt: midday.toISOString(), day };
}

/** A supplied completion instant that is real and not after `now`, beyond a small clock skew. */
export function acceptedCompletionInstant(value: string, now: string): string | null {
    const time = Date.parse(value);
    const nowTime = Date.parse(now);
    if (!Number.isFinite(time) || !Number.isFinite(nowTime)) return null;
    if (time > nowTime + COMPLETION_FUTURE_SKEW_MS) return null;
    return new Date(time).toISOString();
}
