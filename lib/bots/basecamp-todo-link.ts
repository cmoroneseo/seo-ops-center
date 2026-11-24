import { buildBasecampTaskRows } from '../basecamp/import-tasks-route.ts';
import { providerParentListId } from '../basecamp/provider-parent-list.ts';
import { isBasecampRecordingConflict } from '../basecamp/task-recording-conflict.ts';
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
import type { BasecampStep, BotActor, BotClientRecord, BotCreatedTaskResult, BotDeps, BotTaskRecord } from './handle.ts';
import type { BotCreateCommand, BotSubtaskDraft } from './request.ts';

export interface BotBasecampTasks extends BasecampTodoReader, BasecampLinkStore<BotTaskRecord> {
    createStep(projectId: string, todoId: string, title: string): Promise<{ id: number } | null>;
}

interface Failure {
    status: number;
    body: { code: string; error: string };
}

interface LinkedTaskResult extends BotCreatedTaskResult {
    children: BotCreatedTaskResult[];
    basecamp: BasecampStep;
}

function failure(status: number, code: string, error: string): Failure {
    return { status, body: { code, error } };
}

function conflict(): Failure {
    return failure(409, 'basecamp_todo_linked', 'The Basecamp to-do or the requested task already has a conflicting link.');
}

interface LinkBasecampTodoInput {
    command: BotCreateCommand & { basecampTodoId: string };
    client: BotClientRecord;
    actor: BotActor;
    botKeyId: string;
    operationId: string;
    now: string;
    deps: BotDeps;
    insertSubtask(parent: BotTaskRecord, draft: BotSubtaskDraft, index: number): Promise<BotCreatedTaskResult | { status: number; body: unknown }>;
}

export async function linkBasecampTodo(input: LinkBasecampTodoInput) {
    try {
        return await linkTodo(input);
    } catch (error) {
        if (isBasecampRecordingConflict(error)) return conflict();
        throw error;
    }
}

async function linkTodo(input: LinkBasecampTodoInput): Promise<LinkedTaskResult | { status: number; body: unknown }> {
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
            description: command.description ?? built.rows[0].description,
            due_date: command.dueDate ?? built.rows[0].due_date,
            assignee_id: actor.userId,
            assignee_ids: [actor.userId],
            bot_key_id: input.botKeyId,
            bot_operation_id: input.operationId,
        }]);
        if (!root) throw new Error('Could not save the imported Basecamp task');
    }

    const requestedByTitle = groupByStepTitle(command.subtasks);
    const descriptionsByStepId = new Map<number, string>();
    for (const [title, matches] of groupByStepTitle(steps)) {
        const requested = requestedByTitle.get(title);
        const description = requested?.[0].description;
        if (matches.length === 1 && requested?.length === 1 && description) {
            descriptionsByStepId.set(matches[0].id, description);
        }
    }
    const { stepsByTitle, childrenByStepId, imported } = await importBasecampTodoSteps({
        store: basecampTasks, root, steps, projectId, todoId, userId: actor.userId, now, matchExistingTitles: true,
        descriptionsByStepId,
    });
    const importedIds = new Set(imported.map(task => task.id));

    const children: BotCreatedTaskResult[] = [];
    const basecamp: BasecampStep = { status: 'pushed', providerId: todoId };
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
                const created = importedIds.has(child.id);
                children.push({
                    task: child, created, basecampStepId: String(match.id),
                    descriptionApplied: created && descriptionsByStepId.has(match.id),
                });
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
