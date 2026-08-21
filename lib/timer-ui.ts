import { sumActiveSeconds } from './timer/segments.ts';
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

export function canStartTaskTimer(clientId: string, taskId: string): boolean {
    return Boolean(clientId && taskId);
}
