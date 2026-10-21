import { groupTasksByPlanMonth, isPlanDone, type PlanSectionModel } from './plan-sections';
import type { StageListTask } from './stage-list';

/**
 * Onboarding progress for the plan header and the overview chip.
 * Membership is the Onboarding section of the SEO Plan: tasks whose stage is
 * onboarding, including subtasks. Checklist rows that were never added as
 * tasks are not counted.
 */
export function onboardingSection(tasks: readonly StageListTask[]): PlanSectionModel {
    const section = groupTasksByPlanMonth(tasks, { month: '2026-01', today: '2026-01-15' })
        .find(item => item.id === 'onboarding');
    if (!section) {
        return {
            id: 'onboarding',
            title: 'Onboarding',
            count: 0,
            open: 0,
            late: 0,
            done: 0,
            meta: '0 open · 0/0 done',
            collapsedComplete: false,
            defaultCollapsed: false,
            empty: '',
            groups: [],
        };
    }
    return section;
}

export function onboardingSectionProgress(tasks: readonly StageListTask[]): { done: number; total: number } {
    const section = onboardingSection(tasks);
    return { done: section.done, total: section.count };
}

/** The rows behind the overview chip. Same membership as the plan header. */
export function onboardingSectionItems(tasks: readonly StageListTask[]): { id: string; title: string; done: boolean }[] {
    const section = onboardingSection(tasks);
    return section.groups.flatMap(group => [
        { id: group.task.id, title: group.task.title, done: isPlanDone(group.task.status) },
        ...group.children.map(child => ({ id: child.id, title: child.title, done: isPlanDone(child.status) })),
    ]);
}

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
 * so the template library does not flood Backlog.
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
            stage: 'backlog',
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
