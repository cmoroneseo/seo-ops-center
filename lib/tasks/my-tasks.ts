import type { Task } from '../types';

export const taskFilterLabels = {
    mine: 'Assigned to me',
    all: 'All Tasks',
    unassigned: 'Unassigned',
    overdue: 'Overdue',
    today: 'Due Today',
    todo: 'To Do',
    in_progress: 'In Progress',
    done: 'Completed',
    no_due_date: 'No Due Date',
} as const;

export type TaskFilter = keyof typeof taskFilterLabels;

export function resolveTaskFilter(filter: string | null, hasClient: boolean): TaskFilter {
    return filter && Object.hasOwn(taskFilterLabels, filter) ? filter as TaskFilter : hasClient ? 'all' : 'mine';
}

export function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isOverdueTask(task: Pick<Task, 'status' | 'dueDate'>, today: string): boolean {
    return task.status !== 'done' && !!task.dueDate && task.dueDate < today;
}

export function compareTaskDueDates(a: Pick<Task, 'dueDate'>, b: Pick<Task, 'dueDate'>): number {
    if (!a.dueDate) return b.dueDate ? 1 : 0;
    return b.dueDate ? a.dueDate.localeCompare(b.dueDate) : -1;
}

export function filterTasks(tasks: Task[], filter: TaskFilter, today: string, userId = ''): Task[] {
    return tasks.filter(task => {
        switch (filter) {
            case 'all': return true;
            case 'mine': return !!userId && !!(task.assigneeIds?.includes(userId) || task.assignees?.includes(userId));
            case 'unassigned': return task.status !== 'done' &&
                !(task.assigneeIds?.length || task.assignees?.some(assignee => assignee && assignee !== 'Unassigned'));
            case 'overdue': return isOverdueTask(task, today);
            case 'today': return task.status !== 'done' && task.dueDate === today;
            case 'no_due_date': return task.status !== 'done' && !task.dueDate;
            default: return task.status === filter;
        }
    });
}

export function groupMyTasks(tasks: Task[], today: string) {
    const groups = { overdue: [] as Task[], today: [] as Task[], upcoming: [] as Task[], completed: [] as Task[] };
    for (const task of tasks) {
        if (task.status === 'done') groups.completed.push(task);
        else if (isOverdueTask(task, today)) groups.overdue.push(task);
        else if (task.dueDate === today) groups.today.push(task);
        else groups.upcoming.push(task);
    }
    groups.overdue.sort(compareTaskDueDates);
    groups.upcoming.sort(compareTaskDueDates);
    return groups;
}

export const TASK_DATA_CHANGED_EVENT = 'task:data-changed';

export function countMyOverdueTasks(tasks: Task[], today: string, userId?: string | null): number {
    if (!userId) return 0;
    return groupMyTasks(filterTasks(tasks, 'mine', today, userId), today).overdue.length;
}

export function myTasksSubtitle(groups: ReturnType<typeof groupMyTasks>): string {
    return `${groups.today.length} due today · ${groups.overdue.length} overdue · ${groups.upcoming.length} upcoming`;
}
