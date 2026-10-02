import type { PlannerEvent, Task, TimerAttempt } from '../types';
import type { PlannerEventInsert } from '../supabase/planner-events';
import type { PlannerItem } from './items';

/** A sidebar drop always inserts a session; it never writes tasks.start_date. */
export function taskSessionInput(
    task: Task,
    userId: string,
    startsAt: string,
    endsAt: string,
): PlannerEventInsert {
    return {
        organizationId: task.organizationId,
        userId,
        taskId: task.id,
        clientId: task.clientId,
        title: task.title,
        kind: 'focus',
        startsAt,
        endsAt,
        attendeeIds: [],
    };
}

export function taskSessionToItem(
    event: PlannerEvent,
    task: Task,
    viewerId: string,
): PlannerItem {
    return {
        id: `session:${event.id}`,
        source: 'task',
        plannerEventId: event.id,
        title: task.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        allDay: false,
        kind: 'focus',
        clientName: task.clientName,
        ownerId: event.userId,
        attendeeIds: event.attendeeIds,
        draggable: event.userId === viewerId,
        // Reuse task details with this session's schedule, preserving canonical
        // task identity/status without changing its original planned block.
        raw: {
            ...task,
            startDate: event.startsAt,
            scheduledMinutes: Math.round((Date.parse(event.endsAt) - Date.parse(event.startsAt)) / 60_000),
        },
    };
}

export function shouldRenderTaskSession(event: PlannerEvent, attempts: TimerAttempt[]): boolean {
    return !attempts.some(attempt => (
        attempt.plannerEventId === event.id
        && (attempt.status === 'in_progress' || attempt.status === 'logged')
    ));
}

/** Search is independent of the calendar range and default drawer filters. */
export function searchPlannerTasks(tasks: Task[], query: string, includeCompleted = false): Task[] {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const seen = new Set<string>();
    return tasks.filter(task => {
        if (seen.has(task.id) || (!includeCompleted && task.status === 'done')) return false;
        const haystack = `${task.title} ${task.clientName ?? 'Internal work'}`.toLocaleLowerCase();
        if (!words.every(word => haystack.includes(word))) return false;
        seen.add(task.id);
        return true;
    });
}
