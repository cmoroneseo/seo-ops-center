import { createHash } from 'node:crypto';

import { safeHref } from '../links/safe-href.ts';
import {
    COMPLETION_FUTURE_ERROR,
    completionCalendarDay,
    resolveCompletionInstant,
} from '../tasks/completion-date.ts';
import { BOT_ACTOR_TIME_ZONE } from './keys.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$/;
const CATEGORIES = new Set(['content', 'technical', 'local', 'links', 'strategy', 'admin']);
const MAX_HOURS = 24;

const ALLOWED = new Set([
    'idempotencyKey',
    'clientId',
    'clientName',
    'taskId',
    'taskTitle',
    'createTask',
    'category',
    'dueDate',
    'date',
    'minutes',
    'hours',
    'description',
    'referenceLink',
    'countsTowardBudget',
    'billable',
    'complete',
    'completedOn',
    'timeZone',
]);

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

export interface BotTimeCommand {
    idempotencyKey: string;
    requestHash: string;
    clientId?: string;
    clientName?: string;
    taskId?: string;
    taskTitle?: string;
    createTask: boolean;
    category?: string;
    dueDate?: string;
    date: string;
    hours: number;
    minutes: number;
    description?: string;
    referenceLink?: { label: string; url: string };
    countsTowardBudget: boolean;
    billable: boolean;
    complete: boolean;
    completedAt?: string;
    timeZone: string;
}

export type BotRequestParse =
    | { ok: true; command: BotTimeCommand }
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

export function hashBotRequest(command: Omit<BotTimeCommand, 'requestHash'>): string {
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

function roundHours(value: number): number {
    return Math.round(value * 100) / 100;
}

function text(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export function parseBotTimeRequest(body: unknown, now: Date): BotRequestParse {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return fail(400, 'invalid_request', 'Request body must be a JSON object.');
    }
    const record = body as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (FORBIDDEN.has(key)) {
            return fail(403, 'forbidden', 'This key cannot do that. It can log time, create a task, and mark a task done.');
        }
        if (!ALLOWED.has(key)) {
            return fail(400, 'unknown_field', `Unknown field: ${key}`);
        }
    }

    const idempotencyKey = text(record.idempotencyKey);
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
        return fail(400, 'invalid_request', 'idempotencyKey is required. Use 8 to 200 letters, numbers, colon, underscore, dot, or dash.');
    }

    const clientId = text(record.clientId);
    const clientName = text(record.clientName);
    if (clientId && !UUID.test(clientId)) return fail(400, 'invalid_request', 'clientId must be a UUID.');
    if (!clientId && !clientName) return fail(400, 'invalid_request', 'Send clientId or clientName.');
    if (clientName && clientName.length > 200) return fail(400, 'invalid_request', 'clientName is too long.');

    const taskId = text(record.taskId);
    const taskTitle = text(record.taskTitle);
    if (taskId && !UUID.test(taskId)) return fail(400, 'invalid_request', 'taskId must be a UUID.');
    if (!taskId && !taskTitle) return fail(400, 'invalid_request', 'Send taskId or taskTitle.');
    if (taskTitle && taskTitle.length > 300) return fail(400, 'invalid_request', 'taskTitle is too long.');

    if ('createTask' in record && typeof record.createTask !== 'boolean') {
        return fail(400, 'invalid_request', 'createTask must be true or false.');
    }
    const createTask = record.createTask === true;

    let category: string | undefined;
    if ('category' in record && record.category != null && record.category !== '') {
        category = text(record.category);
        if (!category || !CATEGORIES.has(category)) {
            return fail(400, 'invalid_request', 'category must be content, technical, local, links, strategy, or admin.');
        }
    }

    let dueDate: string | undefined;
    if ('dueDate' in record && record.dueDate != null && record.dueDate !== '') {
        dueDate = text(record.dueDate);
        if (!dueDate || !realDay(dueDate)) return fail(400, 'invalid_request', 'dueDate must be YYYY-MM-DD.');
    }

    const timeZone = text(record.timeZone) ?? BOT_ACTOR_TIME_ZONE;
    try {
        Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    } catch {
        return fail(400, 'invalid_request', 'timeZone must be an IANA zone such as America/Los_Angeles.');
    }

    const date = text(record.date);
    if (!date || !realDay(date)) return fail(400, 'invalid_request', 'date must be YYYY-MM-DD.');
    const today = completionCalendarDay(now, timeZone);
    if (!today) return fail(400, 'invalid_request', 'date must be YYYY-MM-DD.');
    if (date > today) return fail(400, 'invalid_request', 'date cannot be in the future.');

    const hasMinutes = 'minutes' in record && record.minutes != null && record.minutes !== '';
    const hasHours = 'hours' in record && record.hours != null && record.hours !== '';
    if (!hasMinutes && !hasHours) return fail(400, 'invalid_request', 'Send minutes or hours.');

    let hours: number | undefined;
    let minutes: number | undefined;
    if (hasMinutes) {
        if (typeof record.minutes !== 'number' || !Number.isInteger(record.minutes) || record.minutes <= 0 || record.minutes > MAX_HOURS * 60) {
            return fail(400, 'invalid_request', 'minutes must be a whole number from 1 to 1440.');
        }
        minutes = record.minutes;
        hours = roundHours(minutes / 60);
    }
    if (hasHours) {
        if (typeof record.hours !== 'number' || !Number.isFinite(record.hours) || record.hours <= 0 || record.hours > MAX_HOURS) {
            return fail(400, 'invalid_request', 'hours must be greater than 0 and at most 24.');
        }
        const rounded = roundHours(record.hours);
        if (Math.abs(rounded - record.hours) > 0.001) {
            return fail(400, 'invalid_request', 'hours can have at most two decimal places.');
        }
        if (hours !== undefined && Math.abs(hours - rounded) > 0.01) {
            return fail(400, 'invalid_request', 'minutes and hours do not describe the same amount of time.');
        }
        hours = rounded;
        minutes = minutes ?? Math.round(rounded * 60);
    }
    if (hours === undefined || minutes === undefined || hours <= 0) {
        return fail(400, 'invalid_request', 'Send minutes or hours.');
    }

    let description: string | undefined;
    if ('description' in record && record.description != null && record.description !== '') {
        if (typeof record.description !== 'string') return fail(400, 'invalid_request', 'description must be text.');
        description = record.description.trim();
        if (description.length > 2000) return fail(400, 'invalid_request', 'description must be 2000 characters or fewer.');
        if (!description) description = undefined;
    }

    let referenceLink: { label: string; url: string } | undefined;
    if ('referenceLink' in record && record.referenceLink != null && record.referenceLink !== '') {
        if (typeof record.referenceLink !== 'string') return fail(400, 'invalid_request', 'referenceLink must be an http(s) URL.');
        const url = safeHref(record.referenceLink.trim());
        if (!url || url.startsWith('/')) return fail(400, 'invalid_request', 'referenceLink must be an http(s) URL.');
        let label = 'Reference';
        try {
            label = new URL(url).hostname.replace(/^www\./, '') || label;
        } catch {
            label = 'Reference';
        }
        referenceLink = { label, url };
    }

    if ('countsTowardBudget' in record && typeof record.countsTowardBudget !== 'boolean') {
        return fail(400, 'invalid_request', 'countsTowardBudget must be true or false.');
    }
    if ('billable' in record && typeof record.billable !== 'boolean') {
        return fail(400, 'invalid_request', 'billable must be true or false.');
    }
    if ('complete' in record && typeof record.complete !== 'boolean') {
        return fail(400, 'invalid_request', 'complete must be true or false.');
    }

    const countsTowardBudget = record.countsTowardBudget !== false;
    const billable = record.billable !== false;
    const complete = record.complete === true;

    let completedAt: string | undefined;
    if (complete) {
        const completedOn = text(record.completedOn);
        const resolved = resolveCompletionInstant({
            choice: completedOn ? { kind: 'day', day: completedOn } : { kind: 'today' },
            now,
            timeZone,
        });
        if (!resolved.ok) {
            return fail(400, 'completion_date', resolved.error || COMPLETION_FUTURE_ERROR);
        }
        completedAt = resolved.completedAt;
    } else if ('completedOn' in record && record.completedOn != null && record.completedOn !== '') {
        return fail(400, 'invalid_request', 'completedOn is only used when complete is true.');
    }

    const command: Omit<BotTimeCommand, 'requestHash'> = {
        idempotencyKey,
        ...(clientId ? { clientId } : {}),
        ...(clientName ? { clientName } : {}),
        ...(taskId ? { taskId } : {}),
        ...(taskTitle ? { taskTitle } : {}),
        createTask,
        ...(category ? { category } : {}),
        ...(dueDate ? { dueDate } : {}),
        date,
        hours,
        minutes,
        ...(description ? { description } : {}),
        ...(referenceLink ? { referenceLink } : {}),
        countsTowardBudget,
        billable,
        complete,
        ...(completedAt ? { completedAt } : {}),
        timeZone,
    };

    return { ok: true, command: { ...command, requestHash: hashBotRequest(command) } };
}
