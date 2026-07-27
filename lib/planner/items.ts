import { PlannerEvent, PlannerEventKind, Task, Reminder } from '../types';

/** A task with no estimatedHours still needs a visible block. */
export const TASK_DEFAULT_MINUTES = 60;

export type PlannerItemSource = 'event' | 'task' | 'reminder';

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
 * A task lands on the grid only when it has a startDate. Tasks without one are
 * the Backlog. Duration comes from estimatedHours, defaulting to one hour so a
 * task never renders as a zero-height sliver.
 */
export function taskToItem(t: Task): PlannerItem | null {
    if (!t.startDate) return null;
    const start = new Date(t.startDate);
    if (Number.isNaN(start.getTime())) return null;
    const minutes = t.estimatedHours ? Math.round(t.estimatedHours * 60) : TASK_DEFAULT_MINUTES;
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
