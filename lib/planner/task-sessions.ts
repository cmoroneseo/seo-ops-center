import type { PlannerEvent, Task, TimerAttempt } from '../types';
import type { PlannerEventInsert } from '../supabase/planner-events';
import { timeTrackingTaskId } from '../tasks/pillars';
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

/** One Find Tasks row. `task` is the draggable pillar, or a subtask with no parent loaded. */
export interface PlannerSearchGroup {
    task: Task;
    children: Task[];
    /** Open the children on first paint. */
    expandChildren: boolean;
    /** Set when a subtask cannot be nested because its parent task is not loaded. */
    parentBreadcrumb?: string;
}

function searchWords(query: string): string[] {
    return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function titleMatchesQuery(task: Task, words: string[]): boolean {
    if (words.length === 0) return false;
    const title = task.title.toLocaleLowerCase();
    return words.every(word => title.includes(word));
}

function isPillarSubtask(task: Task, parent: Task | undefined): boolean {
    return timeTrackingTaskId(task, parent ?? null) !== task.id;
}

/**
 * Parent a search hit should render under.
 * Recurring successors stay on their own row. A subtask of a subtask does too —
 * Find Tasks is one level, pillar then chores.
 */
function nestParent(task: Task, byId: ReadonlyMap<string, Task>): Task | undefined {
    const parent = task.parentTaskId ? byId.get(task.parentTaskId) : undefined;
    if (!parent || !isPillarSubtask(task, parent)) return undefined;
    const grandparent = parent.parentTaskId ? byId.get(parent.parentTaskId) : undefined;
    if (isPillarSubtask(parent, grandparent)) return undefined;
    return parent;
}

/**
 * Nest pillar subtasks under their parent for Planner search.
 *
 * Matching subtasks leave the top level. When the parent itself missed the
 * query, it is taken from `catalog` so the hit still sits under the pillar.
 * The group's `task` is the row a drag schedules.
 *
 * Groups stay collapsed unless a child title matched, or the parent is only
 * here to hold that child. A shared client match such as "floor" stays
 * collapsed so the pillar reads as one job.
 */
export function groupPlannerSearchResults(
    matches: Task[],
    catalog: Task[],
    query: string,
): PlannerSearchGroup[] {
    const words = searchWords(query);
    const byId = new Map<string, Task>();
    for (const task of catalog) byId.set(task.id, task);
    for (const task of matches) if (!byId.has(task.id)) byId.set(task.id, task);

    const matchIds = new Set<string>();
    const childrenByParent = new Map<string, Task[]>();
    const seenChildren = new Set<string>();
    for (const task of matches) {
        matchIds.add(task.id);
        if (seenChildren.has(task.id)) continue;
        const parent = nestParent(task, byId);
        if (!parent) continue;
        seenChildren.add(task.id);
        const list = childrenByParent.get(parent.id) ?? [];
        list.push(task);
        childrenByParent.set(parent.id, list);
    }
    for (const list of childrenByParent.values()) {
        list.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    }

    const emitted = new Set<string>();
    const groups: PlannerSearchGroup[] = [];
    const emit = (task: Task, children: Task[]) => {
        if (emitted.has(task.id)) return;
        emitted.add(task.id);
        const childTitleHit = children.some(child => titleMatchesQuery(child, words));
        groups.push({
            task,
            children,
            expandChildren: children.length > 0 && (childTitleHit || !matchIds.has(task.id)),
        });
    };

    for (const task of matches) {
        const parent = nestParent(task, byId);
        if (parent) {
            emit(parent, childrenByParent.get(parent.id) ?? []);
            continue;
        }
        if (emitted.has(task.id)) continue;
        if (task.parentTaskId && !byId.has(task.parentTaskId) && isPillarSubtask(task, undefined)) {
            emitted.add(task.id);
            groups.push({
                task,
                children: [],
                expandChildren: false,
                parentBreadcrumb: 'Under another task',
            });
            continue;
        }
        emit(task, childrenByParent.get(task.id) ?? []);
    }
    return groups;
}
