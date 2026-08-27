import type { Task, TimerAttempt } from '../types';
import { groupSegmentsForDisplay } from '../timer/segments.ts';
import type { PlannerItem, PlannerTimerState } from './items';
import { plannerTimeLabel, taskBlockMinutes } from './items.ts';

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
    if (attempt.reviewingAt) return 'reviewing';
    return attempt.segments.some(segment => segment.endedAt === undefined)
        ? 'running'
        : 'paused';
}

/**
 * The window a segment-less log occupies on the grid.
 *
 * Time logged by hand has no segments, so it produced NO planner items at all
 * and simply did not exist on the calendar. That is what made rescheduling
 * feel destructive: a day whose only mark was the task's forecast block lost
 * its entire visual record the moment that block was dragged elsewhere, even
 * though the hours were safely recorded.
 *
 * The block starts where the work was planned to start and runs for the hours
 * actually logged — so logging 2h against a 2h45m block draws two hours, not a
 * block that lies about its own length.
 */
export function loggedWindow(
    attempt: TimerAttempt,
): { startsAt: string; endsAt: string } | null {
    if (!attempt.plannedStartsAt || !(attempt.hours > 0)) return null;
    const start = new Date(attempt.plannedStartsAt);
    if (Number.isNaN(start.getTime())) return null;
    return {
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + attempt.hours * 3600_000).toISOString(),
    };
}

/** Convert one canonical attempt into read-only, five-minute-grouped evidence. */
export function actualAttemptToItems(attempt: TimerAttempt, now: Date): PlannerItem[] {
    const state = timerState(attempt);

    if (attempt.segments.length === 0) {
        const window = loggedWindow(attempt);
        if (!window) return [];
        return [{
            id: `actual:${attempt.id}:0`,
            source: 'actual_time',
            title: attempt.taskTitle || attempt.description || attempt.clientName || 'Actual work',
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            allDay: false,
            kind: 'focus',
            clientName: attempt.clientName,
            ownerId: attempt.userId,
            attendeeIds: [attempt.userId],
            draggable: false,
            raw: attempt,
            attemptId: attempt.id,
            // No timer ran, so there are no active seconds to claim.
            timerState: state,
        }];
    }

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
    if (item.timerState === 'reviewing') return ['stop'];
    return [];
}

export interface MonthItemPresentation {
    accessibleName: string;
    stateLabel: string | null;
    actions: PlannerTimerAction[];
}

function timerStateLabel(state: PlannerTimerState | undefined): string | null {
    if (!state || state === 'logged') return null;
    return `${state[0].toUpperCase()}${state.slice(1)}`;
}

/** Shared desktop-month presentation contract, also useful to card/details. */
export function monthItemPresentation(
    item: PlannerItem,
    canControlTimer: boolean,
): MonthItemPresentation {
    const stateLabel = timerStateLabel(item.timerState);
    const details = item.source === 'actual_time'
        ? `${item.title}, ${plannerTimeLabel(item)}${stateLabel ? `, ${stateLabel}` : ''}`
        : item.title;
    return {
        accessibleName: details,
        stateLabel,
        actions: canControlTimer ? timerActionsForItem(item) : [],
    };
}

export function plannerTimerActionLabel(
    action: PlannerTimerAction,
    item: PlannerItem,
): string {
    if (action === 'start') return 'Start Timer';
    if (action === 'stop' && item.timerState === 'reviewing') return 'Review time';
    return `${action[0].toUpperCase()}${action.slice(1)} timer`;
}

/** Preserve a display-group selection; use attempt identity only if it vanished. */
export function resolvePlannerSelection(
    selected: PlannerItem,
    items: PlannerItem[],
): PlannerItem {
    const exact = items.find(item => item.id === selected.id);
    if (exact) return exact;
    if (selected.source === 'actual_time' && selected.attemptId) {
        return items.find(item => (
            item.source === 'actual_time' && item.attemptId === selected.attemptId
        )) ?? selected;
    }
    return selected;
}
