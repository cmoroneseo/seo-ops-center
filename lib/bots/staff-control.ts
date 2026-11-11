import type { BotStaffControlInput } from './handle.ts';

/** Only the organization owner may pause, resume, or stop a bot timer from the app. */
export const STAFF_TIMER_FORBIDDEN = 'Only the organization owner can pause, resume, or stop a bot timer.';

export function staffTimerRoleDecision(role: string | null | undefined):
    | { ok: true }
    | { ok: false; status: 403; code: 'forbidden'; error: string } {
    if (role === 'owner') return { ok: true };
    return { ok: false, status: 403, code: 'forbidden', error: STAFF_TIMER_FORBIDDEN };
}

/**
 * Note sent when a task is marked done and its bot timer is stopped.
 * Empty unless the person typed one. Never a process line such as "task completed".
 */
export function markDoneStopNote(typed?: string | null): string | null {
    const note = typed?.trim() ?? '';
    return note.length > 0 ? note : null;
}

const ACTIONS = new Set(['pause', 'resume', 'stop']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FIELDS = new Set([
    'action',
    'timeLogId',
    'description',
    'timeZone',
    'billable',
    'countsTowardBudget',
    'complete',
    'completedAt',
]);

export type StaffControlParse =
    | { ok: true; input: BotStaffControlInput }
    | { ok: false; error: string };

/** Session body for pause, resume, or stop. Minutes and hours are not accepted. */
export function parseStaffControl(value: unknown): StaffControlParse {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: 'Send a JSON object.' };
    }
    const body = value as Record<string, unknown>;
    if ('minutes' in body || 'hours' in body) {
        return { ok: false, error: 'Do not send minutes or hours. The clock is the time.' };
    }
    for (const key of Object.keys(body)) {
        if (!FIELDS.has(key)) return { ok: false, error: `Unknown field: ${key}` };
    }
    if (typeof body.action !== 'string' || !ACTIONS.has(body.action)) {
        return { ok: false, error: 'Action must be pause, resume, or stop.' };
    }
    if (typeof body.timeLogId !== 'string' || !UUID.test(body.timeLogId)) {
        return { ok: false, error: 'timeLogId must be the bot timer id.' };
    }
    if (body.description !== undefined && typeof body.description !== 'string') {
        return { ok: false, error: 'description must be text.' };
    }
    if (body.timeZone !== undefined && typeof body.timeZone !== 'string') {
        return { ok: false, error: 'timeZone must be text.' };
    }
    if (body.billable !== undefined && typeof body.billable !== 'boolean') {
        return { ok: false, error: 'billable must be true or false.' };
    }
    if (body.countsTowardBudget !== undefined && typeof body.countsTowardBudget !== 'boolean') {
        return { ok: false, error: 'countsTowardBudget must be true or false.' };
    }
    if (body.complete !== undefined && typeof body.complete !== 'boolean') {
        return { ok: false, error: 'complete must be true or false.' };
    }
    if (body.completedAt !== undefined && typeof body.completedAt !== 'string') {
        return { ok: false, error: 'completedAt must be text.' };
    }
    return {
        ok: true,
        input: {
            action: body.action as BotStaffControlInput['action'],
            timeLogId: body.timeLogId,
            ...(typeof body.description === 'string' ? { description: body.description } : {}),
            ...(typeof body.timeZone === 'string' ? { timeZone: body.timeZone } : {}),
            ...(typeof body.billable === 'boolean' ? { billable: body.billable } : {}),
            ...(typeof body.countsTowardBudget === 'boolean' ? { countsTowardBudget: body.countsTowardBudget } : {}),
            ...(body.complete === true ? { complete: true } : {}),
            ...(typeof body.completedAt === 'string' ? { completedAt: body.completedAt } : {}),
        },
    };
}

export interface StaffControlOutcome {
    ok: boolean;
    capped: boolean;
    alreadyStopped: boolean;
    phase: 'running' | 'paused' | 'stopped' | null;
    code?: string;
    error?: string;
}

/** What the task screen needs from a pause, resume, or stop. */
export function staffControlOutcome(status: number, body: unknown): StaffControlOutcome {
    const raw = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const code = typeof raw.code === 'string' ? raw.code : undefined;
    const error = typeof raw.error === 'string' ? raw.error : undefined;
    if (status < 200 || status >= 300) {
        return {
            ok: false,
            capped: false,
            alreadyStopped: false,
            phase: null,
            ...(code ? { code } : {}),
            error: error ?? 'Could not update the bot timer.',
        };
    }
    const timer = raw.timer && typeof raw.timer === 'object' ? raw.timer as Record<string, unknown> : null;
    const phase = timer?.status === 'paused'
        ? 'paused'
        : timer?.status === 'running'
            ? 'running'
            : 'stopped';
    return {
        ok: true,
        capped: raw.capped === true,
        alreadyStopped: raw.alreadyStopped === true,
        phase,
    };
}
