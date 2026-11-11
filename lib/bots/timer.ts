import { createHash } from 'node:crypto';

import type { TimeLogSegment } from '../types.ts';
import { splitSegmentsByLocalDate } from '../timer/segments.ts';

/** A bot timer is closed at this age of running time. Paused time does not count. */
export const BOT_TIMER_CAP_MS = 2 * 60 * 60 * 1000;

/**
 * A paused bot timer older than this is listed for review. The sweep does not
 * close it and does not send it to Basecamp.
 */
export const BOT_TIMER_STALE_PAUSED_MS = 7 * 24 * 60 * 60 * 1000;

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
    const closed = botTimerCloseOpen({ openStartedAt: startedAt, closedMs: 0, now });
    if (!closed.openEndedAt) {
        throw new RangeError('Bot timer instants must be real timestamps.');
    }
    return { stoppedAt: closed.openEndedAt, capped: closed.capped };
}

export interface BotTimerStretchInterval {
    startedAt: string;
    endedAt: string;
}

export interface BotTimerOpenClose {
    /** True when running time is already past the cap. Exactly two hours is not past it. */
    capped: boolean;
    /** End of the open stretch. Null when nothing is open. */
    openEndedAt: string | null;
    runningMs: number;
}

function instantMs(value: string, nowMs?: number): number {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed) || (nowMs !== undefined && !Number.isFinite(nowMs))) {
        throw new RangeError('Bot timer instants must be real timestamps.');
    }
    return parsed;
}

/** Running milliseconds already stored on closed stretches. */
export function closedRunningMs(stretches: readonly BotTimerStretchInterval[]): number {
    let total = 0;
    for (const stretch of stretches) {
        const started = instantMs(stretch.startedAt);
        const ended = instantMs(stretch.endedAt);
        if (ended < started) throw new RangeError('Bot timer instants must be real timestamps.');
        total += ended - started;
    }
    return total;
}

/**
 * Where the open stretch ends, using cumulative running time.
 * Time spent paused is not in `closedMs` and does not move the cap.
 * A pause or stop at exactly two hours is not a cap. One millisecond past it is.
 */
export function botTimerCloseOpen(input: {
    openStartedAt: string | null;
    closedMs: number;
    now: Date;
}): BotTimerOpenClose {
    const closedMs = input.closedMs;
    if (!Number.isFinite(closedMs) || closedMs < 0) {
        throw new RangeError('Bot timer instants must be real timestamps.');
    }
    const nowMs = input.now.getTime();
    if (!Number.isFinite(nowMs)) throw new RangeError('Bot timer instants must be real timestamps.');
    if (!input.openStartedAt) {
        return { capped: closedMs > BOT_TIMER_CAP_MS, openEndedAt: null, runningMs: closedMs };
    }
    const startMs = instantMs(input.openStartedAt, nowMs);
    const remaining = BOT_TIMER_CAP_MS - closedMs;
    if (remaining <= 0) {
        return {
            capped: true,
            openEndedAt: new Date(startMs + 1).toISOString(),
            runningMs: closedMs + 1,
        };
    }
    const elapsed = Math.max(nowMs - startMs, 1);
    if (elapsed > remaining) {
        return {
            capped: true,
            openEndedAt: new Date(startMs + remaining).toISOString(),
            runningMs: BOT_TIMER_CAP_MS,
        };
    }
    return {
        capped: false,
        openEndedAt: new Date(startMs + elapsed).toISOString(),
        runningMs: closedMs + elapsed,
    };
}

export function botTimerPauseIsStale(pausedAt: string, now: Date): boolean {
    const pausedMs = Date.parse(pausedAt);
    const nowMs = now.getTime();
    if (!Number.isFinite(pausedMs) || !Number.isFinite(nowMs)) return false;
    return nowMs - pausedMs >= BOT_TIMER_STALE_PAUSED_MS;
}

/**
 * Stable id for one closed bot stretch. A replay of pause or stop inserts this
 * same id and does not add a second segment.
 */
export function botStretchSegmentId(timeLogId: string, startedAt: string): string {
    const bytes = createHash('sha256').update(`${timeLogId}:${startedAt}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Notes for one stretch, in the order they were sent. Identical neighbors collapse. */
export function combineStretchNote(
    existing: string | null | undefined,
    added: string | null | undefined,
): string | null {
    const lines: string[] = [];
    for (const value of [existing, added]) {
        for (const line of (value ?? '').split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || lines[lines.length - 1] === trimmed) continue;
            lines.push(trimmed);
        }
    }
    return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Basecamp timesheet note for a stopped bot timer.
 * Stretch notes first, then the stop note. Hours, minutes, and timestamps are
 * ignored on purpose: the timesheet hours field is the only place time goes.
 */
export function botTimerBasecampSummary(input: {
    stretchNotes: readonly (string | null | undefined)[];
    stopNote?: string | null;
    hours?: number;
    minutes?: number;
    startedAt?: string | null;
    stoppedAt?: string | null;
}): string {
    void input.hours;
    void input.minutes;
    void input.startedAt;
    void input.stoppedAt;
    return combineStretchNote(
        input.stretchNotes.filter((note): note is string => Boolean(note && note.trim())).join('\n'),
        input.stopNote,
    ) ?? '';
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
function slicesFromSegments(segments: TimeLogSegment[], timeZone: string): BotTimerDaySlice[] {
    const totals = new Map<string, number>();
    for (const segment of segments) {
        const endedAt = segment.endedAt ?? segment.startedAt;
        for (const slice of splitSegmentsByLocalDate([segment], timeZone, new Date(endedAt))) {
            totals.set(slice.localDate, (totals.get(slice.localDate) ?? 0) + slice.activeSeconds);
        }
    }
    return [...totals.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([date, seconds]) => {
            const rounded = Math.round(seconds);
            return { date, seconds: rounded, hours: hoursFromSeconds(rounded) };
        });
}

export function botTimerDaySlices(
    startedAt: string,
    stoppedAt: string,
    timeZone: string,
): BotTimerDaySlice[] {
    return slicesFromSegments([{
        id: 'bot-timer',
        timeLogId: 'bot-timer',
        organizationId: 'bot-timer',
        userId: 'bot-timer',
        startedAt,
        endedAt: stoppedAt,
    }], timeZone);
}

/** Every closed stretch, split on local midnights and summed per calendar day. */
export function botTimerDaySlicesFromStretches(
    stretches: readonly BotTimerStretchInterval[],
    timeZone: string,
): BotTimerDaySlice[] {
    return slicesFromSegments(stretches.map(stretch => ({
        id: 'bot-timer',
        timeLogId: 'bot-timer',
        organizationId: 'bot-timer',
        userId: 'bot-timer',
        startedAt: stretch.startedAt,
        endedAt: stretch.endedAt,
    })), timeZone);
}
