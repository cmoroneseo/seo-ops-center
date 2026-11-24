import type { StageListTask } from './stage-list';

export const CHECKLIST_TASK_PREFIX = 'checklist:';

export function isChecklistTaskId(id: string): boolean {
    return id.startsWith(CHECKLIST_TASK_PREFIX);
}

export function checklistTaskId(itemId: string): string {
    return `${CHECKLIST_TASK_PREFIX}${itemId}`;
}

export interface PlanChecklistItem {
    id: string;
    title: string;
    status: string;
    dueDate?: string | null;
    taskId?: string | null;
}

/**
 * Dated checklist rows the overview Now lane already shows.
 * A row linked to a task is the task. Ignored and undated rows stay out,
 * so the template library does not flood the work plan.
 */
export function checklistTasksForPlan(
    items: readonly PlanChecklistItem[],
    tasks: readonly Pick<StageListTask, 'id'>[],
): StageListTask[] {
    const taskIds = new Set(tasks.map(task => task.id));
    const rows: StageListTask[] = [];
    for (const item of items) {
        const title = item.title.trim();
        const due = item.dueDate?.slice(0, 10) ?? '';
        if (!title || item.status === 'ignored') continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
        if (item.taskId && taskIds.has(item.taskId)) continue;
        if (item.taskId) continue;
        const done = item.status === 'done';
        rows.push({
            id: checklistTaskId(item.id),
            title,
            status: done ? 'done' : 'todo',
            position: null,
            parentTaskId: null,
            createdAt: null,
            category: null,
            basecamp: false,
            recurring: false,
            dueDate: due,
            completedAt: done ? `${due}T12:00:00.000Z` : null,
            description: '',
            estimatedHours: null,
        });
    }
    return rows;
}

export function withChecklistTasks(tasks: readonly StageListTask[], items: readonly PlanChecklistItem[]): StageListTask[] {
    return [...tasks, ...checklistTasksForPlan(items, tasks)];
}
