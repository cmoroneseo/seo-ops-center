import type { TimerAttempt } from '../types';

/** Paused work shorter than this is flagged. It is never deleted on its own. */
export const SHORT_PAUSED_SECONDS = 60;

export const TIMER_IN_REVIEW_MESSAGE =
    'This task already has a timer in review. Finish or discard it before starting another.';

export const RESUMED_OPEN_TIMER_MESSAGE = 'Resumed the paused timer on this task.';

export const REVIEWING_TIMER_MESSAGE =
    'This timer is in review. Finish or discard it from the timer widget.';

/** Header control that picks a task. A task row keeps its own play button. */
export const GLOBAL_TIMER_LABEL = 'Time a task';

export const GLOBAL_TIMER_BUTTON = 'Start on this task';

export const GLOBAL_TIMER_HINT =
    'Pick a task below. The play button on a task row starts that task.';

export function isShortPausedAttempt(seconds: number): boolean {
    return Number.isFinite(seconds) && seconds >= 0 && seconds < SHORT_PAUSED_SECONDS;
}

/**
 * A second start while this task's open attempt is in review is refused.
 * Other conflicts stay generic so a database detail is not shown to the user.
 */
export function timerConflictMessage(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null;
    const record = error as { code?: unknown; message?: unknown };
    if (record.code !== '55000' || typeof record.message !== 'string') return null;
    if (!record.message.includes('time attempt is in review')) return null;
    return TIMER_IN_REVIEW_MESSAGE;
}

export interface OpenTimerRow {
    attemptId: string;
    taskId: string | null;
    title: string;
    phase: 'running' | 'paused' | 'reviewing';
    seconds: number;
}

/** Open attempts for the plan page and the timesheet strip. */
export function openTimerRows(
    running: TimerAttempt | null,
    paused: readonly TimerAttempt[],
    elapsedSeconds: (attempt: TimerAttempt) => number,
    clientId?: string,
): OpenTimerRow[] {
    const rows: OpenTimerRow[] = [];
    const seen = new Set<string>();
    const push = (attempt: TimerAttempt, phase: OpenTimerRow['phase']) => {
        if (seen.has(attempt.id)) return;
        if (clientId && attempt.clientId !== clientId) return;
        seen.add(attempt.id);
        rows.push({
            attemptId: attempt.id,
            taskId: attempt.taskId ?? null,
            title: attempt.taskTitle || attempt.description || attempt.clientName || 'Untitled',
            phase,
            seconds: elapsedSeconds(attempt),
        });
    };
    if (running) push(running, running.reviewingAt ? 'reviewing' : 'running');
    for (const attempt of paused) {
        push(attempt, attempt.reviewingAt ? 'reviewing' : 'paused');
    }
    return rows;
}

export function formatAttemptClock(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    }
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export interface SplitEntry {
    id: string;
    operationId?: string | null;
    date: string;
    hours: number;
    elapsedSeconds?: number | null;
    status: string;
}

function splitMinutes(entry: SplitEntry): number {
    const seconds = entry.elapsedSeconds != null && entry.elapsedSeconds > 0
        ? entry.elapsedSeconds
        : Math.round(entry.hours * 3600);
    return Math.max(0, Math.round(seconds / 60));
}

/**
 * One confirmed timer that crossed local midnight is stored as one logged row
 * per date. Hours are rounded to two decimals, so the next day's row can read
 * a minute shorter than the clock the widget showed for the whole session.
 */
export function midnightSplitLabel(entry: SplitEntry, entries: readonly SplitEntry[]): string | null {
    if (entry.status !== 'logged' || !entry.operationId) return null;
    const group = new Map<string, SplitEntry>();
    for (const item of entries) {
        if (item.status === 'logged' && item.operationId === entry.operationId) {
            group.set(item.id, item);
        }
    }
    if (group.size < 2) return null;
    const others = [...group.values()]
        .filter(item => item.id !== entry.id)
        .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
    const parts = others.map(item => `${splitMinutes(item)}m on ${item.date}`);
    return `Split at midnight from one timer. Also ${parts.join(', ')}.`;
}

export interface OvernightSlice {
    localDate: string;
    activeSeconds: number;
}

function sliceClock(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    if (minutes < 1) return `${remainder}s`;
    if (remainder === 0) return `${minutes}m`;
    return `${minutes}m ${remainder}s`;
}

/** Shown after Log Time when finalize will write more than one dated row. */
export function overnightSplitSentence(dates: readonly OvernightSlice[]): string | null {
    if (dates.length < 2) return null;
    const parts = [...dates]
        .sort((left, right) => left.localDate.localeCompare(right.localDate))
        .map(day => `${sliceClock(day.activeSeconds)} on ${day.localDate}`);
    return `Logged as separate entries because this timer crossed midnight: ${parts.join(' and ')}.`;
}
