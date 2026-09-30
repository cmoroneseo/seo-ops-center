import type { MarketingPlanItem, Task } from './types';

export const TASK_STATUS_LABELS: Record<Task['status'], string> = {
    todo: 'To do', in_progress: 'In progress', review: 'In review',
    approved: 'Approved', blocked: 'Blocked', done: 'Done',
};

export function monthKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function taskIsComplete(task: Task): boolean {
    return task.status === 'done' || task.status === 'approved';
}

/** Linked tasks own execution fields; stale checklist values must never win. */
export function resolvePlanItem(item: MarketingPlanItem): MarketingPlanItem {
    const task = item.linkedTask;
    if (!task) return item;
    return {
        ...item, title: task.title, description: task.description,
        status: taskIsComplete(task) ? 'done' : 'todo',
        priority: task.priority === 'urgent' ? 'high' : task.priority,
        dueDate: task.dueDate ?? undefined, assigneeId: task.assigneeIds?.[0],
    };
}

/** Monthly scope means the task's due month; estimated effort is not time logged. */
export function monthlyExecution(items: MarketingPlanItem[], month: string, budget: number) {
    const seen = new Set<string>();
    const tasks = items.flatMap(item => {
        const task = item.linkedTask;
        if (!task || seen.has(task.id)) return [];
        seen.add(task.id);
        return [task];
    });
    const scoped = tasks.filter(task => task.dueDate?.slice(0, 7) === month)
        .sort((a, b) => Number(taskIsComplete(a)) - Number(taskIsComplete(b))
            || (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.title.localeCompare(b.title));
    const estimatedHours = scoped.reduce((sum, task) => sum + Math.max(0, task.estimatedHours ?? 0), 0);
    return {
        tasks: scoped, estimatedHours,
        remainingHours: budget - estimatedHours,
        missingEstimates: scoped.filter(task => task.estimatedHours == null).length,
        completed: scoped.filter(taskIsComplete),
        unscheduled: tasks.filter(task => !task.dueDate && !taskIsComplete(task)),
        carryover: tasks.filter(task => task.dueDate && task.dueDate.slice(0, 7) < month && !taskIsComplete(task)),
    };
}

/** Remaining estimates are separate from actual hours already consumed. */
export function executionCapacity(tasks: Task[], taskHours: Record<string, number>, loggedHours: number | null, budget: number) {
    const plannedHours = tasks.filter(task => !taskIsComplete(task)).reduce((sum, task) => sum + Math.max(0, (task.estimatedHours ?? 0) - (taskHours[task.id] ?? 0)), 0);
    const consumed = (loggedHours ?? 0) + plannedHours;
    return { plannedHours, consumed, available: Math.max(0, budget - consumed), scale: Math.max(budget, consumed, 1) };
}
