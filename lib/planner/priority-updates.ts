import type { PlannerTaskDropTarget } from './layout';

export function comparePlannerPriorityOrder(
    a: { sortOrder: number; createdAt: string; id: string },
    b: { sortOrder: number; createdAt: string; id: string },
): number {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    if (a.id === b.id) return 0;
    return a.id < b.id ? -1 : 1;
}

export function priorityUpdatesSucceeded(
    responses: { error: unknown }[],
): boolean {
    return responses.every(({ error }) => !error);
}

export function plannerTaskDropRpcSucceeded(
    result: { data: unknown; error: unknown },
): boolean {
    return !result.error && result.data === true;
}

export function planTaskDrop(
    target: PlannerTaskDropTarget,
    taskId: string,
    priorities: readonly { taskId?: string }[],
): { unschedule: true; addPriority: boolean } {
    return {
        unschedule: true,
        addPriority: target === 'priorities'
            && !priorities.some(priority => priority.taskId === taskId),
    };
}
