import { randomUUID } from 'node:crypto';

import { completionCalendarDay } from '../tasks/completion-date.ts';
import { taskStatusUpdate, type TaskStatusHistoryEntryLike } from '../tasks/status.ts';
import { authenticateBotRequest, type BotKeyRecord } from './auth.ts';
import { linkBasecampTodo, type BotBasecampTasks } from './basecamp-todo-link.ts';
import { BOT_ACTOR_TIME_ZONE } from './keys.ts';
import {
    parseBotRequest,
    type BotCommand,
    type BotCompleteCommand,
    type BotCreateCommand,
    type BotSubtaskDraft,
    type BotTaskTarget,
    type BotTimerPauseCommand,
    type BotTimerResumeCommand,
    type BotTimerStartCommand,
    type BotTimerStopCommand,
} from './request.ts';
import { BOT_TASKS_COMPLETE_PATH } from './scope.ts';
import { isBuiltInTaskCategory, isSeoManagerBot, TASK_CATEGORY_ERROR, taskCategoryAllowed } from './task-create.ts';
import type { BotTaskMatch } from './task-lookup.ts';
import { botTaskLinks } from './task-links.ts';
import {
    botTimerBasecampSummary,
    botTimerCloseOpen,
    botTimerDaySlicesFromStretches,
    botTimerMaxMs,
    botTimerPauseIsStale,
    closedRunningMs,
    combineStretchNote,
    hoursFromSeconds,
    type BotTimerDaySlice,
} from './timer.ts';

const LOCK_MS = 60_000;

const SEO_TASK_COMPLETION_BOT_NAMES = new Set([
    'seo-manager',
    'technical-seo',
    'on-page-seo',
    'content-writer',
    'copy-humanizer',
    'web-design-cro',
    'seo-strategist',
    'seo-revenue-framework',
    'seo-aeo-desk',
    'aeo-seo-bot',
    'ai-search-visibility',
    'performance-watch',
]);

const TWO_HOUR_CAP_MS = 2 * 60 * 60 * 1000;

/** The historical two-hour strings stay exact. Any other configured cap is named from its length. */
function capPhrase(maxMs: number): string {
    if (maxMs % (60 * 60 * 1000) === 0) {
        const hours = maxMs / (60 * 60 * 1000);
        return hours === 1 ? '1 hour' : `${hours} hours`;
    }
    if (maxMs % (60 * 1000) === 0) {
        const minutes = maxMs / (60 * 1000);
        return minutes === 1 ? '1 minute' : `${minutes} minutes`;
    }
    const seconds = Math.round(maxMs / 1000);
    return seconds === 1 ? '1 second' : `${seconds} seconds`;
}

function capNote(maxMs: number): string {
    if (maxMs === TWO_HOUR_CAP_MS) return 'Stopped automatically at the 2 hour cap.';
    return `Stopped automatically at the ${capPhrase(maxMs)} cap.`;
}

function capReason(maxMs: number): string {
    if (maxMs === TWO_HOUR_CAP_MS) {
        return 'Stopped at the 2 hour cap. Review it in SEO Ops before sending to Basecamp.';
    }
    return `Stopped at the ${capPhrase(maxMs)} cap. Review it in SEO Ops before sending to Basecamp.`;
}

function resumeCapMessage(maxMs: number): string {
    if (maxMs === TWO_HOUR_CAP_MS) {
        return 'This timer already has 2 hours of running time. Stop it instead of resuming.';
    }
    return `This timer already has ${capPhrase(maxMs)} of running time. Stop it instead of resuming.`;
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
    status: string | null;
    basecampProjectId?: string | null;
}

export interface BotTaskRecord {
    id: string;
    organizationId: string;
    clientId: string;
    projectId: string | null;
    initiativeId: string | null;
    title: string;
    status: string;
    priority?: string | null;
    completedAt: string | null;
    statusHistory: TaskStatusHistoryEntryLike[];
    basecampTodoId: string | null;
    basecampProjectId: string | null;
    parentTaskId: string | null;
    category: string | null;
    dueDate: string | null;
    botOperationId: string | null;
}

export interface BotCreatedTaskResult {
    task: BotTaskRecord;
    created: boolean;
    descriptionApplied?: boolean;
    basecampStepId?: string;
}

export interface BotTimerStretch {
    startedAt: string;
    endedAt: string;
    note: string | null;
}

export interface RunningBotTimer {
    id: string;
    organizationId: string;
    clientId: string;
    taskId: string;
    taskTitle: string;
    userId: string;
    botKeyId: string;
    /** Open stretch start. Null while this entry is paused. */
    startedAt: string | null;
    description: string | null;
    countsTowardBudget: boolean;
    billable: boolean;
    projectId: string | null;
    /** Closed stretches on this same time entry. */
    stretches: BotTimerStretch[];
    /** Note for the stretch that is open now. Null while paused. */
    openNote: string | null;
    /** When the latest stretch ended. Null while running. */
    pausedAt: string | null;
    /**
     * Running seconds on `elapsed_seconds` that no stored segment covers.
     * Rows paused before bot segments existed keep their time only there.
     * Zero or absent for rows whose segments hold all of their time.
     */
    carriedSeconds?: number;
    /** Local date the carried seconds belong to (`time_logs.date`). */
    carriedDate?: string | null;
}

export interface FinalizedBotLog {
    id: string;
    taskId: string;
    date: string;
    hours: number;
    minutes: number;
    description: string | null;
    countsTowardBudget: boolean;
    billable: boolean;
    status: 'logged' | 'needs_review';
    basecampEntryId: string | null;
}

export interface BasecampStep {
    status: 'pushed' | 'skipped' | 'failed' | 'not_sent';
    reason?: string;
    providerId?: string;
    subtasksSkipped?: number;
}

export interface BotDeps {
    now(): Date;
    authenticate(token: string): Promise<BotKeyRecord | null>;
    recordKeyUse(keyId: string): Promise<void>;
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
    findClient(organizationId: string, command: BotTaskTarget): Promise<BotClientRecord | null | 'ambiguous'>;
    clientCategories(organizationId: string, clientId: string): Promise<string[]>;
    findTask(
        organizationId: string,
        clientId: string,
        command: BotTaskTarget,
    ): Promise<BotTaskRecord | null | 'ambiguous' | (Extract<BotTaskMatch, { ok: false }> & { parentId?: string })>;
    getTask(taskId: string, organizationId?: string): Promise<BotTaskRecord | null>;
    insertTask(input: {
        organizationId: string;
        clientId: string;
        title: string;
        description?: string;
        category?: string;
        dueDate?: string;
        parentTaskId?: string;
        sortOrder?: number;
        actor: BotActor;
        botKeyId: string;
        botOperationId: string | null;
        now: string;
    }): Promise<BotTaskRecord | 'conflict'>;
    saveTask(task: BotTaskRecord, patch: {
        status: string;
        completedAt: string | null;
        statusHistory: TaskStatusHistoryEntryLike[];
    }): Promise<BotTaskRecord | null>;
    hasOpenTaskTimer(organizationId: string, taskId: string): Promise<boolean>;
    findRunningTimer(botKeyId: string): Promise<RunningBotTimer | null>;
    /** Paused entries for this bot. A paused entry does not occupy the running slot. */
    listPausedTimers(botKeyId: string): Promise<RunningBotTimer[]>;
    /** Every paused bot timer, for the stale-review sweep. */
    listAllPausedTimers(): Promise<RunningBotTimer[]>;
    /** Every running bot timer. The caller applies the configured cap, if any. */
    listOverdueTimers(now: Date): Promise<RunningBotTimer[]>;
    getTimer(id: string): Promise<RunningBotTimer | null>;
    insertRunningTimer(input: {
        organizationId: string;
        clientId: string;
        projectId: string | null;
        taskId: string;
        taskTitle: string;
        category: string | null;
        actor: BotActor;
        botKeyId: string;
        botOperationId: string;
        startedAt: string;
        date: string;
        description: string;
        /** Note for the first stretch. The task title is not a stretch note. */
        openNote: string | null;
        countsTowardBudget: boolean;
        billable: boolean;
    }): Promise<RunningBotTimer | 'conflict'>;
    /**
     * Close the open stretch and leave the same row paused.
     * A second call for the same stretch must not insert another segment.
     */
    pauseTimer(input: {
        timer: RunningBotTimer;
        stretch: BotTimerStretch;
        description: string;
        elapsedSeconds: number;
        hours: number;
    }): Promise<RunningBotTimer | null>;
    /**
     * Open a new stretch on a paused row. `conflict` means this bot already
     * has a running timer (the one-running index).
     */
    resumeTimer(input: {
        timer: RunningBotTimer;
        startedAt: string;
        openNote: string | null;
    }): Promise<RunningBotTimer | 'conflict' | null>;
    finalizeTimer(input: {
        timer: RunningBotTimer;
        stoppedAt: string;
        description: string;
        billable: boolean;
        countsTowardBudget: boolean;
        capped: boolean;
        stretches: BotTimerStretch[];
        slices: BotTimerDaySlice[];
        operationId: string;
        /** Set on the first row when this stop has an idempotency operation. */
        botOperationId: string | null;
        note: string | null;
    }): Promise<FinalizedBotLog[] | null>;
    pushTodo(taskId: string, actor: BotActor): Promise<BasecampStep>;
    basecampTasks: BotBasecampTasks;
    syncTimesheet(timeLogId: string, actor: BotActor): Promise<BasecampStep>;
    completeTodo(taskId: string, actor: BotActor): Promise<BasecampStep>;
}

/** Calendar date of an instant in `timeZone`, as YYYY-MM-DD. */
function localDate(instant: string, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date(instant));
}

function json(body: unknown, status: number, headers?: Record<string, string>): Response {
    return Response.json(body, { status, headers });
}

function errorBody(code: string, error: string, extra?: Record<string, unknown>) {
    return { error, code, ...extra };
}

const SAFE_DB_CODE = /^[A-Za-z0-9]{1,16}$/;

/**
 * A timer read failed. This is not a missing timer.
 * `dbCode` is a PostgREST or Postgres code only. Messages and row values stay off it.
 */
export class BotTimerLookupError extends Error {
    readonly dbCode: string;

    constructor(dbCode?: string) {
        super('Bot timer lookup failed');
        this.name = 'BotTimerLookupError';
        this.dbCode = dbCode && SAFE_DB_CODE.test(dbCode) ? dbCode : 'unknown';
    }
}

function timerLookupResponse(failure: BotTimerLookupError): Response {
    const code = failure.dbCode;
    console.error('bot timer lookup failed', { code });
    return json(errorBody('timer_lookup_failed', 'The timer could not be looked up.'), 500);
}

function isTaskLookupError(value: unknown): value is Extract<BotTaskMatch, { ok: false }> & { parentId?: string } {
    return !!value
        && typeof value === 'object'
        && 'ok' in value
        && (value as { ok: unknown }).ok === false
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
        const subtasksSkipped = typeof body?.subtasksSkipped === 'number' ? body.subtasksSkipped : 0;
        const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason : undefined;
        return {
            status: 'pushed',
            ...(providerId ? { providerId } : {}),
            ...(subtasksSkipped > 0 ? { subtasksSkipped, ...(reason ? { reason } : {}) } : {}),
        };
    }
    const reason = typeof body?.error === 'string' && body.error.trim()
        ? body.error
        : `Basecamp sync failed (${response.status})`;
    if (response.status === 409) return { status: 'skipped', reason };
    return { status: 'failed', reason };
}

function actorBody(actor: BotActor) {
    return { email: actor.email, userId: actor.userId, name: actor.name };
}

function taskLinks(task: Parameters<typeof botTaskLinks>[0]) {
    return botTaskLinks(task, process.env.NEXT_PUBLIC_SITE_URL);
}

function taskBody(task: BotTaskRecord) {
    return { id: task.id, title: task.title, status: task.status, completedAt: task.completedAt, ...taskLinks(task) };
}

async function timerTaskBody(deps: BotDeps, taskId: string, organizationId: string) {
    const task = await deps.getTask(taskId, organizationId);
    return task?.organizationId === organizationId ? { task: taskBody(task) } : {};
}

function isRunningTimer(timer: RunningBotTimer): boolean {
    return timer.pausedAt == null && timer.startedAt != null;
}

function timerBody(timer: RunningBotTimer, alreadyRunning: boolean) {
    return {
        id: timer.id,
        taskId: timer.taskId,
        taskTitle: timer.taskTitle,
        taskUrl: taskLinks({ id: timer.taskId }).url,
        startedAt: timer.startedAt,
        status: 'running' as const,
        alreadyRunning,
        stretches: timer.stretches,
    };
}

/** Closed running time: stored stretches plus any carried legacy seconds. */
function timerClosedMs(timer: RunningBotTimer): number {
    const carried = timer.carriedSeconds ?? 0;
    return closedRunningMs(timer.stretches) + (Number.isFinite(carried) && carried > 0 ? carried * 1000 : 0);
}

function pausedBody(timer: RunningBotTimer) {
    const seconds = Math.round(timerClosedMs(timer) / 1000);
    return {
        id: timer.id,
        taskId: timer.taskId,
        taskTitle: timer.taskTitle,
        taskUrl: taskLinks({ id: timer.taskId }).url,
        status: 'paused' as const,
        pausedAt: timer.pausedAt,
        elapsedSeconds: seconds,
        hours: hoursFromSeconds(seconds),
        stretches: timer.stretches,
    };
}

async function categoryAllowed(
    deps: BotDeps,
    organizationId: string,
    clientId: string,
    category: string | undefined,
    cache: { labels: string[] | null },
): Promise<string | null> {
    if (!category || isBuiltInTaskCategory(category)) return null;
    if (!cache.labels) cache.labels = await deps.clientCategories(organizationId, clientId);
    if (!taskCategoryAllowed(category, cache.labels)) return TASK_CATEGORY_ERROR;
    return null;
}

async function insertOrFind(input: {
    deps: BotDeps;
    key: BotKeyRecord;
    actor: BotActor;
    clientId: string;
    title: string;
    description?: string;
    category?: string;
    dueDate?: string;
    parentTaskId?: string;
    sortOrder?: number;
    /** Only one created row in a call can carry the operation id. */
    botOperationId: string | null;
    command: BotTaskTarget;
}): Promise<{ status: number; body: unknown } | BotCreatedTaskResult> {
    const inserted = await input.deps.insertTask({
        organizationId: input.key.organizationId,
        clientId: input.clientId,
        title: input.title,
        description: input.description,
        ...(input.category ? { category: input.category } : {}),
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
        ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        actor: input.actor,
        botKeyId: input.key.id,
        botOperationId: input.botOperationId,
        now: input.deps.now().toISOString(),
    });
    if (inserted !== 'conflict') return { task: inserted, created: true, descriptionApplied: Boolean(input.description) };
    const again = await input.deps.findTask(input.key.organizationId, input.clientId, {
        ...input.command,
        taskTitle: input.title,
        ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
    });
    if (!again || again === 'ambiguous' || isTaskLookupError(again)) {
        return { status: 500, body: errorBody('internal', 'Task could not be saved.') };
    }
    return { task: again, created: false };
}

async function findOrInsertSubtask(
    deps: BotDeps,
    key: BotKeyRecord,
    actor: BotActor,
    parent: BotTaskRecord,
    draft: BotSubtaskDraft,
    index: number,
    stamp: () => string | null,
) {
    const command = { taskTitle: draft.title, parentTaskId: parent.id };
    const existing = await deps.findTask(key.organizationId, parent.clientId, command);
    if (existing === 'ambiguous') {
        return { status: 409, body: errorBody('ambiguous_task', 'More than one subtask has that exact title under that parent.') };
    }
    if (existing && !isTaskLookupError(existing)) return { task: existing, created: false };
    if (isTaskLookupError(existing) && existing.reason !== 'missing') {
        return { status: existing.status, body: errorBody(existing.code, existing.error) };
    }
    return insertOrFind({
        deps, key, actor, clientId: parent.clientId,
        title: draft.title,
        description: draft.description,
        category: draft.category,
        dueDate: draft.dueDate,
        parentTaskId: parent.id,
        sortOrder: index,
        botOperationId: stamp(),
        command,
    });
}

async function createdTaskResponse(input: {
    deps: BotDeps;
    operation: BotOperationRecord;
    key: BotKeyRecord;
    actor: BotActor;
    root: BotTaskRecord;
    created: boolean;
    description?: string;
    linked: boolean;
    basecamp: BasecampStep;
    children: BotCreatedTaskResult[];
}): Promise<{ status: number; body: unknown }> {
    const { deps, operation, key, actor, root, created, linked, basecamp, children } = input;
    if (operation.taskId !== root.id) await deps.saveOperation(operation.id, { taskId: root.id });

    return {
        status: 200,
        body: {
            idempotencyKey: operation.idempotencyKey,
            bot: key.name,
            actor: actorBody(actor),
            task: {
                id: root.id,
                title: root.title,
                created,
                descriptionApplied: created && Boolean(input.description),
                linked,
                status: root.status,
                basecampTodoId: root.basecampTodoId,
                basecamp,
                ...taskLinks(root),
            },
            ...(children.length > 0 ? {
                subtasks: children.map(child => ({
                    id: child.task.id,
                    title: child.task.title,
                    created: child.created,
                    descriptionApplied: child.descriptionApplied ?? false,
                    parentTaskId: root.id,
                    ...(child.basecampStepId ? { basecampStepId: child.basecampStepId } : {}),
                    ...taskLinks(child.task),
                })),
            } : {}),
        },
    };
}

async function executeCreate(
    key: BotKeyRecord,
    actor: BotActor,
    command: BotCreateCommand,
    client: BotClientRecord | null | 'ambiguous',
    operation: BotOperationRecord,
    deps: BotDeps,
): Promise<{ status: number; body: unknown }> {
    if (!isSeoManagerBot(key.name)) {
        return {
            status: 403,
            body: errorBody('forbidden', 'Only the seo-manager bot can create tasks.'),
        };
    }
    if (client === 'ambiguous') {
        return { status: 409, body: errorBody('ambiguous_client', 'More than one client has that exact name.') };
    }
    if (!client || client.organizationId !== key.organizationId) {
        return { status: 404, body: errorBody('client_not_found', 'Client not found.') };
    }
    const labels = { labels: null as string[] | null };
    const categoryError = await categoryAllowed(deps, key.organizationId, client.id, command.category, labels);
    if (categoryError) return { status: 400, body: errorBody('invalid_request', categoryError) };
    for (const subtask of command.subtasks) {
        const subError = await categoryAllowed(deps, key.organizationId, client.id, subtask.category, labels);
        if (subError) return { status: 400, body: errorBody('invalid_request', subError) };
    }

    if (command.basecampTodoId) {
        const result = await linkBasecampTodo({
            command: { ...command, basecampTodoId: command.basecampTodoId },
            client, actor, botKeyId: key.id, operationId: operation.id, now: deps.now().toISOString(), deps,
            insertSubtask: (parent, draft, index) => findOrInsertSubtask(deps, key, actor, parent, draft, index, () => null),
        });
        if ('status' in result) return result;
        return createdTaskResponse({
            deps, operation, key, actor, root: result.task, created: result.created, linked: true,
            description: command.description,
            children: result.children, basecamp: result.basecamp,
        });
    }

    const found = await deps.findTask(key.organizationId, client.id, command);
    if (found === 'ambiguous') {
        return { status: 409, body: errorBody('ambiguous_task', 'More than one task has that exact title.') };
    }

    let root: BotTaskRecord;
    let rootCreated = false;
    const children: BotCreatedTaskResult[] = [];
    let operationStamped = false;
    const stamp = () => {
        if (operationStamped) return null;
        operationStamped = true;
        return operation.id;
    };

    if (command.parentTaskId || command.parentTitle) {
        if (isTaskLookupError(found)) {
            if (found.reason !== 'missing') return { status: found.status, body: errorBody(found.code, found.error) };
            const parentId = command.parentTaskId ?? found.parentId;
            if (!parentId) return { status: 404, body: errorBody('task_not_found', 'Parent task not found.') };
            const parent = await deps.getTask(parentId);
            if (!parent || parent.organizationId !== key.organizationId || parent.clientId !== client.id || parent.parentTaskId) {
                return { status: 404, body: errorBody('task_not_found', 'Parent task not found.') };
            }
            const inserted = await insertOrFind({
                deps, key, actor, clientId: client.id,
                title: command.taskTitle!,
                description: command.description,
                ...(command.category ? { category: command.category } : {}),
                ...(command.dueDate ? { dueDate: command.dueDate } : {}),
                parentTaskId: parent.id,
                botOperationId: stamp(),
                command,
            });
            if ('status' in inserted) return inserted;
            root = parent;
            children.push(inserted);
        } else if (!found) {
            return { status: 404, body: errorBody('task_not_found', 'Task not found.') };
        } else {
            root = await deps.getTask(found.parentTaskId ?? '') ?? found;
            children.push({ task: found, created: false });
        }
    } else if (isTaskLookupError(found)) {
        if (found.reason !== 'missing') return { status: found.status, body: errorBody(found.code, found.error) };
        const inserted = await insertOrFind({
            deps, key, actor, clientId: client.id,
            title: command.taskTitle!,
            description: command.description,
            ...(command.category ? { category: command.category } : {}),
            ...(command.dueDate ? { dueDate: command.dueDate } : {}),
            botOperationId: stamp(),
            command,
        });
        if ('status' in inserted) return inserted;
        root = inserted.task;
        rootCreated = inserted.created;
    } else if (!found) {
        return { status: 404, body: errorBody('task_not_found', 'Task not found.') };
    } else {
        root = found;
    }

    for (let index = 0; index < command.subtasks.length; index += 1) {
        const child = await findOrInsertSubtask(deps, key, actor, root, command.subtasks[index], index, stamp);
        if ('status' in child) return child;
        children.push(child);
    }

    const todo = await deps.pushTodo(root.id, actor);
    root = await deps.getTask(root.id) ?? root;
    const childrenWithLinks = await Promise.all(children.map(async child => {
        // A previously unlinked child's id written by the parent push is a step.
        // A preexisting link can also point to a standalone to-do.
        if (child.task.basecampTodoId || (todo.status !== 'pushed' && todo.status !== 'failed')) return child;
        const current = await deps.getTask(child.task.id);
        return { ...child, basecampStepId: current?.basecampTodoId ?? undefined };
    }));
    return createdTaskResponse({
        deps, operation, key, actor, root, created: rootCreated, linked: false,
        description: command.description,
        children: childrenWithLinks, basecamp: todo,
    });
}

async function resolveExistingTask(
    key: BotKeyRecord,
    command: BotTimerStartCommand,
    deps: BotDeps,
): Promise<{ status: number; body: unknown } | { clientId: string; task: BotTaskRecord }> {
    const client = await deps.findClient(key.organizationId, command);
    if (client === 'ambiguous') {
        return { status: 409, body: errorBody('ambiguous_client', 'More than one client has that exact name.') };
    }
    if (!client || client.organizationId !== key.organizationId) {
        return { status: 404, body: errorBody('client_not_found', 'Client not found.') };
    }
    const found = command.taskId
        ? await deps.getTask(command.taskId)
        : await deps.findTask(key.organizationId, client.id, command);
    if (found === 'ambiguous') {
        return { status: 409, body: errorBody('ambiguous_task', 'More than one task has that exact title.') };
    }
    if (isTaskLookupError(found)) return { status: found.status, body: errorBody(found.code, found.error) };
    if (found && (found.organizationId !== key.organizationId || found.clientId !== client.id)) {
        return { status: 404, body: errorBody('task_not_found', 'Task not found.') };
    }
    if (found && command.taskTitle && found.title !== command.taskTitle) {
        return { status: 409, body: errorBody('ambiguous_task', 'taskId and taskTitle do not refer to the same task.') };
    }
    if (found && (command.parentTaskId || command.parentTitle)) {
        const parentId = found.parentTaskId;
        if (!parentId) return { status: 409, body: errorBody('ambiguous_task', 'taskId is not a subtask of that parent.') };
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
    if (!found) return { status: 404, body: errorBody('task_not_found', 'Task not found.') };
    return { clientId: client.id, task: found };
}

function closedStretches(
    timer: RunningBotTimer,
    now: Date,
    pauseNote: string | null,
    maxMs: number | null,
): {
    stretches: BotTimerStretch[];
    /** Total running time after the close, carried legacy seconds included. */
    closedMs: number;
    capped: boolean;
    stoppedAt: string;
} {
    const decision = botTimerCloseOpen({
        openStartedAt: isRunningTimer(timer) ? timer.startedAt : null,
        closedMs: timerClosedMs(timer),
        now,
        maxMs,
    });
    if (!isRunningTimer(timer) || !timer.startedAt || !decision.openEndedAt) {
        const ended = timer.stretches[timer.stretches.length - 1]?.endedAt
            ?? timer.pausedAt
            ?? now.toISOString();
        return {
            stretches: timer.stretches,
            closedMs: decision.runningMs,
            capped: decision.capped,
            stoppedAt: ended,
        };
    }
    return {
        stretches: [...timer.stretches, {
            startedAt: timer.startedAt,
            endedAt: decision.openEndedAt,
            note: combineStretchNote(timer.openNote, pauseNote),
        }],
        closedMs: decision.runningMs,
        capped: decision.capped,
        stoppedAt: decision.openEndedAt,
    };
}

async function closeTimer(
    timer: RunningBotTimer,
    input: {
        stretches: BotTimerStretch[];
        stoppedAt: string;
        capped: boolean;
        maxMs: number | null;
        description: string;
        billable: boolean;
        countsTowardBudget: boolean;
        timeZone: string;
        botOperationId: string | null;
    },
    deps: BotDeps,
): Promise<{ status: number; body: unknown } | { logs: FinalizedBotLog[]; capped: boolean }> {
    const carriedSeconds = Math.round(Math.max(0, timer.carriedSeconds ?? 0));
    const slices = botTimerDaySlicesFromStretches(
        input.stretches,
        input.timeZone,
        carriedSeconds > 0
            ? { seconds: carriedSeconds, date: timer.carriedDate ?? localDate(timer.pausedAt ?? input.stoppedAt, input.timeZone) }
            : null,
    );
    if (slices.length === 0) return { status: 500, body: errorBody('internal', 'Timer could not be stopped.') };
    const logs = await deps.finalizeTimer({
        timer,
        stoppedAt: input.stoppedAt,
        description: input.description,
        billable: input.billable,
        countsTowardBudget: input.countsTowardBudget,
        capped: input.capped,
        stretches: input.stretches,
        slices,
        operationId: randomUUID(),
        botOperationId: input.botOperationId,
        note: input.capped && input.maxMs != null ? capNote(input.maxMs) : null,
    });
    if (!logs || logs.length === 0) return { status: 500, body: errorBody('internal', 'Timer could not be stopped.') };
    return { logs, capped: input.capped };
}

async function capTimer(timer: RunningBotTimer, deps: BotDeps, maxMs: number): Promise<FinalizedBotLog | null> {
    const closed = closedStretches(timer, deps.now(), null, maxMs);
    if (!closed.capped) return null;
    const seconds = Math.round(closed.closedMs / 1000);
    const summary = botTimerBasecampSummary({
        stretchNotes: closed.stretches.map(stretch => stretch.note),
        hours: hoursFromSeconds(seconds),
        startedAt: closed.stretches[0]?.startedAt,
        stoppedAt: closed.stoppedAt,
    });
    const finalized = await closeTimer(timer, {
        stretches: closed.stretches,
        stoppedAt: closed.stoppedAt,
        capped: true,
        maxMs,
        description: summary || timer.taskTitle,
        billable: timer.billable,
        countsTowardBudget: timer.countsTowardBudget,
        timeZone: BOT_ACTOR_TIME_ZONE,
        botOperationId: null,
    }, deps);
    if ('status' in finalized) return null;
    return finalized.logs[0] ?? null;
}

function cappedBody(log: FinalizedBotLog) {
    return {
        id: log.id,
        taskId: log.taskId,
        taskUrl: taskLinks({ id: log.taskId }).url,
        hours: log.hours,
        minutes: log.minutes,
        status: log.status,
        review: true,
    };
}

async function executeStart(
    key: BotKeyRecord,
    actor: BotActor,
    command: BotTimerStartCommand,
    operation: BotOperationRecord,
    deps: BotDeps,
    cappedJustNow: FinalizedBotLog | null,
): Promise<{ status: number; body: unknown }> {
    const resolved = await resolveExistingTask(key, command, deps);
    if ('status' in resolved) return resolved;
    const running = await deps.findRunningTimer(key.id);
    if (running) {
        if (running.taskId === resolved.task.id) {
            if (operation.timeLogId !== running.id) await deps.saveOperation(operation.id, { timeLogId: running.id, taskId: running.taskId });
            return {
                status: 200,
                body: {
                    idempotencyKey: command.idempotencyKey,
                    bot: key.name,
                    actor: actorBody(actor),
                    timer: timerBody(running, true),
                    task: taskBody(resolved.task),
                    ...(cappedJustNow ? { cappedTimer: cappedBody(cappedJustNow) } : {}),
                },
            };
        }
        return {
            status: 409,
            body: errorBody(
                'timer_already_running',
                'This bot already has a timer running. Stop it before starting another.',
                { timer: timerBody(running, true) },
            ),
        };
    }

    const paused = await deps.listPausedTimers(key.id);
    const sameTask = paused.find(timer => timer.taskId === resolved.task.id);
    if (sameTask) {
        if (operation.timeLogId !== sameTask.id) {
            await deps.saveOperation(operation.id, { timeLogId: sameTask.id, taskId: sameTask.taskId });
        }
        return {
            status: 409,
            body: errorBody(
                'timer_paused',
                'This task already has a paused timer. Resume it instead of starting another.',
                { timer: pausedBody(sameTask) },
            ),
        };
    }

    const date = completionCalendarDay(deps.now(), command.timeZone)
        ?? deps.now().toISOString().slice(0, 10);
    const inserted = await deps.insertRunningTimer({
        organizationId: key.organizationId,
        clientId: resolved.clientId,
        projectId: resolved.task.projectId,
        taskId: resolved.task.id,
        taskTitle: resolved.task.title,
        category: resolved.task.category,
        actor,
        botKeyId: key.id,
        botOperationId: operation.id,
        startedAt: deps.now().toISOString(),
        date,
        description: command.description ?? resolved.task.title,
        openNote: command.description ?? null,
        countsTowardBudget: command.countsTowardBudget,
        billable: command.billable,
    });
    const timer = inserted === 'conflict' ? await deps.findRunningTimer(key.id) : inserted;
    if (!timer) return { status: 500, body: errorBody('internal', 'Timer could not be started.') };
    if (inserted === 'conflict' && timer.taskId !== resolved.task.id) {
        return {
            status: 409,
            body: errorBody(
                'timer_already_running',
                'This bot already has a timer running. Stop it before starting another.',
                { timer: timerBody(timer, true) },
            ),
        };
    }
    await deps.saveOperation(operation.id, { timeLogId: timer.id, taskId: timer.taskId });
    return {
        status: 200,
        body: {
            idempotencyKey: command.idempotencyKey,
            bot: key.name,
            actor: actorBody(actor),
            timer: timerBody(timer, inserted === 'conflict'),
            task: taskBody(resolved.task),
            ...(cappedJustNow ? { cappedTimer: cappedBody(cappedJustNow) } : {}),
        },
    };
}

async function resolveStopTarget(
    key: BotKeyRecord,
    command: BotTimerStopCommand,
    deps: BotDeps,
): Promise<{ status: number; body: unknown } | { timer: RunningBotTimer }> {
    const running = await deps.findRunningTimer(key.id);
    const paused = await deps.listPausedTimers(key.id);
    if (running && (!command.taskId || command.taskId === running.taskId)) return { timer: running };
    if (command.taskId) {
        if (running && command.taskId !== running.taskId) {
            const match = paused.find(timer => timer.taskId === command.taskId);
            if (match) return { timer: match };
            return {
                status: 409,
                body: errorBody(
                    'timer_task_mismatch',
                    'The running timer is on a different task. Stop it without taskId, or send the running task.',
                    { timer: timerBody(running, true) },
                ),
            };
        }
        const match = paused.find(timer => timer.taskId === command.taskId);
        if (!match) return { status: 404, body: errorBody('timer_not_running', 'This bot does not have a timer running.') };
        return { timer: match };
    }
    if (paused.length === 1) return { timer: paused[0] };
    if (paused.length > 1) {
        return {
            status: 409,
            body: errorBody(
                'timer_ambiguous',
                'This bot has more than one paused timer. Send taskId to say which one to stop.',
                { timers: paused.map(pausedBody) },
            ),
        };
    }
    return { status: 404, body: errorBody('timer_not_running', 'This bot does not have a timer running.') };
}

async function executePause(
    key: BotKeyRecord,
    actor: BotActor,
    command: BotTimerPauseCommand,
    operation: BotOperationRecord,
    deps: BotDeps,
): Promise<{ status: number; body: unknown }> {
    const running = await deps.findRunningTimer(key.id);
    if (!running || running.organizationId !== key.organizationId) {
        if (operation.timeLogId) {
            const existing = await deps.getTimer(operation.timeLogId);
            if (existing?.pausedAt && existing.botKeyId === key.id) {
                return {
                    status: 200,
                    body: {
                        idempotencyKey: command.idempotencyKey,
                        bot: key.name,
                        actor: actorBody(actor),
                        timer: pausedBody(existing),
                        ...await timerTaskBody(deps, existing.taskId, key.organizationId),
                    },
                };
            }
        }
        return { status: 404, body: errorBody('timer_not_running', 'This bot does not have a timer running.') };
    }
    if (command.taskId && command.taskId !== running.taskId) {
        return {
            status: 409,
            body: errorBody(
                'timer_task_mismatch',
                'The running timer is on a different task. Pause it without taskId, or send the running task.',
                { timer: timerBody(running, true) },
            ),
        };
    }
    const taskResponse = await timerTaskBody(deps, running.taskId, key.organizationId);
    await deps.saveOperation(operation.id, { timeLogId: running.id, taskId: running.taskId });
    const maxMs = botTimerMaxMs();
    const closed = closedStretches(running, deps.now(), command.description ?? null, maxMs);
    if (closed.capped && maxMs != null) {
        const seconds = Math.round(closed.closedMs / 1000);
        const summary = botTimerBasecampSummary({
            stretchNotes: closed.stretches.map(stretch => stretch.note),
            hours: hoursFromSeconds(seconds),
            startedAt: closed.stretches[0]?.startedAt,
            stoppedAt: closed.stoppedAt,
        });
        const finalized = await closeTimer(running, {
            stretches: closed.stretches,
            stoppedAt: closed.stoppedAt,
            capped: true,
            maxMs,
            description: summary || running.taskTitle,
            billable: running.billable,
            countsTowardBudget: running.countsTowardBudget,
            timeZone: BOT_ACTOR_TIME_ZONE,
            botOperationId: operation.id,
        }, deps);
        if ('status' in finalized) return finalized;
        return {
            status: 200,
            body: {
                idempotencyKey: command.idempotencyKey,
                bot: key.name,
                actor: actorBody(actor),
                capped: true,
                review: true,
                ...taskResponse,
                timeLog: {
                    id: finalized.logs[0].id,
                    ...(!taskResponse.task ? { taskUrl: taskLinks({ id: running.taskId }).url } : {}),
                    date: finalized.logs[0].date,
                    hours: finalized.logs[0].hours,
                    minutes: finalized.logs[0].minutes,
                    status: finalized.logs[0].status,
                    description: finalized.logs[0].description,
                    basecamp: {
                        status: 'not_sent' as const,
                        reason: capReason(maxMs),
                    },
                },
            },
        };
    }
    const stretch = closed.stretches[closed.stretches.length - 1];
    if (!stretch) return { status: 500, body: errorBody('internal', 'Timer could not be paused.') };
    const description = botTimerBasecampSummary({
        stretchNotes: closed.stretches.map(item => item.note),
    }) || running.taskTitle;
    const seconds = Math.round(closed.closedMs / 1000);
    const paused = await deps.pauseTimer({
        timer: running,
        stretch,
        description,
        elapsedSeconds: seconds,
        hours: hoursFromSeconds(seconds),
    });
    if (!paused) return { status: 500, body: errorBody('internal', 'Timer could not be paused.') };
    return {
        status: 200,
        body: {
            idempotencyKey: command.idempotencyKey,
            bot: key.name,
            actor: actorBody(actor),
            timer: pausedBody(paused),
            ...taskResponse,
        },
    };
}

async function executeResume(
    key: BotKeyRecord,
    actor: BotActor,
    command: BotTimerResumeCommand,
    operation: BotOperationRecord,
    deps: BotDeps,
    cappedJustNow: FinalizedBotLog | null,
): Promise<{ status: number; body: unknown }> {
    const running = await deps.findRunningTimer(key.id);
    if (running) {
        if (operation.timeLogId === running.id) {
            return {
                status: 200,
                body: {
                    idempotencyKey: command.idempotencyKey,
                    bot: key.name,
                    actor: actorBody(actor),
                    timer: timerBody(running, false),
                    ...await timerTaskBody(deps, running.taskId, key.organizationId),
                    ...(cappedJustNow ? { cappedTimer: cappedBody(cappedJustNow) } : {}),
                },
            };
        }
        return {
            status: 409,
            body: errorBody(
                'timer_already_running',
                'This bot already has a timer running. Pause or stop it before resuming another.',
                { timer: timerBody(running, true) },
            ),
        };
    }
    const paused = (await deps.listPausedTimers(key.id)).find(timer => timer.taskId === command.taskId);
    if (!paused || paused.organizationId !== key.organizationId) {
        return { status: 404, body: errorBody('timer_not_paused', 'This bot does not have a paused timer on that task.') };
    }
    const maxMs = botTimerMaxMs();
    if (maxMs != null && timerClosedMs(paused) >= maxMs) {
        return {
            status: 409,
            body: errorBody(
                'timer_cap_reached',
                resumeCapMessage(maxMs),
                { timer: pausedBody(paused) },
            ),
        };
    }
    const taskResponse = await timerTaskBody(deps, paused.taskId, key.organizationId);
    await deps.saveOperation(operation.id, { timeLogId: paused.id, taskId: paused.taskId });
    const resumed = await deps.resumeTimer({
        timer: paused,
        startedAt: deps.now().toISOString(),
        openNote: command.description ?? null,
    });
    if (resumed === 'conflict') {
        const winner = await deps.findRunningTimer(key.id);
        return {
            status: 409,
            body: errorBody(
                'timer_already_running',
                'This bot already has a timer running. Pause or stop it before resuming another.',
                winner ? { timer: timerBody(winner, true) } : {},
            ),
        };
    }
    if (!resumed) return { status: 500, body: errorBody('internal', 'Timer could not be resumed.') };
    return {
        status: 200,
        body: {
            idempotencyKey: command.idempotencyKey,
            bot: key.name,
            actor: actorBody(actor),
            timer: timerBody(resumed, false),
            ...taskResponse,
            ...(cappedJustNow ? { cappedTimer: cappedBody(cappedJustNow) } : {}),
        },
    };
}

function alreadyCompleted(task: BotTaskRecord) {
    const completion: BasecampStep = { status: 'skipped', reason: 'Task is already done.' };
    return { task, completion, alreadyDone: true };
}

async function completeTask(
    task: BotTaskRecord,
    completedAt: string,
    actor: BotActor,
    deps: BotDeps,
    skipIfDone: boolean,
): Promise<{ status: number; body: unknown } | { task: BotTaskRecord; completion: BasecampStep; alreadyDone: boolean }> {
    if (skipIfDone && task.status === 'done') return alreadyCompleted(task);

    const write = taskStatusUpdate({
        previousStatus: task.status,
        status: 'done',
        now: deps.now().toISOString(),
        completedAt,
        by: actor.userId,
    });
    if (!write.ok) return { status: 400, body: errorBody('completion_date', write.error) };
    if (write.changed) {
        const saved = await deps.saveTask(task, {
            status: write.columns.status,
            completedAt: write.columns.completed_at,
            statusHistory: [...task.statusHistory, write.historyEntry],
        });
        if (!saved) {
            const current = await deps.getTask(task.id, task.organizationId);
            if (current?.status === 'done' && current.organizationId === task.organizationId) return alreadyCompleted(current);
            return { status: 500, body: errorBody('internal', 'Task could not be completed.') };
        }
        task = saved;
    }
    const completion: BasecampStep = task.basecampTodoId
        ? await deps.completeTodo(task.id, actor)
        : { status: 'skipped', reason: 'Task has no Basecamp to-do.' };
    return { task, completion, alreadyDone: false };
}

async function executeComplete(
    key: BotKeyRecord,
    actor: BotActor,
    command: BotCompleteCommand,
    operation: BotOperationRecord,
    deps: BotDeps,
): Promise<{ status: number; body: unknown }> {
    const task = await deps.getTask(command.taskId, key.organizationId);
    const notFound = { status: 404, body: errorBody('task_not_found', 'Task not found.') };
    if (!task || task.organizationId !== key.organizationId) return notFound;
    if (task.clientId) {
        const client = await deps.findClient(key.organizationId, { clientId: task.clientId });
        if (!client || client === 'ambiguous' || client.organizationId !== key.organizationId) return notFound;
        if (client.status === 'inactive') {
            return { status: 409, body: errorBody('client_inactive', 'Tasks cannot be completed for an inactive client.') };
        }
    }
    if (await deps.hasOpenTaskTimer(key.organizationId, task.id)) {
        return {
            status: 409,
            body: errorBody('timer_open', 'This task has an open timer. Stop it with complete: true instead.'),
        };
    }
    const result = await completeTask(task, command.completedAt, actor, deps, true);
    if ('status' in result) return result;
    await deps.saveOperation(operation.id, { taskId: task.id });
    return {
        status: 200,
        body: {
            idempotencyKey: command.idempotencyKey,
            bot: key.name,
            actor: actorBody(actor),
            task: taskBody(result.task),
            completion: result.completion,
            alreadyDone: result.alreadyDone,
        },
    };
}

async function executeStop(
    key: BotKeyRecord,
    actor: BotActor,
    command: BotTimerStopCommand,
    operation: BotOperationRecord,
    deps: BotDeps,
): Promise<{ status: number; body: unknown }> {
    const target = await resolveStopTarget(key, command, deps);
    if ('status' in target) return target;
    const timer = target.timer;
    const maxMs = botTimerMaxMs();
    const closed = closedStretches(timer, deps.now(), null, maxMs);
    const summary = botTimerBasecampSummary({
        stretchNotes: closed.stretches.map(stretch => stretch.note),
        stopNote: command.description,
        hours: hoursFromSeconds(Math.round(closed.closedMs / 1000)),
        minutes: Math.round(closed.closedMs / 60000),
        startedAt: closed.stretches[0]?.startedAt,
        stoppedAt: closed.stoppedAt,
    });
    const finalized = await closeTimer(timer, {
        stretches: closed.stretches,
        stoppedAt: closed.stoppedAt,
        capped: closed.capped,
        maxMs,
        description: summary || timer.taskTitle,
        billable: command.billable ?? timer.billable,
        countsTowardBudget: command.countsTowardBudget ?? timer.countsTowardBudget,
        timeZone: command.timeZone,
        botOperationId: operation.id,
    }, deps);
    if ('status' in finalized) return finalized;

    const steps: BasecampStep[] = [];
    if (!closed.capped) {
        for (const log of finalized.logs) {
            steps.push(await deps.syncTimesheet(log.id, actor));
        }
    }
    const primary = await refreshLog(finalized.logs[0], deps, steps[0]);
    let task = await deps.getTask(timer.taskId, key.organizationId);
    if (task?.organizationId !== key.organizationId) task = null;
    let completion: BasecampStep | null = null;
    if (command.complete && command.completedAt && task) {
        const result = await completeTask(task, command.completedAt, actor, deps, false);
        if ('status' in result) return result;
        ({ task, completion } = result);
    }
    await deps.saveOperation(operation.id, { timeLogId: primary.id, taskId: timer.taskId });
    const timesheet = closed.capped && maxMs != null
        ? { status: 'not_sent' as const, reason: capReason(maxMs) }
        : (steps[0] ?? { status: 'skipped' as const, reason: 'No timesheet step ran.' });
    return {
        status: 200,
        body: {
            idempotencyKey: command.idempotencyKey,
            bot: key.name,
            actor: actorBody(actor),
            capped: closed.capped,
            review: closed.capped,
            timeLog: {
                id: primary.id,
                ...(!task ? { taskUrl: taskLinks({ id: timer.taskId }).url } : {}),
                date: primary.date,
                hours: primary.hours,
                minutes: primary.minutes,
                status: primary.status,
                countsTowardBudget: primary.countsTowardBudget,
                billable: primary.billable,
                description: primary.description,
                basecampEntryId: primary.basecampEntryId,
                basecamp: timesheet,
                stretches: closed.stretches,
            },
            ...(finalized.logs.length > 1 ? { additionalTimeLogIds: finalized.logs.slice(1).map(log => log.id) } : {}),
            ...(task ? { task: taskBody(task) } : {}),
            ...(completion ? { completion } : {}),
        },
    };
}

async function refreshLog(log: FinalizedBotLog, deps: BotDeps, step: BasecampStep | undefined): Promise<FinalizedBotLog> {
    if (!step || step.status !== 'pushed' || !step.providerId) return log;
    return { ...log, basecampEntryId: step.providerId };
}

function runningPastCap(timer: RunningBotTimer, now: Date, maxMs: number | null): boolean {
    if (maxMs == null || !isRunningTimer(timer)) return false;
    return botTimerCloseOpen({
        openStartedAt: timer.startedAt,
        closedMs: timerClosedMs(timer),
        now,
        maxMs,
    }).capped;
}

async function capThisBot(keyId: string, deps: BotDeps): Promise<FinalizedBotLog | null> {
    const running = await deps.findRunningTimer(keyId);
    const maxMs = botTimerMaxMs();
    if (!running || maxMs == null || !runningPastCap(running, deps.now(), maxMs)) return null;
    return capTimer(running, deps, maxMs);
}

export interface StalePausedBotTimer {
    id: string;
    taskId: string;
    taskTitle: string;
    pausedAt: string;
}

/**
 * Close running bot timers past `BOT_TIMER_MAX_SECONDS`.
 * Unset means this caps nothing: no running timer is read or closed.
 * Paused timers stay paused. Ones paused for seven days are listed for review
 * and are not closed or sent to Basecamp.
 */
export async function capOverdueBotTimers(deps: BotDeps): Promise<{
    checked: number;
    capped: number;
    stalePaused: StalePausedBotTimer[];
}> {
    const maxMs = botTimerMaxMs();
    let checked = 0;
    let capped = 0;
    if (maxMs != null) {
        const overdue = (await deps.listOverdueTimers(deps.now())).filter(timer => runningPastCap(timer, deps.now(), maxMs));
        checked = overdue.length;
        for (const timer of overdue) {
            const log = await capTimer(timer, deps, maxMs);
            if (log) capped += 1;
        }
    }
    const now = deps.now();
    const stalePaused = (await deps.listAllPausedTimers())
        .filter(timer => timer.pausedAt && botTimerPauseIsStale(timer.pausedAt, now))
        .map(timer => ({
            id: timer.id,
            taskId: timer.taskId,
            taskTitle: timer.taskTitle,
            pausedAt: timer.pausedAt ?? '',
        }));
    return { checked, capped, stalePaused };
}

export async function handleBotRequest(request: Request, deps: BotDeps): Promise<Response> {
    const pathname = new URL(request.url).pathname;
    if (request.method.toUpperCase() !== 'POST') {
        return json(errorBody('forbidden', 'This key cannot call that route.'), 403);
    }
    const auth = await authenticateBotRequest(request, token => deps.authenticate(token));
    if ('response' in auth) return auth.response;
    const { key } = auth;
    if (pathname === BOT_TASKS_COMPLETE_PATH && !SEO_TASK_COMPLETION_BOT_NAMES.has(key.name.trim().toLowerCase())) {
        await deps.recordKeyUse(key.id);
        return json(errorBody('forbidden', 'Only SEO bots can complete tasks without a timer.'), 403);
    }

    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        await deps.recordKeyUse(key.id);
        return json(errorBody('invalid_json', 'Request body must be JSON.'), 400);
    }
    const parsed = parseBotRequest(pathname, payload, deps.now());
    if (!parsed.ok) {
        await deps.recordKeyUse(key.id);
        return json(errorBody(parsed.code, parsed.error), parsed.status);
    }
    const command: BotCommand = parsed.command;

    let createClient: BotClientRecord | null | 'ambiguous' = null;
    if (command.kind === 'create' && isSeoManagerBot(key.name)) {
        try {
            createClient = await deps.findClient(key.organizationId, command);
        } catch {
            return json(errorBody('internal', 'Bot request failed.'), 500);
        }
        if (createClient && createClient !== 'ambiguous'
            && createClient.organizationId === key.organizationId && createClient.status === 'inactive') {
            return json(errorBody('client_inactive', 'Tasks cannot be created for an inactive client.'), 409);
        }
    }

    await deps.recordKeyUse(key.id);
    const actor = await deps.actor(key.organizationId);
    if (!actor) {
        return json(errorBody('actor_not_found', 'Carlos Morones is not a member of this organization, so the entry cannot be attributed.'), 409);
    }

    // Pause and stop apply a configured cap in their own response.
    // With no cap, a long running timer stays open until pause or stop.
    let cappedJustNow: FinalizedBotLog | null = null;
    if (command.kind === 'start' || command.kind === 'resume' || (command.kind === 'create' && !command.basecampTodoId)) {
        try {
            cappedJustNow = await capThisBot(key.id, deps);
        } catch (error) {
            if (error instanceof BotTimerLookupError) return timerLookupResponse(error);
            throw error;
        }
    }

    let operation = await deps.findOperation(key.id, command.idempotencyKey);
    if (operation?.status === 'completed') {
        if (operation.requestHash !== command.requestHash) {
            return json(errorBody('idempotency_conflict', 'This idempotency key was already used with a different request.'), 409);
        }
        return json(operation.response, operation.httpStatus ?? 200, { 'Idempotent-Replayed': 'true' });
    }

    const nowIso = deps.now().toISOString();
    const requiresMatchingHash = command.kind === 'create' || command.kind === 'complete';
    if (operation?.status === 'pending') {
        if (requiresMatchingHash && operation.requestHash !== command.requestHash) {
            return json(errorBody('idempotency_conflict', 'This idempotency key was already used with a different request.'), 409);
        }
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
            if (requiresMatchingHash && operation && operation.requestHash !== command.requestHash) {
                return json(errorBody('idempotency_conflict', 'This idempotency key was already used with a different request.'), 409);
            }
            if (operation?.status === 'completed' && operation.requestHash === command.requestHash) {
                return json(operation.response, operation.httpStatus ?? 200, { 'Idempotent-Replayed': 'true' });
            }
            return json(errorBody('idempotency_in_progress', 'This operation is still running. Retry the same request in a moment.'), 409);
        }
        operation = inserted;
    }
    if (!operation) return json(errorBody('internal', 'The operation could not be recorded.'), 500);

    try {
        const result = command.kind === 'create'
            ? await executeCreate(key, actor, command, createClient, operation, deps)
            : command.kind === 'start'
                ? await executeStart(key, actor, command, operation, deps, cappedJustNow)
                : command.kind === 'pause'
                    ? await executePause(key, actor, command, operation, deps)
                    : command.kind === 'resume'
                        ? await executeResume(key, actor, command, operation, deps, cappedJustNow)
                            : command.kind === 'complete'
                                ? await executeComplete(key, actor, command, operation, deps)
                                : await executeStop(key, actor, command, operation, deps);
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
    } catch (error) {
        await deps.saveOperation(operation.id, { lockedAt: new Date(0).toISOString() }).catch(() => undefined);
        if (error instanceof BotTimerLookupError) return timerLookupResponse(error);
        return json(errorBody('internal', 'Bot request failed.'), 500);
    }
}
