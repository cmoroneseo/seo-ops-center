import type { Task } from '../types';

/** Resolve a planner deep link to the already-loaded canonical task record. */
export function taskForQuery(tasks: Task[], taskId: string | null): Task | null {
    const id = taskId?.trim();
    if (!id) return null;
    return tasks.find(task => task.id === id) ?? null;
}
