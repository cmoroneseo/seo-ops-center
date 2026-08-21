import { splitSegmentsByLocalDate, sumActiveSeconds } from './timer/segments.ts';
import type { TimerAttempt } from './types';
import type { TimerMutationRequest, TimerStateResponse } from './timer/contracts';

export type TimerSwitchConfirmation = (prompt: string) => boolean | Promise<boolean>;

export interface TimerSwitchTarget {
    taskId?: string;
    timeLogId?: string;
    title: string;
}

export interface TimerUiState {
    runningTimer: TimerAttempt | null;
    pausedTimers: TimerAttempt[];
}

export function timerSwitchPrompt(from: TimerAttempt, toTitle: string): string {
    return `Pause “${from.taskTitle ?? from.clientName}” and start “${toTitle}”?`;
}

/** `elapsedSeconds` is the pre-segment migration baseline; segments own new work. */
export function totalAttemptActiveSeconds(attempt: TimerAttempt, now = new Date()): number {
    return attempt.elapsedSeconds + sumActiveSeconds(attempt.segments, now);
}

function mostRecentlyClosedAt(attempt: TimerAttempt): string {
    return attempt.segments
        .filter(segment => segment.endedAt)
        .reduce((latest, segment) => segment.endedAt! > latest ? segment.endedAt! : latest, attempt.reviewingAt ?? '');
}

export function timerUiStateFromResponse(state: TimerStateResponse): TimerUiState {
    return {
        runningTimer: state.running,
        pausedTimers: [...state.paused].sort((left, right) => (
            mostRecentlyClosedAt(right).localeCompare(mostRecentlyClosedAt(left))
        )),
    };
}

export function findTimerAttempt(state: TimerUiState, attemptId: string): TimerAttempt | null {
    if (state.runningTimer?.id === attemptId) return state.runningTimer;
    return state.pausedTimers.find(attempt => attempt.id === attemptId) ?? null;
}

export async function confirmAndSwitchTimer({
    running,
    target,
    confirm,
    mutate,
}: {
    running: TimerAttempt | null;
    target: TimerSwitchTarget;
    confirm: TimerSwitchConfirmation;
    mutate: (request: Extract<TimerMutationRequest, { action: 'switch' }>) => Promise<unknown>;
}): Promise<boolean> {
    if (!running || (!target.taskId && !target.timeLogId)) return false;
    if (!await confirm(timerSwitchPrompt(running, target.title))) return false;
    await mutate({
        action: 'switch',
        fromTimeLogId: running.id,
        ...(target.timeLogId ? { toTimeLogId: target.timeLogId } : { toTaskId: target.taskId! }),
    });
    return true;
}

export function finalizeTimerAttempt(
    attempt: TimerAttempt,
    options: Omit<Extract<TimerMutationRequest, { action: 'finalize' }>, 'action' | 'timeLogId' | 'countsTowardBudget'> & { countsTowardBudget?: boolean },
): Extract<TimerMutationRequest, { action: 'finalize' }> {
    return {
        action: 'finalize',
        timeLogId: attempt.id,
        ...options,
        countsTowardBudget: options.countsTowardBudget ?? attempt.countsTowardBudget,
    };
}

export interface StopReviewDefaults {
    billable: boolean;
    countsTowardBudget: boolean;
    markTaskComplete: boolean;
    canMarkTaskComplete: boolean;
}

/** SEO hours are claimed only by client work; completion always stays opt-in. */
export function stopReviewDefaults(attempt: TimerAttempt): StopReviewDefaults {
    return {
        billable: attempt.billable,
        countsTowardBudget: Boolean(attempt.clientId) && attempt.countsTowardBudget,
        markTaskComplete: false,
        canMarkTaskComplete: Boolean(attempt.taskId),
    };
}

export interface StopReviewDateTotal {
    localDate: string;
    activeSeconds: number;
    segmentCount: number;
}

export interface StopReviewSummary {
    totalActiveSeconds: number;
    dates: StopReviewDateTotal[];
}

/**
 * Mirrors `finalize_time_attempt`: segments are split at local midnight, totalled
 * per local date, and the pre-segment `elapsedSeconds` baseline stays on the
 * attempt's own date so the sheet previews exactly what finalization will write.
 */
export function stopReviewSummary(
    attempt: TimerAttempt,
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
    now = new Date(),
): StopReviewSummary {
    const totals = new Map<string, StopReviewDateTotal>();
    const addTo = (localDate: string): StopReviewDateTotal => {
        const existing = totals.get(localDate);
        if (existing) return existing;
        const created = { localDate, activeSeconds: 0, segmentCount: 0 };
        totals.set(localDate, created);
        return created;
    };

    if (attempt.elapsedSeconds > 0) addTo(attempt.date).activeSeconds += attempt.elapsedSeconds;

    for (const slice of splitSegmentsByLocalDate(attempt.segments, timeZone, now)) {
        const total = addTo(slice.localDate);
        total.activeSeconds += slice.activeSeconds;
        total.segmentCount += 1;
    }

    const dates = [...totals.values()]
        .map(date => ({ ...date, activeSeconds: Math.round(date.activeSeconds) }))
        .sort((left, right) => left.localDate.localeCompare(right.localDate));
    return {
        totalActiveSeconds: dates.reduce((sum, date) => sum + date.activeSeconds, 0),
        dates,
    };
}

export interface BasecampSyncEligibility {
    eligible: boolean;
    reason?: string;
}

/** An unavailable destination is explained rather than hidden. */
export function basecampSyncEligibility(
    attempt: TimerAttempt,
    clientTimesheetEnabled: boolean,
): BasecampSyncEligibility {
    if (!attempt.clientId) {
        return {
            eligible: false,
            reason: 'This work is not linked to a client, so there is no client timesheet to send it to.',
        };
    }
    if (!clientTimesheetEnabled) {
        return {
            eligible: false,
            reason: 'Basecamp timesheet sync is not enabled for this client.',
        };
    }
    return { eligible: true };
}

export interface StopSubmitOutcome {
    status: 'saved' | 'warned' | 'failed';
    message?: string;
}

/**
 * Local time is durable once the route returns, so a failed completion or
 * Basecamp push is a warning about the confirmed entry, never a failed save.
 */
export function stopSubmitOutcome(state: TimerStateResponse): StopSubmitOutcome {
    if (state.completionWarning) return { status: 'warned', message: state.completionWarning };
    if (state.basecampStatus === 'failed') {
        return {
            status: 'warned',
            message: 'Time was saved, but the Basecamp timesheet entry failed. Retry it from the task.',
        };
    }
    return { status: 'saved' };
}

/** A rejected mutation leaves the attempt in review so it can be retried. */
export function stopSubmitFailure(error: unknown): StopSubmitOutcome {
    const message = error instanceof Error && error.message.trim().length > 0
        ? error.message
        : 'This time entry could not be saved. It is still in review, so you can try again.';
    return { status: 'failed', message };
}

/**
 * Only finalization changes task state, client activity, or SEO hours; start,
 * pause, resume, and switch must not force those consumers to re-query.
 */
export function timerRefreshEvents(action: TimerMutationRequest['action']): string[] {
    const events = ['planner:data-changed', 'timer:data-changed'];
    if (action !== 'finalize' && action !== 'retry_basecamp') return events;
    return [...events, 'task:data-changed', 'client-activity:data-changed'];
}

export function canStartTaskTimer(clientId: string, taskId: string): boolean {
    return Boolean(clientId && taskId);
}
