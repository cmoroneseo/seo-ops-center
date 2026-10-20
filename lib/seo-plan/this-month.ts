import { timeTrackingTaskId } from '../tasks/pillars';
import type { StageListTask } from './stage-list';

/**
 * The agency calendar. Organizations have no timezone column; dates in this
 * list follow Pacific time, the same clock the rest of the org uses.
 */
export const STAGE_LIST_TIME_ZONE = 'America/Los_Angeles';

const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Calendar day in `timeZone`, as YYYY-MM-DD. */
export function calendarDay(now: Date, timeZone = STAGE_LIST_TIME_ZONE): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}

/** A stored due date as a calendar day. Anything else is no date. */
export function dueDay(value: string | null | undefined): string | null {
    if (!value) return null;
    const day = value.trim().slice(0, 10);
    return DAY.test(day) ? day : null;
}

export function formatDueDay(day: string): string {
    const match = DAY.exec(day);
    if (!match) return day;
    const month = MONTHS[Number(match[2]) - 1];
    return month ? `${month} ${Number(match[3])}` : day;
}

function openStatus(status: string): boolean {
    return status !== 'done';
}

/**
 * Not-done work due in the calendar month of `today`, plus not-done work
 * whose due date is already past `today`. Undated work stays out.
 */
export function isThisMonthTask(
    task: { status: string; dueDate?: string | null },
    today: string,
): boolean {
    const due = dueDay(task.dueDate);
    const now = dueDay(today);
    if (!openStatus(task.status) || !due || !now) return false;
    return due.slice(0, 7) === now.slice(0, 7) || due < now;
}

/** Not-done, and the due day is before today. Due today is not overdue. */
export function isOverdueTask(
    task: { status: string; dueDate?: string | null },
    today: string,
): boolean {
    const due = dueDay(task.dueDate);
    const now = dueDay(today);
    if (!openStatus(task.status) || !due || !now) return false;
    return due < now;
}

function nests(task: StageListTask, byId: ReadonlyMap<string, StageListTask>): boolean {
    if (!task.parentTaskId) return false;
    const parent = byId.get(task.parentTaskId);
    return timeTrackingTaskId({
        id: task.id,
        title: task.title,
        parentTaskId: task.parentTaskId,
        recurrence: task.recurring ? { freq: 'weekly' } : undefined,
    }, parent ?? null) !== task.id;
}

/**
 * Tasks for the This month view.
 * Matching rows stay. A matching subtask keeps the pillar it renders under,
 * even when that pillar is not itself due. A recurring successor stays its
 * own row and does not pull its completed parent in.
 */
export function selectThisMonthTasks(tasks: readonly StageListTask[], today: string): StageListTask[] {
    const byId = new Map<string, StageListTask>();
    for (const task of tasks) {
        if (!task.id || byId.has(task.id)) continue;
        byId.set(task.id, task);
    }
    const unique = [...byId.values()];
    const keep = new Set<string>();
    for (const task of unique) {
        if (!isThisMonthTask(task, today)) continue;
        keep.add(task.id);
        let current = task;
        const seen = new Set<string>([task.id]);
        while (nests(current, byId) && current.parentTaskId) {
            const parentId = current.parentTaskId;
            if (seen.has(parentId)) break;
            seen.add(parentId);
            keep.add(parentId);
            const parent = byId.get(parentId);
            if (!parent) break;
            current = parent;
        }
    }
    return unique.filter(task => keep.has(task.id));
}
