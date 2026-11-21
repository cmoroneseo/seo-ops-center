import type { StageListTask } from './stage-list';
import { calendarDay, dueDay, formatDueDay } from './this-month';

export interface PlanGroup {
    task: StageListTask;
    /** Children rendered with this task. */
    children: StageListTask[];
    childCount: number;
    childDone: number;
    /** Children with a live URL. Counted across the displayed children. */
    urlCount: number;
    /** Child tasks included in the time rollup. */
    rollupChildIds: string[];
    expandChildren: boolean;
    parentBreadcrumb?: string;
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPlanMonth(value: string): boolean {
    return MONTH_KEY.test(value);
}

export function planMonthTitle(month: string): string {
    const [year, monthIndex] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthIndex - 1, 1)).toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
}

export function completionDay(value: string | null | undefined, timeZone?: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return dueDay(value);
    return calendarDay(parsed, timeZone);
}

export function isPlanDone(status: string): boolean {
    return status === 'done';
}

export function lateDayCount(due: string, today: string): number {
    const start = Date.parse(`${due}T00:00:00Z`);
    const end = Date.parse(`${today}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
    return Math.max(0, Math.round((end - start) / 86400000));
}

export function formatPlanDue(task: StageListTask, today: string, timeZone?: string): {
    text: string;
    late: boolean;
    done: boolean;
    undated: boolean;
} {
    if (isPlanDone(task.status)) {
        const day = completionDay(task.completedAt, timeZone) ?? dueDay(task.dueDate);
        return { text: day ? `Done ${formatDueDay(day)}` : 'Done', late: false, done: true, undated: false };
    }
    const due = dueDay(task.dueDate);
    if (!due) return { text: 'No date', late: false, done: false, undated: true };
    const currentDay = dueDay(today);
    if (currentDay && due < currentDay) {
        const days = lateDayCount(due, currentDay);
        return { text: `${formatDueDay(due)} ${days}d late`, late: true, done: false, undated: false };
    }
    return { text: formatDueDay(due), late: false, done: false, undated: false };
}

export function formatPlanHours(hours: number): string {
    if (!Number.isFinite(hours) || hours <= 0) return '0h';
    const minutes = Math.round(hours * 60);
    if (minutes < 60) return `${minutes}m`;
    const rounded = Math.round(hours * 10) / 10;
    return `${rounded}h`;
}

export function planHourRollup(
    taskId: string,
    childIds: readonly string[],
    hoursByTask: Readonly<Record<string, number>>,
): { own: number; children: number; total: number; tooltip: string } {
    const own = hoursByTask[taskId] ?? 0;
    const children = childIds.reduce((sum, id) => sum + (hoursByTask[id] ?? 0), 0);
    return {
        own,
        children,
        total: own + children,
        tooltip: `${formatPlanHours(own)} on pillar + ${formatPlanHours(children)} across subtasks`,
    };
}
