import type { Task } from '../types';
import { mergeSavedTask } from './merge-saved-task';

/**
 * The id the drawer should trust after a send.
 *
 * The push route saves `basecamp_todo_id` before it answers. The drawer used
 * to reload the row and then publish a copy of the task it already held, so
 * the saved id never reached the prop that hides "Not in Basecamp".
 */
export function basecampTodoIdFrom(value: unknown): string | undefined {
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : undefined;
}

export function taskWithBasecampLink(
    task: Task,
    link: {
        basecampTodoId?: unknown;
        basecampProjectId?: unknown;
        lastSyncedAt?: string | null;
        subtasks?: Task['subtasks'];
        subtasksState?: Task['subtasksState'];
    },
): Task {
    const basecampTodoId = basecampTodoIdFrom(link.basecampTodoId) ?? task.basecampTodoId;
    const basecampProjectId = basecampTodoIdFrom(link.basecampProjectId) ?? task.basecampProjectId;
    const knowsSubtasks = link.subtasksState === 'ready'
        || link.subtasksState === 'unavailable'
        || link.subtasksState === 'loading';
    return mergeSavedTask(task, {
        ...task,
        basecampTodoId,
        basecampProjectId,
        lastSyncedAt: link.lastSyncedAt ?? task.lastSyncedAt,
        ...(knowsSubtasks
            ? { subtasks: link.subtasks ?? task.subtasks, subtasksState: link.subtasksState }
            : {}),
    });
}
