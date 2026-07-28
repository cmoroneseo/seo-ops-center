// Type-only so Node's TypeScript stripping erases the import entirely — this is
// what lets `node --test lib/planner/items.test.ts` resolve without a bundler.
import type { PlannerEvent, PlannerEventKind, Task, Reminder } from '../types';

/** A task with no estimatedHours still needs a visible block. */
export const TASK_DEFAULT_MINUTES = 60;

export type PlannerItemSource = 'event' | 'task' | 'reminder';

/**
 * Parse a task's start.
 *
 * `new Date('2026-07-30')` is parsed as UTC midnight, which is the *previous*
 * evening anywhere west of Greenwich — a task scheduled for Thursday would
 * render on Wednesday. Migration 027 made `tasks.start_date` a timestamptz, but
 * rows written before it (and any hand-entered date) are still bare dates, so
 * those are parsed as local midnight instead.
 */
export function parseTaskStart(value: string): Date | null {
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(value);
    const d = dateOnly
        ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)))
        : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The single shape the grid renders. Events, scheduled tasks, and reminders
 * all normalize into this so no grid component branches on record type.
 */
export interface PlannerItem {
    id: string;
    source: PlannerItemSource;
    title: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    kind: PlannerEventKind;
    clientName?: string;
    ownerId?: string;
    attendeeIds: string[];
    /** Reminders are read-only on the grid; events and tasks can be dragged. */
    draggable: boolean;
    raw: PlannerEvent | Task | Reminder;
}

export function eventToItem(e: PlannerEvent): PlannerItem {
    return {
        id: `event:${e.id}`,
        source: 'event',
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        kind: e.kind,
        ownerId: e.userId,
        attendeeIds: e.attendeeIds,
        draggable: true,
        raw: e,
    };
}

/**
 * How tall a task's block is.
 *
 * `scheduledMinutes` is what the planner sets aside for it; `estimatedHours` is
 * how long the work takes. They are different facts, so the planner reads the
 * estimate as a starting point but only ever writes the schedule. Falls back to
 * an hour so a task never renders as a zero-height sliver.
 */
export function taskBlockMinutes(t: Task): number {
    if (t.scheduledMinutes && t.scheduledMinutes > 0) return t.scheduledMinutes;
    if (t.estimatedHours && t.estimatedHours > 0) return Math.round(t.estimatedHours * 60);
    return TASK_DEFAULT_MINUTES;
}

/**
 * A task lands on the grid only when it has a startDate. Tasks without one are
 * the Backlog.
 */
export function taskToItem(t: Task): PlannerItem | null {
    if (!t.startDate) return null;
    const start = parseTaskStart(t.startDate);
    if (!start) return null;
    const minutes = taskBlockMinutes(t);
    const end = new Date(start.getTime() + minutes * 60_000);
    return {
        id: `task:${t.id}`,
        source: 'task',
        title: t.title,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        allDay: false,
        kind: 'focus',
        clientName: t.clientName,
        attendeeIds: t.assigneeIds ?? [],
        draggable: true,
        raw: t,
    };
}

/** Reminders render as all-day chips on their due date. */
export function reminderToItem(r: Reminder): PlannerItem {
    const due = new Date(r.dueAt);
    return {
        id: `reminder:${r.id}`,
        source: 'reminder',
        title: r.title,
        startsAt: due.toISOString(),
        endsAt: due.toISOString(),
        allDay: true,
        kind: 'event',
        attendeeIds: [],
        draggable: false,
        raw: r,
    };
}
