import type { Task } from '../types';

/** Resolve a planner deep link to the already-loaded canonical task record. */
export function taskForQuery(tasks: Task[], taskId: string | null): Task | null {
    const id = taskId?.trim();
    if (!id) return null;
    return tasks.find(task => task.id === id) ?? null;
}

export interface TaskQuerySelectionState {
    selectedTask: Task | null;
    isDetailOpen: boolean;
}

/**
 * Reconcile an explicit task deep link only against a fully loaded org scope.
 * With no query, manual selection belongs to the page and remains untouched.
 */
export function reconcileTaskQuerySelection(params: {
    tasks: Task[];
    taskId: string | null;
    organizationId: string | null;
    loadedOrganizationId: string | null;
    loading: boolean;
    selectedTask: Task | null;
    isDetailOpen: boolean;
}): TaskQuerySelectionState {
    const current = {
        selectedTask: params.selectedTask,
        isDetailOpen: params.isDetailOpen,
    };
    if (params.taskId === null) return current;
    if (!params.organizationId || params.loadedOrganizationId !== params.organizationId) {
        return { selectedTask: null, isDetailOpen: false };
    }
    if (params.loading) return current;
    const selectedTask = taskForQuery(params.tasks, params.taskId);
    return selectedTask
        ? { selectedTask, isDetailOpen: true }
        : { selectedTask: null, isDetailOpen: false };
}
