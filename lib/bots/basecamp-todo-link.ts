import { buildBasecampTaskRows } from '../basecamp/import-tasks-route.ts';
import { providerParentListId } from '../basecamp/import-stage.ts';
import {
    importBasecampTodoSteps,
    readBasecampTodo,
    readBasecampTodoSteps,
    type BasecampLinkStore,
    type BasecampTodoReader,
} from '../basecamp/task-todo-link.ts';
import {
    BASECAMP_STEP_MATCH_CONFLICT,
    groupByStepTitle,
    normalizeStepTitle,
    type BasecampTodoStep,
} from '../basecamp/todo-steps.ts';
import type { BasecampStep, BotActor, BotClientRecord, BotDeps, BotTaskRecord } from './handle.ts';
import type { BotCreateCommand, BotSubtaskDraft } from './request.ts';

export interface BotBasecampTasks extends BasecampTodoReader, BasecampLinkStore<BotTaskRecord> {
    createStep(projectId: string, todoId: string, title: string): Promise<{ id: number } | null>;
}

interface Failure {
    status: number;
    body: { code: string; error: string };
}

interface TaskResult {
    task: BotTaskRecord;
    created: boolean;
    basecampStepId?: string;
}

interface LinkedTaskResult extends TaskResult {
    children: TaskResult[];
    basecamp: BasecampStep;
}

function failure(status: number, code: string, error: string): Failure {
    return { status, body: { code, error } };
}

function conflict(): Failure {
    return failure(409, 'basecamp_todo_linked', 'The Basecamp to-do or the requested task already has a conflicting link.');
}

export async function linkBasecampTodo(input: {
    command: BotCreateCommand & { basecampTodoId: string };
    client: BotClientRecord;
    actor: BotActor;
    botKeyId: string;
    operationId: string;
    now: string;
    deps: BotDeps;
    insertSubtask(parent: BotTaskRecord, draft: BotSubtaskDraft, index: number): Promise<TaskResult | { status: number; body: unknown }>;
}): Promise<LinkedTaskResult | { status: number; body: unknown }> {
    const { deps, command, client, actor, now } = input;
    const { basecampTasks } = deps;
    const organizationId = client.organizationId;
    const clientId = client.id;
    const todoId = command.basecampTodoId;
    const projectId = client.basecampProjectId;
    if (!projectId) {
        return failure(409, 'basecamp_project_not_configured', 'This client has no configured Basecamp project.');
    }

    const recording = await readBasecampTodo(basecampTasks, projectId, todoId);
    if (recording.kind === 'step') {
        return failure(400, 'basecamp_recording_is_step', 'basecampTodoId must identify a Basecamp to-do.');
    }
    if (recording.kind === 'missing') {
        return failure(404, 'basecamp_todo_not_found', 'The to-do was not found in this client’s Basecamp project.');
    }
    const { todo } = recording;

    // Recording ownership must be checked across clients and organizations.
    const claims = await basecampTasks.findRecordings([todoId]);
    const linked = claims.at(0);
    if (claims.length > 1 || (linked && (
        linked.organizationId !== organizationId || linked.clientId !== clientId || linked.parentTaskId
        || (linked.basecampProjectId && linked.basecampProjectId !== projectId)
    ))) return conflict();

    const target = command.taskTitle ? await deps.findTask(organizationId, clientId, command) : null;
    if (target === 'ambiguous' || (target && 'ok' in target && target.reason !== 'missing')) {
        return linked ? conflict() : failure(409, 'ambiguous_task', 'More than one task has that exact title.');
    }
    const existing = target && !('ok' in target) ? target : null;
    if (existing && (linked ? linked.id !== existing.id : existing.basecampTodoId)) return conflict();

    let steps: BasecampTodoStep[];
    try {
        steps = await readBasecampTodoSteps(basecampTasks, projectId, todoId, todo);
    } catch {
        return failure(502, 'basecamp_steps_unavailable', 'The Basecamp steps could not be read. Retry with the same key.');
    }

    let root = linked ?? existing;
    if (root && !linked) {
        const saved = await basecampTasks.updateTaskLink(root, projectId, todoId, now);
        if (!saved) return conflict();
        root = saved;
    }
    const created = !root;
    if (!root) {
        const listId = providerParentListId(todo);
        const built = await buildBasecampTaskRows({
            tasks: [{
                basecampProjectId: Number(projectId),
                basecampTodoId: Number(todoId),
                ...(listId ? { basecampTodolistId: Number(listId) } : {}),
                category: command.category,
            }],
            organizationId, clientId, userId: actor.userId, now,
            getTodo: async () => ({ ...todo, steps: undefined }),
            options: { mirrorCompletion: true },
        });
        if (!built.ok) throw new Error('Could not build the Basecamp task import row');
        [root] = await basecampTasks.insertImportedTasks([{
            ...built.rows[0],
            title: command.taskTitle ?? built.rows[0].title,
            due_date: command.dueDate ?? built.rows[0].due_date,
            assignee_id: actor.userId,
            assignee_ids: [actor.userId],
            bot_key_id: input.botKeyId,
            bot_operation_id: input.operationId,
        }]);
        if (!root) throw new Error('Could not save the imported Basecamp task');
    }

    const { stepsByTitle, childrenByStepId, imported } = await importBasecampTodoSteps({
        store: basecampTasks, root, steps, projectId, todoId, userId: actor.userId, now, matchExistingTitles: true,
    });
    const importedIds = new Set(imported.map(task => task.id));

    const children: TaskResult[] = [];
    const basecamp: BasecampStep = { status: 'pushed', providerId: todoId };
    const requestedByTitle = groupByStepTitle(command.subtasks);
    const skip = (reason: string) => {
        basecamp.subtasksSkipped = (basecamp.subtasksSkipped ?? 0) + 1;
        basecamp.reason = reason;
    };
    for (const [index, draft] of command.subtasks.entries()) {
        const title = normalizeStepTitle(draft.title);
        const matches = stepsByTitle.get(title) ?? [];
        const match = matches[0];
        if (match) {
            const child = childrenByStepId.get(String(match.id));
            if (matches.length === 1 && requestedByTitle.get(title)?.length === 1 && child) {
                children.push({ task: child, created: importedIds.has(child.id), basecampStepId: String(match.id) });
            } else {
                skip(BASECAMP_STEP_MATCH_CONFLICT);
            }
            continue;
        }

        const result = await input.insertSubtask(root, draft, index);
        if ('status' in result) return result;
        const existingId = result.task.basecampTodoId;
        if (existingId) {
            children.push({
                ...result,
                ...(childrenByStepId.get(existingId)?.id === result.task.id ? { basecampStepId: existingId } : {}),
            });
            continue;
        }
        if (todo.supportsSubtasks === false || (requestedByTitle.get(title)?.length ?? 0) > 1) {
            skip(todo.supportsSubtasks === false ? 'The linked Basecamp to-do does not accept steps.' : BASECAMP_STEP_MATCH_CONFLICT);
            children.push(result);
            continue;
        }
        const step = await basecampTasks.createStep(projectId, todoId, draft.title);
        if (!step) return failure(502, 'basecamp_step_sync_failed', 'The Basecamp step could not be created. Retry with the same key.');
        const child = await basecampTasks.updateTaskLink(result.task, projectId, String(step.id), now);
        if (!child) throw new Error('Basecamp step link changed during push');
        children.push({ ...result, task: child, basecampStepId: String(step.id) });
    }
    return { task: root, created, children, basecamp };
}
