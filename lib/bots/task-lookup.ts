/**
 * Which task a bot time entry is about.
 *
 * `taskTitle` alone matches a top-level task. A subtask has a parent, so the
 * same title on a child is a different task. Name that parent with
 * `parentTaskId` or `parentTitle` to match the child.
 */

export interface BotTaskRef {
    id: string;
    title: string;
    parentTaskId: string | null;
}

export interface BotTaskMatchCommand {
    taskTitle?: string;
    parentTaskId?: string;
    parentTitle?: string;
}

export type BotTaskMatch =
    | { ok: true; taskId: string }
    | {
        ok: false;
        status: 404 | 409;
        code: 'task_not_found' | 'ambiguous_task';
        error: string;
        /** `missing` is "no such task". `missing-parent` is not something createTask can invent. */
        reason: 'missing' | 'missing-parent' | 'ambiguous';
    };

function miss(
    status: 404 | 409,
    code: 'task_not_found' | 'ambiguous_task',
    error: string,
    reason: 'missing' | 'missing-parent' | 'ambiguous',
): BotTaskMatch {
    return { ok: false, status, code, error, reason };
}

function oneChild(tasks: readonly BotTaskRef[], parentId: string, title: string): BotTaskMatch {
    const rows = tasks.filter(task => task.parentTaskId === parentId && task.title === title);
    if (rows.length > 1) {
        return miss(409, 'ambiguous_task', 'More than one subtask has that exact title under that parent.', 'ambiguous');
    }
    const row = rows[0];
    if (!row) return miss(404, 'task_not_found', 'Task not found.', 'missing');
    return { ok: true, taskId: row.id };
}

export function matchBotTask(tasks: readonly BotTaskRef[], command: BotTaskMatchCommand): BotTaskMatch {
    const title = command.taskTitle;
    if (!title) return miss(404, 'task_not_found', 'Task not found.', 'missing');

    if (!command.parentTaskId && !command.parentTitle) {
        const rows = tasks.filter(task => task.parentTaskId == null && task.title === title);
        if (rows.length > 1) return miss(409, 'ambiguous_task', 'More than one task has that exact title.', 'ambiguous');
        const row = rows[0];
        if (!row) return miss(404, 'task_not_found', 'Task not found.', 'missing');
        return { ok: true, taskId: row.id };
    }

    const parents = tasks.filter(task => (
        task.parentTaskId == null
        && (command.parentTaskId ? task.id === command.parentTaskId : task.title === command.parentTitle)
    ));

    if (command.parentTaskId) {
        const parent = parents[0];
        if (!parent) return miss(404, 'task_not_found', 'Parent task not found.', 'missing-parent');
        if (command.parentTitle && parent.title !== command.parentTitle) {
            return miss(409, 'ambiguous_task', 'parentTaskId and parentTitle do not refer to the same task.', 'ambiguous');
        }
        return oneChild(tasks, parent.id, title);
    }

    if (parents.length > 1) {
        return miss(409, 'ambiguous_task', 'More than one parent task has that exact title. Send parentTaskId.', 'ambiguous');
    }
    const parent = parents[0];
    if (!parent) return miss(404, 'task_not_found', 'Parent task not found.', 'missing-parent');
    return oneChild(tasks, parent.id, title);
}
