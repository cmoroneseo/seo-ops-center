import { bearerToken, isBotKeyToken } from './scope.ts';
import { parseBotTimeRequest, type BotTimeCommand } from './request.ts';
import type { BotTaskMatch } from './task-lookup.ts';
import { isBuiltInTaskCategory, TASK_CATEGORY_ERROR, taskCategoryAllowed } from './task-create.ts';
import { taskStatusUpdate } from '../tasks/status.ts';
import type { TaskStatusHistoryEntryLike } from '../tasks/status.ts';

const LOCK_MS = 60_000;

export interface BotKeyRecord {
    id: string;
    organizationId: string;
    name: string;
    revokedAt: string | null;
}

export interface BotActor {
    userId: string;
    name: string;
    email: string;
    organizationId: string;
}

export interface BotOperationRecord {
    id: string;
    botKeyId: string;
    idempotencyKey: string;
    requestHash: string;
    status: 'pending' | 'completed';
    lockedAt: string;
    taskId: string | null;
    timeLogId: string | null;
    httpStatus: number | null;
    response: unknown;
}

export interface BotClientRecord {
    id: string;
    organizationId: string;
    name: string;
}

export interface BotTaskRecord {
    id: string;
    organizationId: string;
    clientId: string;
    title: string;
    status: string;
    completedAt: string | null;
    statusHistory: TaskStatusHistoryEntryLike[];
    basecampTodoId: string | null;
    basecampProjectId: string | null;
    parentTaskId?: string | null;
    category: string | null;
    dueDate: string | null;
    botOperationId: string | null;
}

export interface BotTimeLogRecord {
    id: string;
    taskId: string;
    userId: string;
    date: string;
    hours: number;
    minutes: number;
    description: string | null;
    countsTowardBudget: boolean;
    billable: boolean;
    basecampEntryId: string | null;
}

export interface BasecampStep {
    status: 'pushed' | 'skipped' | 'failed';
    reason?: string;
    providerId?: string;
}

export interface BotTimeDeps {
    now(): Date;
    authenticate(token: string): Promise<BotKeyRecord | null>;
    actor(organizationId: string): Promise<BotActor | null>;
    findOperation(botKeyId: string, idempotencyKey: string): Promise<BotOperationRecord | null>;
    insertOperation(input: {
        organizationId: string;
        botKeyId: string;
        idempotencyKey: string;
        requestHash: string;
        lockedAt: string;
    }): Promise<BotOperationRecord | 'conflict'>;
    saveOperation(id: string, patch: Partial<Pick<BotOperationRecord, 'status' | 'lockedAt' | 'taskId' | 'timeLogId' | 'httpStatus' | 'response'>>): Promise<void>;
    findClient(organizationId: string, command: BotTimeCommand): Promise<BotClientRecord | null | 'ambiguous'>;
    /** Exact `tasks.category` values this client already has. Used only when a new task names a label outside the built-in set. */
    clientCategories(organizationId: string, clientId: string): Promise<string[]>;
    findTask(
        organizationId: string,
        clientId: string,
        command: BotTimeCommand,
    ): Promise<BotTaskRecord | null | 'ambiguous' | Extract<BotTaskMatch, { ok: false }>>;
    getTask(taskId: string): Promise<BotTaskRecord | null>;
    insertTask(input: {
        organizationId: string;
        clientId: string;
        title: string;
        category?: string;
        dueDate?: string;
        actor: BotActor;
        botKeyId: string;
        botOperationId: string;
        now: string;
    }): Promise<BotTaskRecord | 'conflict'>;
    saveTask(taskId: string, patch: {
        status: string;
        completedAt: string | null;
        statusHistory: TaskStatusHistoryEntryLike[];
    }): Promise<BotTaskRecord | null>;
    findTimeLogByOperation(operationId: string): Promise<BotTimeLogRecord | null>;
    insertTimeLog(input: {
        organizationId: string;
        clientId: string;
        taskId: string;
        actor: BotActor;
        command: BotTimeCommand;
        botKeyId: string;
        botOperationId: string;
    }): Promise<BotTimeLogRecord | 'conflict'>;
    getTimeLog(timeLogId: string): Promise<BotTimeLogRecord | null>;
    pushTodo(taskId: string, actor: BotActor): Promise<BasecampStep>;
    syncTimesheet(timeLogId: string, actor: BotActor): Promise<BasecampStep>;
    completeTodo(taskId: string, actor: BotActor): Promise<BasecampStep>;
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
    return Response.json(body, { status, headers });
}

function errorBody(code: string, error: string) {
    return { error, code };
}

function isTaskLookupError(value: unknown): value is Extract<BotTaskMatch, { ok: false }> {
    return !!value
        && typeof value === 'object'
        && 'ok' in value
        && value.ok === false
        && 'status' in value
        && 'code' in value
        && 'error' in value;
}

export async function basecampStepFromResponse(response: Response): Promise<BasecampStep> {
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.skipped === true) {
        const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason : undefined;
        return { status: 'skipped', ...(reason ? { reason } : {}) };
    }
    const providerValue = body?.todoId ?? body?.entryId;
    const providerId = typeof providerValue === 'string' || typeof providerValue === 'number'
        ? String(providerValue)
        : undefined;
    if (response.ok && body?.success !== false) {
        return { status: 'pushed', ...(providerId ? { providerId } : {}) };
    }
    const reason = typeof body?.error === 'string' && body.error.trim()
        ? body.error
        : `Basecamp sync failed (${response.status})`;
    if (response.status === 409) return { status: 'skipped', reason };
    return { status: 'failed', reason };
}

function resultBody(input: {
    key: BotKeyRecord;
    actor: BotActor;
    command: BotTimeCommand;
    task: BotTaskRecord;
    taskCreated: boolean;
    todo: BasecampStep;
    log: BotTimeLogRecord;
    timesheet: BasecampStep;
    completion: BasecampStep | null;
}) {
    return {
        idempotencyKey: input.command.idempotencyKey,
        bot: input.key.name,
        actor: { email: input.actor.email, userId: input.actor.userId, name: input.actor.name },
        task: {
            id: input.task.id,
            title: input.task.title,
            created: input.taskCreated,
            status: input.task.status,
            completedAt: input.task.completedAt,
            basecampTodoId: input.task.basecampTodoId,
            basecamp: input.todo,
        },
        timeLog: {
            id: input.log.id,
            date: input.log.date,
            hours: input.log.hours,
            minutes: input.log.minutes,
            countsTowardBudget: input.log.countsTowardBudget,
            billable: input.log.billable,
            description: input.log.description,
            basecampEntryId: input.log.basecampEntryId,
            basecamp: input.timesheet,
        },
        ...(input.completion ? { completion: input.completion } : {}),
    };
}

async function execute(
    key: BotKeyRecord,
    actor: BotActor,
    command: BotTimeCommand,
    operation: BotOperationRecord,
    deps: BotTimeDeps,
): Promise<{ status: number; body: unknown }> {
    const client = await deps.findClient(key.organizationId, command);
    if (client === 'ambiguous') {
        return { status: 409, body: errorBody('ambiguous_client', 'More than one client has that exact name.') };
    }
    if (!client || client.organizationId !== key.organizationId) {
        return { status: 404, body: errorBody('client_not_found', 'Client not found.') };
    }

    let task = operation.taskId ? await deps.getTask(operation.taskId) : null;
    if (!task) {
        let found = command.taskId
            ? await deps.getTask(command.taskId)
            : await deps.findTask(key.organizationId, client.id, command);
        if (found === 'ambiguous') {
            return { status: 409, body: errorBody('ambiguous_task', 'More than one task has that exact title.') };
        }
        if (isTaskLookupError(found)) {
            const canCreate = found.reason === 'missing'
                && command.createTask
                && !command.taskId
                && !command.parentTaskId
                && !command.parentTitle;
            if (!canCreate) return { status: found.status, body: errorBody(found.code, found.error) };
            found = null;
        }
        if (found && (found.organizationId !== key.organizationId || found.clientId !== client.id)) {
            return { status: 404, body: errorBody('task_not_found', 'Task not found.') };
        }
        if (found && command.taskTitle && found.title !== command.taskTitle) {
            return { status: 409, body: errorBody('ambiguous_task', 'taskId and taskTitle do not refer to the same task.') };
        }
        if (found && (command.parentTaskId || command.parentTitle)) {
            const parentId = found.parentTaskId ?? null;
            if (!parentId) {
                return { status: 409, body: errorBody('ambiguous_task', 'taskId is not a subtask of that parent.') };
            }
            if (command.parentTaskId && parentId !== command.parentTaskId) {
                return { status: 409, body: errorBody('ambiguous_task', 'taskId and parentTaskId do not refer to the same task.') };
            }
            if (command.parentTitle) {
                const parent = await deps.getTask(parentId);
                if (!parent || parent.title !== command.parentTitle) {
                    return { status: 409, body: errorBody('ambiguous_task', 'taskId and parentTitle do not refer to the same task.') };
                }
            }
        }
        if (found) {
            task = found;
        } else if (command.parentTaskId || command.parentTitle || !command.createTask || command.taskId) {
            return { status: 404, body: errorBody('task_not_found', 'Task not found.') };
        } else if (!command.taskTitle) {
            return { status: 400, body: errorBody('invalid_request', 'createTask requires taskTitle.') };
        } else {
            if (command.category && !isBuiltInTaskCategory(command.category)) {
                const existing = await deps.clientCategories(key.organizationId, client.id);
                if (!taskCategoryAllowed(command.category, existing)) {
                    return { status: 400, body: errorBody('invalid_request', TASK_CATEGORY_ERROR) };
                }
            }
            const inserted = await deps.insertTask({
                organizationId: key.organizationId,
                clientId: client.id,
                title: command.taskTitle,
                ...(command.category ? { category: command.category } : {}),
                ...(command.dueDate ? { dueDate: command.dueDate } : {}),
                actor,
                botKeyId: key.id,
                botOperationId: operation.id,
                now: deps.now().toISOString(),
            });
            if (inserted === 'conflict') {
                const again = await deps.findTask(key.organizationId, client.id, command);
                if (again === 'ambiguous' || !again || isTaskLookupError(again)) {
                    return { status: 500, body: errorBody('internal', 'Task could not be saved.') };
                }
                task = again;
            } else {
                task = inserted;
            }
        }
    }
    if (!task) return { status: 500, body: errorBody('internal', 'Task could not be saved.') };
    if (operation.taskId !== task.id) await deps.saveOperation(operation.id, { taskId: task.id });

    const todo = await deps.pushTodo(task.id, actor);
    task = await deps.getTask(task.id) ?? task;

    let log = operation.timeLogId ? await deps.getTimeLog(operation.timeLogId) : null;
    if (!log) log = await deps.findTimeLogByOperation(operation.id);
    if (!log) {
        const inserted = await deps.insertTimeLog({
            organizationId: key.organizationId,
            clientId: client.id,
            taskId: task.id,
            actor,
            command,
            botKeyId: key.id,
            botOperationId: operation.id,
        });
        log = inserted === 'conflict' ? await deps.findTimeLogByOperation(operation.id) : inserted;
    }
    if (!log) return { status: 500, body: errorBody('internal', 'Time entry could not be saved.') };
    if (operation.timeLogId !== log.id) await deps.saveOperation(operation.id, { timeLogId: log.id });

    const timesheet = await deps.syncTimesheet(log.id, actor);
    log = await deps.getTimeLog(log.id) ?? log;

    let completion: BasecampStep | null = null;
    if (command.complete && command.completedAt) {
        const write = taskStatusUpdate({
            previousStatus: task.status,
            status: 'done',
            now: deps.now().toISOString(),
            completedAt: command.completedAt,
            by: actor.userId,
        });
        if (!write.ok) return { status: 400, body: errorBody('completion_date', write.error) };
        if (write.changed) {
            const statusHistory = [...task.statusHistory, write.historyEntry];
            const saved = await deps.saveTask(task.id, {
                status: write.columns.status,
                completedAt: write.columns.completed_at,
                statusHistory,
            });
            if (!saved) return { status: 500, body: errorBody('internal', 'Task could not be completed.') };
            task = saved;
        } else {
            task = await deps.getTask(task.id) ?? task;
        }
        completion = task.basecampTodoId
            ? await deps.completeTodo(task.id, actor)
            : { status: 'skipped', reason: 'Task has no Basecamp to-do.' };
    }

    return {
        status: 200,
        body: resultBody({
            key,
            actor,
            command,
            task,
            taskCreated: task.botOperationId === operation.id,
            todo,
            log,
            timesheet,
            completion,
        }),
    };
}

export async function handleBotTimeRequest(request: Request, deps: BotTimeDeps): Promise<Response> {
    if (request.method.toUpperCase() !== 'POST') {
        return json(errorBody('forbidden', 'This key cannot call that route.'), 403);
    }

    const token = bearerToken(request.headers.get('authorization'));
    if (!token) return json(errorBody('missing_api_key', 'Missing API key. Send Authorization: Bearer <key>.'), 401);
    if (!isBotKeyToken(token)) return json(errorBody('invalid_api_key', 'Invalid API key.'), 401);

    const key = await deps.authenticate(token);
    if (!key || key.revokedAt) return json(errorBody('invalid_api_key', 'Invalid API key.'), 401);

    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return json(errorBody('invalid_json', 'Request body must be JSON.'), 400);
    }

    const parsed = parseBotTimeRequest(payload, deps.now());
    if (!parsed.ok) return json(errorBody(parsed.code, parsed.error), parsed.status);
    const command = parsed.command;

    const actor = await deps.actor(key.organizationId);
    if (!actor) {
        return json(errorBody('actor_not_found', 'Carlos Morones is not a member of this organization, so the entry cannot be attributed.'), 409);
    }

    let operation = await deps.findOperation(key.id, command.idempotencyKey);
    if (operation?.status === 'completed') {
        if (operation.requestHash !== command.requestHash) {
            return json(errorBody('idempotency_conflict', 'This idempotency key was already used with a different request.'), 409);
        }
        return json(operation.response, operation.httpStatus ?? 200, { 'Idempotent-Replayed': 'true' });
    }

    const nowIso = deps.now().toISOString();
    if (operation?.status === 'pending') {
        const age = deps.now().getTime() - Date.parse(operation.lockedAt);
        if (Number.isFinite(age) && age >= 0 && age < LOCK_MS) {
            return json(errorBody('idempotency_in_progress', 'This operation is still running. Retry the same request in a moment.'), 409);
        }
        await deps.saveOperation(operation.id, { lockedAt: nowIso });
    } else {
        const inserted = await deps.insertOperation({
            organizationId: key.organizationId,
            botKeyId: key.id,
            idempotencyKey: command.idempotencyKey,
            requestHash: command.requestHash,
            lockedAt: nowIso,
        });
        if (inserted === 'conflict') {
            operation = await deps.findOperation(key.id, command.idempotencyKey);
            if (operation?.status === 'completed' && operation.requestHash === command.requestHash) {
                return json(operation.response, operation.httpStatus ?? 200, { 'Idempotent-Replayed': 'true' });
            }
            return json(errorBody('idempotency_in_progress', 'This operation is still running. Retry the same request in a moment.'), 409);
        }
        operation = inserted;
    }
    if (!operation) return json(errorBody('internal', 'The operation could not be recorded.'), 500);

    try {
        const result = await execute(key, actor, command, operation, deps);
        if (result.status >= 200 && result.status < 500) {
            await deps.saveOperation(operation.id, {
                status: 'completed',
                httpStatus: result.status,
                response: result.body,
                lockedAt: deps.now().toISOString(),
            });
        } else {
            await deps.saveOperation(operation.id, { lockedAt: new Date(0).toISOString() });
        }
        return json(result.body, result.status);
    } catch {
        await deps.saveOperation(operation.id, { lockedAt: new Date(0).toISOString() }).catch(() => undefined);
        return json(errorBody('internal', 'Bot time entry failed.'), 500);
    }
}
