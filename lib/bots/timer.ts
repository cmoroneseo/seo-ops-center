import type { TimeLogSegment } from '../types.ts';
import { splitSegmentsByLocalDate } from '../timer/segments.ts';

/** A bot timer is closed at this age. Longer work is a new start after review. */
export const BOT_TIMER_CAP_MS = 2 * 60 * 60 * 1000;

export interface BotTimerStop {
    stoppedAt: string;
    /** True when the clock ran past the cap. The entry stops at the cap, not at now. */
    capped: boolean;
}

/**
 * Where a running bot timer ends.
 * Longer than the cap stops at the cap. A stop in the same instant as the start
 * moves one millisecond forward so the closed segment is a real interval.
 */
export function botTimerStop(startedAt: string, now: Date): BotTimerStop {
    const startMs = Date.parse(startedAt);
    const nowMs = now.getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) {
        throw new RangeError('Bot timer instants must be real timestamps.');
    }
    const capMs = startMs + BOT_TIMER_CAP_MS;
    if (nowMs > capMs) {
        return { stoppedAt: new Date(capMs).toISOString(), capped: true };
    }
    const stoppedMs = Math.max(nowMs, startMs + 1);
    return { stoppedAt: new Date(stoppedMs).toISOString(), capped: false };
}

export function botTimerIsOverdue(startedAt: string, now: Date): boolean {
    return botTimerStop(startedAt, now).capped;
}

/** Hundredths of an hour, the same rounding `finalize_time_attempt` stores. */
export function hoursFromSeconds(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.round((seconds / 3600) * 100) / 100;
}

export interface BotTimerDaySlice {
    date: string;
    seconds: number;
    hours: number;
}

/**
 * One closed session, split on local midnights the way a human stop is.
 * The first slice stays on the running row. Later slices are extra logged rows
 * that share its operation id.
 */
export function botTimerDaySlices(
    startedAt: string,
    stoppedAt: string,
    timeZone: string,
): BotTimerDaySlice[] {
    const segment: TimeLogSegment = {
        id: 'bot-timer',
        timeLogId: 'bot-timer',
        organizationId: 'bot-timer',
        userId: 'bot-timer',
        startedAt,
        endedAt: stoppedAt,
    };
    const totals = new Map<string, number>();
    for (const slice of splitSegmentsByLocalDate([segment], timeZone, new Date(stoppedAt))) {
        totals.set(slice.localDate, (totals.get(slice.localDate) ?? 0) + slice.activeSeconds);
    }
    return [...totals.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([date, seconds]) => {
            const rounded = Math.round(seconds);
            return { date, seconds: rounded, hours: hoursFromSeconds(rounded) };
        });
}
