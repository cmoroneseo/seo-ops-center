import type { TimerAttempt } from '../types';

/**
 * The plan row is a view on the global timer.
 * A click is the confirmation, so the switch never opens a browser dialog.
 */
export type PlanTimerConfirm = (prompt: string) => boolean | Promise<boolean>;

export const planRowTimerSwitch: PlanTimerConfirm = () => true;

export type PlanRowTimerPhase = 'idle' | 'running' | 'paused' | 'reviewing';

export interface PlanRowTimerView {
    phase: PlanRowTimerPhase;
    /** Active seconds on the open attempt. Idle rows ignore this and show logged time. */
    seconds: number;
}

export interface PlanRowStart {
    clientId?: string;
    clientName: string;
    taskId: string;
    taskTitle?: string;
}

export interface ResumeReviewOptions {
    /** A cancelled stop review. The database clears reviewing_at and opens a segment. */
    continueReview?: boolean;
}

export interface PlanTimerControls {
    startTask: (options: PlanRowStart, confirmSwitch?: PlanTimerConfirm) => Promise<boolean>;
    pause: (attempt: TimerAttempt) => Promise<void>;
    resume: (
        attempt: TimerAttempt,
        confirmSwitch?: PlanTimerConfirm,
        options?: ResumeReviewOptions,
    ) => Promise<boolean>;
    beginStop: (attempt: TimerAttempt) => Promise<unknown>;
}

/** m:ss, or h:mm:ss once the attempt crosses an hour. Minutes are unpadded under an hour. */
export function formatPlanClock(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    }
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function attemptForPlanTask(
    taskId: string,
    running: TimerAttempt | null,
    paused: readonly TimerAttempt[],
): TimerAttempt | null {
    if (running?.taskId === taskId) return running;
    return paused.find(attempt => attempt.taskId === taskId) ?? null;
}

export function planRowTimerView(
    taskId: string,
    running: TimerAttempt | null,
    paused: readonly TimerAttempt[],
    elapsedSeconds: (attempt: TimerAttempt) => number,
): PlanRowTimerView {
    const attempt = attemptForPlanTask(taskId, running, paused);
    if (!attempt) return { phase: 'idle', seconds: 0 };
    if (attempt.reviewingAt) return { phase: 'reviewing', seconds: elapsedSeconds(attempt) };
    if (running?.id === attempt.id) return { phase: 'running', seconds: elapsedSeconds(attempt) };
    return { phase: 'paused', seconds: elapsedSeconds(attempt) };
}

/** Logged time stays on idle rows. An open attempt shows only its clock. */
export function planRowTimeText(view: PlanRowTimerView, loggedLabel: string): string {
    if (view.phase === 'running') return formatPlanClock(view.seconds);
    if (view.phase === 'paused' || view.phase === 'reviewing') return `❙❙ ${formatPlanClock(view.seconds)}`;
    return loggedLabel;
}

export function planRowTimerLabel(phase: PlanRowTimerPhase, title: string): string {
    if (phase === 'running') return `Pause timer for ${title}`;
    if (phase === 'paused') return `Resume timer for ${title}`;
    if (phase === 'reviewing') return `Timer for ${title} is in review`;
    return `Start timer for ${title}`;
}

export type PlanTimerClickResult =
    | { action: 'pause' }
    | { action: 'resume'; ok: boolean }
    | { action: 'start'; ok: boolean; promoted: boolean }
    | { action: 'noop' };

/**
 * Start, pause, or resume the global timer for one row.
 * A todo task is promoted only when a start actually begins, matching start_task_timer.
 */
export async function clickPlanRowTimer(input: {
    taskId: string;
    taskTitle: string;
    taskStatus: string;
    clientId: string;
    clientName: string;
    running: TimerAttempt | null;
    paused: readonly TimerAttempt[];
    controls: PlanTimerControls;
}): Promise<PlanTimerClickResult> {
    const attempt = attemptForPlanTask(input.taskId, input.running, input.paused);
    if (attempt && input.running?.id === attempt.id && !attempt.reviewingAt) {
        await input.controls.pause(attempt);
        return { action: 'pause' };
    }
    if (attempt?.reviewingAt) return { action: 'noop' };
    if (attempt) {
        const ok = await input.controls.resume(attempt, planRowTimerSwitch);
        return { action: 'resume', ok };
    }
    const ok = await input.controls.startTask({
        clientId: input.clientId,
        clientName: input.clientName,
        taskId: input.taskId,
        taskTitle: input.taskTitle,
    }, planRowTimerSwitch);
    return {
        action: 'start',
        ok,
        promoted: ok && input.taskStatus === 'todo',
    };
}

export async function openPlanStopReview(input: {
    taskId: string;
    running: TimerAttempt | null;
    beginStop: (attempt: TimerAttempt) => Promise<unknown>;
}): Promise<{ attemptId: string; markTaskComplete: true } | null> {
    const attempt = input.running;
    if (!attempt || attempt.taskId !== input.taskId || attempt.reviewingAt) return null;
    await input.beginStop(attempt);
    return { attemptId: attempt.id, markTaskComplete: true };
}

/**
 * Closing the sheet without finalizing leaves the attempt in review.
 * Resume it so the row stays open and the clock keeps running.
 * A missing attempt was finalized or discarded; the caller refetches the task.
 */
export async function closePlanStopReview(input: {
    attempt: TimerAttempt | null;
    resume: PlanTimerControls['resume'];
}): Promise<'resumed' | 'settled'> {
    if (!input.attempt?.reviewingAt) return 'settled';
    await input.resume(input.attempt, planRowTimerSwitch, { continueReview: true });
    return 'resumed';
}

/** Header Choose Task on the SEO Plan tab is a quiet ghost. Other tabs keep the green primary. */
export function planChooseTaskClass(onPlan: boolean, running: boolean): string {
    if (running) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25';
    if (onPlan) return 'border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground';
    return 'bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 border border-green-500/20';
}
