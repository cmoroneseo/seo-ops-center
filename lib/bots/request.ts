import { createHash } from 'node:crypto';

import {
    COMPLETION_FUTURE_ERROR,
    resolveCompletionInstant,
} from '../tasks/completion-date.ts';
import { BOT_ACTOR_TIME_ZONE } from './keys.ts';
import {
    BOT_TASKS_COMPLETE_PATH,
    BOT_TASKS_PATH,
    BOT_TIMER_PAUSE_PATH,
    BOT_TIMER_RESUME_PATH,
    BOT_TIMER_START_PATH,
    BOT_TIMER_STOP_PATH,
} from './scope.ts';
import { TASK_CATEGORY_ERROR, taskCategoryShapeError } from './task-create.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$/;
const MAX_SUBTASKS = 20;
const TASK_DESCRIPTION_MAX_LENGTH = 5000;

const FORBIDDEN = new Set([
    'action',
    'actorId',
    'delete',
    'deleteTask',
    'deleteTimeLog',
    'destroy',
    'organizationId',
    'remove',
    'revoke',
    'role',
    'serviceRole',
    'settings',
    'updateSettings',
    'userId',
]);

export interface BotSubtaskDraft {
    title: string;
    description?: string;
    category?: string;
    dueDate?: string;
}

export interface BotTaskTarget {
    clientId?: string;
    clientName?: string;
    taskId?: string;
    taskTitle?: string;
    parentTaskId?: string;
    parentTitle?: string;
}

export interface BotCreateCommand extends BotTaskTarget {
    kind: 'create';
    idempotencyKey: string;
    requestHash: string;
    description?: string;
    category?: string;
    dueDate?: string;
    basecampTodoId?: string;
    subtasks: BotSubtaskDraft[];
}

export interface BotCompleteCommand {
    kind: 'complete';
    idempotencyKey: string;
    requestHash: string;
    taskId: string;
    completedAt: string;
}

export interface BotTimerStartCommand extends BotTaskTarget {
    kind: 'start';
    idempotencyKey: string;
    requestHash: string;
    description?: string;
    countsTowardBudget: boolean;
    billable: boolean;
    timeZone: string;
}

export interface BotTimerPauseCommand {
    kind: 'pause';
    idempotencyKey: string;
    requestHash: string;
    taskId?: string;
    description?: string;
}

export interface BotTimerResumeCommand {
    kind: 'resume';
    idempotencyKey: string;
    requestHash: string;
    taskId: string;
    description?: string;
}

export interface BotTimerStopCommand {
    kind: 'stop';
    idempotencyKey: string;
    requestHash: string;
    taskId?: string;
    description?: string;
    countsTowardBudget?: boolean;
    billable?: boolean;
    complete: boolean;
    completedAt?: string;
    timeZone: string;
}

export type BotCommand =
    | BotCreateCommand
    | BotCompleteCommand
    | BotTimerStartCommand
    | BotTimerPauseCommand
    | BotTimerResumeCommand
    | BotTimerStopCommand;

export type BotRequestParse =
    | { ok: true; command: BotCommand }
    | { ok: false; status: 400 | 403; code: string; error: string };

function fail(status: 400 | 403, code: string, error: string): BotRequestParse {
    return { ok: false, status, code, error };
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => (
            `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`
        )).join(',')}}`;
    }
    return JSON.stringify(value);
}

export function hashBotRequest(command: Record<string, unknown>): string {
    return createHash('sha256').update(stableStringify(command)).digest('hex');
}

function realDay(day: string): boolean {
    if (!DAY.test(day)) return false;
    const [year, month, date] = day.split('-').map(Number);
    const utc = new Date(Date.UTC(year, month - 1, date));
    return utc.getUTCFullYear() === year
        && utc.getUTCMonth() === month - 1
        && utc.getUTCDate() === date;
}

function text(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function rejectForbidden(record: Record<string, unknown>): BotRequestParse | null {
    for (const key of Object.keys(record)) {
        if (FORBIDDEN.has(key)) {
            return fail(403, 'forbidden', 'Bot keys cannot make that change.');
        }
    }
    return null;
}

function idempotencyKeyOf(record: Record<string, unknown>): BotRequestParse | { key: string } {
    const idempotencyKey = text(record.idempotencyKey);
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
        return fail(400, 'invalid_request', 'idempotencyKey is required. Use 8 to 200 letters, numbers, colon, underscore, dot, or dash.');
    }
    return { key: idempotencyKey };
}

function timeZoneOf(record: Record<string, unknown>): BotRequestParse | { timeZone: string } {
    const timeZone = text(record.timeZone) ?? BOT_ACTOR_TIME_ZONE;
    try {
        Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    } catch {
        return fail(400, 'invalid_request', 'timeZone must be an IANA zone such as America/Los_Angeles.');
    }
    return { timeZone };
}

function categoryOf(value: unknown): BotRequestParse | { category?: string } {
    if (value == null || value === '') return {};
    if (typeof value !== 'string') return fail(400, 'invalid_request', TASK_CATEGORY_ERROR);
    const category = text(value);
    const shape = category ? taskCategoryShapeError(category) : 'category must be one line.';
    if (!category || shape) return fail(400, 'invalid_request', shape ?? TASK_CATEGORY_ERROR);
    return { category };
}

function dueDateOf(value: unknown): BotRequestParse | { dueDate?: string } {
    if (value == null || value === '') return {};
    const dueDate = text(value);
    if (!dueDate || !realDay(dueDate)) return fail(400, 'invalid_request', 'dueDate must be YYYY-MM-DD.');
    return { dueDate };
}

function clientOf(record: Record<string, unknown>): BotRequestParse | Pick<BotTaskTarget, 'clientId' | 'clientName'> {
    const clientId = text(record.clientId);
    const clientName = text(record.clientName);
    if (clientId && !UUID.test(clientId)) return fail(400, 'invalid_request', 'clientId must be a UUID.');
    if (!clientId && !clientName) return fail(400, 'invalid_request', 'Send clientId or clientName.');
    if (clientName && clientName.length > 200) return fail(400, 'invalid_request', 'clientName is too long.');
    return {
        ...(clientId ? { clientId } : {}),
        ...(clientName ? { clientName } : {}),
    };
}

function targetOf(record: Record<string, unknown>, requireTask: boolean): BotRequestParse | BotTaskTarget {
    const client = clientOf(record);
    if ('ok' in client) return client;
    const taskId = text(record.taskId);
    const taskTitle = text(record.taskTitle);
    const parentTaskId = text(record.parentTaskId);
    const parentTitle = text(record.parentTitle);
    if (taskId && !UUID.test(taskId)) return fail(400, 'invalid_request', 'taskId must be a UUID.');
    if (requireTask && !taskId && !taskTitle) return fail(400, 'invalid_request', 'Send taskId or taskTitle.');
    if (taskTitle && taskTitle.length > 300) return fail(400, 'invalid_request', 'taskTitle is too long.');
    if (parentTaskId && !UUID.test(parentTaskId)) return fail(400, 'invalid_request', 'parentTaskId must be a UUID.');
    if (parentTitle && parentTitle.length > 300) return fail(400, 'invalid_request', 'parentTitle is too long.');
    if ((parentTaskId || parentTitle) && !taskTitle && !taskId) {
        return fail(400, 'invalid_request', 'Send taskTitle with parentTaskId or parentTitle.');
    }
    return {
        ...client,
        ...(taskId ? { taskId } : {}),
        ...(taskTitle ? { taskTitle } : {}),
        ...(parentTaskId ? { parentTaskId } : {}),
        ...(parentTitle ? { parentTitle } : {}),
    };
}

function descriptionOf(value: unknown, maxLength: number): BotRequestParse | { description?: string } {
    if (value === undefined) return {};
    if (typeof value !== 'string') return fail(400, 'invalid_request', 'description must be text.');
    const description = value.trim();
    if (description.length > maxLength) return fail(400, 'invalid_request', `description must be ${maxLength} characters or fewer.`);
    return description ? { description } : {};
}

function timerDescriptionOf(record: Record<string, unknown>) {
    return descriptionOf(record.description ?? undefined, 2000);
}

function boolOf(record: Record<string, unknown>, key: 'countsTowardBudget' | 'billable' | 'complete'): BotRequestParse | boolean | undefined {
    if (!(key in record)) return undefined;
    if (typeof record[key] !== 'boolean') {
        return fail(400, 'invalid_request', `${key} must be true or false.`);
    }
    return record[key];
}

function unknownFields(record: Record<string, unknown>, allowed: Set<string>): BotRequestParse | null {
    for (const key of Object.keys(record)) {
        if (!allowed.has(key)) return fail(400, 'unknown_field', `Unknown field: ${key}`);
    }
    return null;
}

const CREATE_FIELDS = new Set([
    'idempotencyKey', 'clientId', 'clientName', 'taskId', 'taskTitle',
    'parentTaskId', 'parentTitle', 'description', 'category', 'dueDate', 'subtasks', 'basecampTodoId',
]);

const COMPLETE_FIELDS = new Set(['idempotencyKey', 'taskId', 'completedOn', 'timeZone']);

const START_FIELDS = new Set([
    'idempotencyKey', 'clientId', 'clientName', 'taskId', 'taskTitle',
    'parentTaskId', 'parentTitle', 'description', 'countsTowardBudget',
    'billable', 'timeZone',
]);

const STOP_FIELDS = new Set([
    'idempotencyKey', 'taskId', 'description', 'countsTowardBudget',
    'billable', 'complete', 'completedOn', 'timeZone',
]);

const PAUSE_FIELDS = new Set(['idempotencyKey', 'taskId', 'description']);

const RESUME_FIELDS = new Set(['idempotencyKey', 'taskId', 'description']);

function subtasksOf(value: unknown): BotRequestParse | { subtasks: BotSubtaskDraft[] } {
    if (value == null) return { subtasks: [] };
    if (!Array.isArray(value)) return fail(400, 'invalid_request', 'subtasks must be a list.');
    if (value.length > MAX_SUBTASKS) {
        return fail(400, 'invalid_request', `subtasks can include at most ${MAX_SUBTASKS} items.`);
    }
    const subtasks: BotSubtaskDraft[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            return fail(400, 'invalid_request', 'Each subtask must be an object with a title.');
        }
        const row = item as Record<string, unknown>;
        for (const key of Object.keys(row)) {
            if (key !== 'title' && key !== 'description' && key !== 'category' && key !== 'dueDate') {
                return fail(400, 'unknown_field', `Unknown field: subtasks.${key}`);
            }
        }
        const title = text(row.title);
        if (!title) return fail(400, 'invalid_request', 'Each subtask needs a title.');
        if (title.length > 300) return fail(400, 'invalid_request', 'A subtask title is too long.');
        if (seen.has(title)) return fail(400, 'invalid_request', 'Subtask titles in one call must be unique.');
        seen.add(title);
        const description = descriptionOf(row.description, TASK_DESCRIPTION_MAX_LENGTH);
        if ('ok' in description) return description;
        const category = categoryOf(row.category);
        if ('ok' in category) return category;
        const dueDate = dueDateOf(row.dueDate);
        if ('ok' in dueDate) return dueDate;
        subtasks.push({
            title,
            ...description,
            ...(category.category ? { category: category.category } : {}),
            ...(dueDate.dueDate ? { dueDate: dueDate.dueDate } : {}),
        });
    }
    return { subtasks };
}

function withHash<T extends { kind: BotCommand['kind']; requestHash: string }>(
    command: Omit<T, 'requestHash'>,
): T {
    const { kind, ...rest } = command;
    void kind;
    return { ...command, requestHash: hashBotRequest(rest) } as unknown as T;
}

function parseCreate(record: Record<string, unknown>): BotRequestParse {
    const unknown = unknownFields(record, CREATE_FIELDS);
    if (unknown) return unknown;
    const key = idempotencyKeyOf(record);
    if ('ok' in key) return key;
    let basecampTodoId: string | undefined;
    if ('basecampTodoId' in record) {
        const raw = typeof record.basecampTodoId === 'number' ? String(record.basecampTodoId) : text(record.basecampTodoId);
        const id = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
        if (!Number.isSafeInteger(id) || id <= 0) {
            return fail(400, 'invalid_request', 'basecampTodoId must be a positive integer.');
        }
        if ('parentTaskId' in record || 'parentTitle' in record) {
            return fail(400, 'invalid_request', 'basecampTodoId is only for top-level tasks.');
        }
        basecampTodoId = String(id);
    }
    const target = targetOf(record, !basecampTodoId);
    if ('ok' in target) return target;
    if (!target.taskTitle && !basecampTodoId) return fail(400, 'invalid_request', 'create requires taskTitle.');
    if (target.taskId) return fail(400, 'invalid_request', 'Creating a task does not take taskId. Send taskTitle.');
    const description = descriptionOf(record.description, TASK_DESCRIPTION_MAX_LENGTH);
    if ('ok' in description) return description;
    const category = categoryOf(record.category);
    if ('ok' in category) return category;
    const dueDate = dueDateOf(record.dueDate);
    if ('ok' in dueDate) return dueDate;
    const subtasks = subtasksOf(record.subtasks);
    if ('ok' in subtasks) return subtasks;
    if (subtasks.subtasks.length > 0 && (target.parentTaskId || target.parentTitle)) {
        return fail(400, 'invalid_request', 'Send a parent with subtasks, or a subtask under an existing parent, not both.');
    }
    return {
        ok: true,
        command: withHash<BotCreateCommand>({
            kind: 'create',
            idempotencyKey: key.key,
            ...target,
            ...description,
            ...(basecampTodoId ? { basecampTodoId } : {}),
            ...(category.category ? { category: category.category } : {}),
            ...(dueDate.dueDate ? { dueDate: dueDate.dueDate } : {}),
            subtasks: subtasks.subtasks,
        }),
    };
}

function completionDateOf(completedOn: string | undefined, timeZone: string, now: Date): BotRequestParse | { completedAt: string } {
    const resolved = resolveCompletionInstant({
        choice: completedOn ? { kind: 'day', day: completedOn } : { kind: 'today' },
        now,
        timeZone,
    });
    if (!resolved.ok) return fail(400, 'completion_date', resolved.error || COMPLETION_FUTURE_ERROR);
    return { completedAt: resolved.completedAt };
}

function parseComplete(record: Record<string, unknown>, now: Date): BotRequestParse {
    const unknown = unknownFields(record, COMPLETE_FIELDS);
    if (unknown) return unknown;
    const key = idempotencyKeyOf(record);
    if ('ok' in key) return key;
    const taskId = text(record.taskId);
    if (!taskId || !UUID.test(taskId)) return fail(400, 'invalid_request', 'taskId must be a UUID.');
    if ('timeZone' in record && typeof record.timeZone !== 'string') {
        return fail(400, 'invalid_request', 'timeZone must be an IANA zone such as America/Los_Angeles.');
    }
    const zone = timeZoneOf(record);
    if ('ok' in zone) return zone;
    const completedOn = text(record.completedOn);
    if ('completedOn' in record && (!completedOn || !realDay(completedOn))) {
        return fail(400, 'completion_date', 'Enter a real date.');
    }
    const completion = completionDateOf(completedOn, zone.timeZone, now);
    if ('ok' in completion) return completion;
    const request = { kind: 'complete' as const, idempotencyKey: key.key, taskId };
    return {
        ok: true,
        command: {
            ...request,
            ...completion,
            // Today resolves to the current instant. Hash the requested day so a retry can replay it.
            requestHash: hashBotRequest({ ...request, completedOn: completedOn ?? null, timeZone: zone.timeZone }),
        },
    };
}

function parseStart(record: Record<string, unknown>): BotRequestParse {
    const unknown = unknownFields(record, START_FIELDS);
    if (unknown) return unknown;
    const key = idempotencyKeyOf(record);
    if ('ok' in key) return key;
    const target = targetOf(record, true);
    if ('ok' in target) return target;
    const description = timerDescriptionOf(record);
    if ('ok' in description) return description;
    const counts = boolOf(record, 'countsTowardBudget');
    if (counts && typeof counts === 'object') return counts;
    const billable = boolOf(record, 'billable');
    if (billable && typeof billable === 'object') return billable;
    const zone = timeZoneOf(record);
    if ('ok' in zone) return zone;
    return {
        ok: true,
        command: withHash<BotTimerStartCommand>({
            kind: 'start',
            idempotencyKey: key.key,
            ...target,
            ...description,
            countsTowardBudget: counts !== false,
            billable: billable !== false,
            timeZone: zone.timeZone,
        }),
    };
}

function parsePause(record: Record<string, unknown>): BotRequestParse {
    const unknown = unknownFields(record, PAUSE_FIELDS);
    if (unknown) return unknown;
    const key = idempotencyKeyOf(record);
    if ('ok' in key) return key;
    const taskId = text(record.taskId);
    if (taskId && !UUID.test(taskId)) return fail(400, 'invalid_request', 'taskId must be a UUID.');
    const description = timerDescriptionOf(record);
    if ('ok' in description) return description;
    return {
        ok: true,
        command: withHash<BotTimerPauseCommand>({
            kind: 'pause',
            idempotencyKey: key.key,
            ...(taskId ? { taskId } : {}),
            ...description,
        }),
    };
}

function parseResume(record: Record<string, unknown>): BotRequestParse {
    const unknown = unknownFields(record, RESUME_FIELDS);
    if (unknown) return unknown;
    const key = idempotencyKeyOf(record);
    if ('ok' in key) return key;
    const taskId = text(record.taskId);
    if (!taskId || !UUID.test(taskId)) return fail(400, 'invalid_request', 'taskId must be a UUID.');
    const description = timerDescriptionOf(record);
    if ('ok' in description) return description;
    return {
        ok: true,
        command: withHash<BotTimerResumeCommand>({
            kind: 'resume',
            idempotencyKey: key.key,
            taskId,
            ...description,
        }),
    };
}

function parseStop(record: Record<string, unknown>, now: Date): BotRequestParse {
    const unknown = unknownFields(record, STOP_FIELDS);
    if (unknown) return unknown;
    const key = idempotencyKeyOf(record);
    if ('ok' in key) return key;
    const taskId = text(record.taskId);
    if (taskId && !UUID.test(taskId)) return fail(400, 'invalid_request', 'taskId must be a UUID.');
    const description = timerDescriptionOf(record);
    if ('ok' in description) return description;
    const counts = boolOf(record, 'countsTowardBudget');
    if (counts && typeof counts === 'object') return counts;
    const billable = boolOf(record, 'billable');
    if (billable && typeof billable === 'object') return billable;
    const completeFlag = boolOf(record, 'complete');
    if (completeFlag && typeof completeFlag === 'object') return completeFlag;
    const complete = completeFlag === true;
    const zone = timeZoneOf(record);
    if ('ok' in zone) return zone;
    let completedAt: string | undefined;
    if (complete) {
        const resolved = completionDateOf(text(record.completedOn), zone.timeZone, now);
        if ('ok' in resolved) return resolved;
        completedAt = resolved.completedAt;
    } else if ('completedOn' in record && record.completedOn != null && record.completedOn !== '') {
        return fail(400, 'invalid_request', 'completedOn is only used when complete is true.');
    }
    return {
        ok: true,
        command: withHash<BotTimerStopCommand>({
            kind: 'stop',
            idempotencyKey: key.key,
            ...(taskId ? { taskId } : {}),
            ...description,
            ...(counts !== undefined ? { countsTowardBudget: counts } : {}),
            ...(billable !== undefined ? { billable } : {}),
            complete,
            ...(completedAt ? { completedAt } : {}),
            timeZone: zone.timeZone,
        }),
    };
}

export function parseBotRequest(pathname: string, body: unknown, now: Date): BotRequestParse {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return fail(400, 'invalid_request', 'Request body must be a JSON object.');
    }
    const record = body as Record<string, unknown>;
    const forbidden = rejectForbidden(record);
    if (forbidden) return forbidden;
    if (pathname === BOT_TASKS_PATH) return parseCreate(record);
    if (pathname === BOT_TASKS_COMPLETE_PATH) return parseComplete(record, now);
    if (pathname === BOT_TIMER_START_PATH) return parseStart(record);
    if (pathname === BOT_TIMER_PAUSE_PATH) return parsePause(record);
    if (pathname === BOT_TIMER_RESUME_PATH) return parseResume(record);
    if (pathname === BOT_TIMER_STOP_PATH) return parseStop(record, now);
    return fail(403, 'forbidden', 'This key cannot call that route.');
}
