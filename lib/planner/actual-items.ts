import type { Task, TimerAttempt } from '../types';
import { groupSegmentsForDisplay } from '../timer/segments.ts';
import type { PlannerItem, PlannerTimerState } from './items';
import { taskBlockMinutes } from './items.ts';

export type PlannerTimerAction = 'start' | 'pause' | 'resume' | 'stop';

function sameInstant(left: string, right: string): boolean {
    const leftMs = new Date(left).getTime();
    const rightMs = new Date(right).getTime();
    return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

/**
 * A timer consumes one immutable forecast snapshot. A later schedule for the
 * same unfinished task is a different forecast and must remain visible.
 */
export function shouldRenderForecast(task: Task, attempts: TimerAttempt[]): boolean {
    if (!task.startDate) return false;
    return !attempts.some(attempt => (
        attempt.taskId === task.id
        && (attempt.status === 'in_progress' || attempt.status === 'logged')
        && Boolean(attempt.plannedStartsAt)
        && sameInstant(attempt.plannedStartsAt!, task.startDate!)
        && attempt.plannedMinutes === taskBlockMinutes(task)
    ));
}

function timerState(attempt: TimerAttempt): PlannerTimerState {
    if (attempt.status === 'logged') return 'logged';
    return attempt.segments.some(segment => segment.endedAt === undefined)
        ? 'running'
        : 'paused';
}

/** Convert one canonical attempt into read-only, five-minute-grouped evidence. */
export function actualAttemptToItems(attempt: TimerAttempt, now: Date): PlannerItem[] {
    const state = timerState(attempt);
    return groupSegmentsForDisplay(attempt.segments, undefined, now).map((group, index) => ({
        id: `actual:${attempt.id}:${index}`,
        source: 'actual_time',
        title: attempt.taskTitle || attempt.description || attempt.clientName || 'Actual work',
        startsAt: group.startsAt,
        endsAt: group.endsAt,
        allDay: false,
        kind: 'focus',
        clientName: attempt.clientName,
        ownerId: attempt.userId,
        attendeeIds: [attempt.userId],
        draggable: false,
        raw: attempt,
        attemptId: attempt.id,
        activeSeconds: group.activeSeconds,
        timerState: state,
    }));
}

/** Timer controls are derived from semantics, never from card color. */
export function timerActionsForItem(item: PlannerItem): PlannerTimerAction[] {
    if (item.source === 'task') return ['start'];
    if (item.source !== 'actual_time') return [];
    if (item.timerState === 'running') return ['pause', 'stop'];
    if (item.timerState === 'paused') return ['resume', 'stop'];
    return [];
}
