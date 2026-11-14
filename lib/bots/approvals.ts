import { createHash } from 'node:crypto';

import { parseGbpPostPayload, type GbpPostPayload } from '../gbp-approvals/registry.ts';
import { bearerToken, isBotKeyToken } from './scope.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$/;

const FORBIDDEN = new Set([
    'expiresAt',
    'link',
    'organizationId',
    'revoke',
    'role',
    'share',
    'token',
    'tokenHash',
    'userId',
]);

export interface BotApprovalItem {
    position: number;
    payload: GbpPostPayload;
    photoPath: string | null;
}

export interface BotApprovalQuestion {
    prompt: string;
    itemPosition: number | null;
}

export interface BotApprovalCommand {
    idempotencyKey: string;
    requestHash: string;
    clientId?: string;
    clientName?: string;
    taskId?: string;
    taskTitle?: string;
    title: string;
    dueAt: string | null;
    items: BotApprovalItem[];
    questions: BotApprovalQuestion[];
}

export type BotApprovalParse =
    | { ok: true; command: BotApprovalCommand }
    | { ok: false; status: 400 | 403; code: string; error: string };

function fail(status: 400 | 403, code: string, error: string): BotApprovalParse {
    return { ok: false, status, code, error };
}

function stable(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(item => stable(item)).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * Bots may create the request and its first versions. They cannot mint,
 * extend, or revoke the client link. That stays a human action in the app.
 */
export function parseBotApproval(body: unknown): BotApprovalParse {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return fail(400, 'invalid_request', 'Request body must be a JSON object.');
    }
    const record = body as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (FORBIDDEN.has(key)) return fail(403, 'forbidden', 'A bot cannot create or share a review link.');
    }
    const idempotencyKey = record.idempotencyKey;
    if (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
        return fail(400, 'invalid_request', 'Send an idempotencyKey of 8 to 200 letters, numbers, colon, underscore, dot, or dash.');
    }
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (!title || title.length > 200) return fail(400, 'invalid_request', 'Add a title for the review.');
    const clientId = typeof record.clientId === 'string' ? record.clientId : undefined;
    const clientName = typeof record.clientName === 'string' ? record.clientName.trim() : undefined;
    const taskId = typeof record.taskId === 'string' ? record.taskId : undefined;
    const taskTitle = typeof record.taskTitle === 'string' ? record.taskTitle.trim() : undefined;
    if (clientId && !UUID.test(clientId)) return fail(400, 'invalid_request', 'clientId must be a UUID.');
    if (taskId && !UUID.test(taskId)) return fail(400, 'invalid_request', 'taskId must be a UUID.');
    if (!clientId && !clientName) return fail(400, 'invalid_request', 'Name the client.');
    if (!taskId && !taskTitle) return fail(400, 'invalid_request', 'Name the task.');
    if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 30) {
        return fail(400, 'invalid_request', 'Add between 1 and 30 posts.');
    }
    const items: BotApprovalItem[] = [];
    const seen = new Set<number>();
    for (const entry of record.items) {
        if (!entry || typeof entry !== 'object') return fail(400, 'invalid_request', 'Each post needs a payload.');
        const item = entry as Record<string, unknown>;
        if (typeof item.position !== 'number' || item.position < 1 || seen.has(item.position)) {
            return fail(400, 'invalid_request', 'Each post needs its own position.');
        }
        seen.add(item.position);
        const parsed = parseGbpPostPayload(item.payload);
        if (!parsed.ok) return fail(400, 'invalid_request', parsed.error);
        const photoPath = item.photoPath == null ? null : item.photoPath;
        if (photoPath !== null && (typeof photoPath !== 'string' || !/^https:\/\/\S+$/.test(photoPath))) {
            return fail(400, 'invalid_request', 'A post photo must be an https URL.');
        }
        items.push({ position: item.position, payload: parsed.payload, photoPath });
    }
    const questions: BotApprovalQuestion[] = [];
    const rawQuestions = record.questions == null ? [] : record.questions;
    if (!Array.isArray(rawQuestions) || rawQuestions.length > 20) {
        return fail(400, 'invalid_request', 'Add at most 20 questions.');
    }
    for (const entry of rawQuestions) {
        if (!entry || typeof entry !== 'object') return fail(400, 'invalid_request', 'Each question needs a prompt.');
        const question = entry as Record<string, unknown>;
        const prompt = typeof question.prompt === 'string' ? question.prompt.trim() : '';
        if (!prompt || prompt.length > 500) return fail(400, 'invalid_request', 'Each question needs a prompt.');
        const itemPosition = question.itemPosition == null ? null : question.itemPosition;
        if (itemPosition !== null && (typeof itemPosition !== 'number' || !seen.has(itemPosition))) {
            return fail(400, 'invalid_request', 'A question must point at one of the posts.');
        }
        questions.push({ prompt, itemPosition });
    }
    const dueAt = record.dueAt == null || record.dueAt === '' ? null : record.dueAt;
    if (dueAt !== null && (typeof dueAt !== 'string' || Number.isNaN(Date.parse(dueAt)))) {
        return fail(400, 'invalid_request', 'dueAt must be a timestamp.');
    }
    const command: BotApprovalCommand = {
        idempotencyKey,
        requestHash: '',
        ...(clientId ? { clientId } : {}),
        ...(clientName ? { clientName } : {}),
        ...(taskId ? { taskId } : {}),
        ...(taskTitle ? { taskTitle } : {}),
        title,
        dueAt: typeof dueAt === 'string' ? new Date(dueAt).toISOString() : null,
        items,
        questions,
    };
    command.requestHash = createHash('sha256').update(stable(command)).digest('hex');
    return { ok: true, command };
}

export function botApprovalUnauthorized(authorization: string | null): { status: number; code: string; error: string } | null {
    const token = bearerToken(authorization);
    if (!token) return { status: 401, code: 'missing_api_key', error: 'Missing API key. Send Authorization: Bearer <key>.' };
    if (!isBotKeyToken(token)) return { status: 401, code: 'invalid_api_key', error: 'Invalid API key.' };
    return null;
}

/** Keep retry identity attached to the normalized command at the SQL boundary. */
export function botApprovalRpcArgs(command: BotApprovalCommand, actorId: string, organizationId: string, clientId: string, taskId: string) {
    return {
        p_actor: actorId,
        p_organization_id: organizationId,
        p_client_id: clientId,
        p_task_id: taskId,
        p_title: command.title,
        p_due_at: command.dueAt,
        p_questions: command.questions,
        p_items: command.items,
        p_idempotency_key: command.idempotencyKey,
        p_request_hash: command.requestHash,
    };
}
