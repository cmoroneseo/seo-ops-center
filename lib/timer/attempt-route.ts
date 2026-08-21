import type { TimerMutationRequest, TimerStateResponse } from './contracts.ts';

export interface FinalizeAttemptInput {
    userId: string;
    timeLogId: string;
    description: string;
    billable: boolean;
    countsTowardBudget: boolean;
    markTaskComplete: boolean;
    timeZone: string;
    operationId: string;
    finalizedAt: string;
}

export interface FinalizeResult {
    finalizedTimeLogIds: string[];
    completionWarning?: string;
}

export interface AttemptRouteDeps {
    getUser(): Promise<{ id: string } | null>;
    mutateRpc(name: string, args: Record<string, unknown>): Promise<unknown>;
    loadAttempts(userId: string): Promise<TimerStateResponse>;
    finalizeOwnedAttempt(input: FinalizeAttemptInput): Promise<FinalizeResult>;
    /** Must authorize a finalized, user-owned local log before provider work. */
    syncBasecamp(
        timeLogId: string,
        createIfMissing: boolean,
    ): Promise<{ ok: boolean; error?: string }>;
}

type JsonObject = Record<string, unknown>;

const actionFields: Record<TimerMutationRequest['action'], readonly string[]> = {
    start: ['action', 'taskId', 'now'],
    pause: ['action', 'timeLogId', 'now'],
    resume: ['action', 'timeLogId', 'now'],
    switch: ['action', 'fromTimeLogId', 'toTimeLogId', 'toTaskId', 'now'],
    begin_stop: ['action', 'timeLogId', 'now'],
    finalize: [
        'action',
        'timeLogId',
        'description',
        'billable',
        'countsTowardBudget',
        'syncToBasecamp',
        'markTaskComplete',
        'timeZone',
    ],
    discard: ['action', 'timeLogId'],
    retry_basecamp: ['action', 'timeLogId'],
};

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isOptionalInstant(value: unknown): value is string | undefined {
    return value === undefined
        || (isNonEmptyString(value) && Number.isFinite(Date.parse(value)));
}

function hasOnlyFields(body: JsonObject, fields: readonly string[]): boolean {
    const allowed = new Set(fields);
    return Object.keys(body).every(key => allowed.has(key));
}

function parseTimerRequest(value: unknown): TimerMutationRequest | null {
    if (!isObject(value) || typeof value.action !== 'string') return null;
    if (!Object.hasOwn(actionFields, value.action)) return null;

    const action = value.action as TimerMutationRequest['action'];
    if (!hasOnlyFields(value, actionFields[action])) return null;

    if (action === 'start') {
        return isNonEmptyString(value.taskId) && isOptionalInstant(value.now)
            ? { action, taskId: value.taskId, ...(value.now ? { now: value.now } : {}) }
            : null;
    }
    if (action === 'pause' || action === 'resume' || action === 'begin_stop') {
        return isNonEmptyString(value.timeLogId) && isOptionalInstant(value.now)
            ? { action, timeLogId: value.timeLogId, ...(value.now ? { now: value.now } : {}) }
            : null;
    }
    if (action === 'switch') {
        const hasAttempt = isNonEmptyString(value.toTimeLogId);
        const hasTask = isNonEmptyString(value.toTaskId);
        if (
            !isNonEmptyString(value.fromTimeLogId)
            || hasAttempt === hasTask
            || !isOptionalInstant(value.now)
        ) return null;
        return {
            action,
            fromTimeLogId: value.fromTimeLogId,
            ...(hasAttempt ? { toTimeLogId: value.toTimeLogId as string } : {}),
            ...(hasTask ? { toTaskId: value.toTaskId as string } : {}),
            ...(value.now ? { now: value.now } : {}),
        };
    }
    if (action === 'finalize') {
        if (
            !isNonEmptyString(value.timeLogId)
            || typeof value.description !== 'string'
            || typeof value.billable !== 'boolean'
            || typeof value.countsTowardBudget !== 'boolean'
            || typeof value.syncToBasecamp !== 'boolean'
            || typeof value.markTaskComplete !== 'boolean'
            || !isNonEmptyString(value.timeZone)
        ) return null;
        return {
            action,
            timeLogId: value.timeLogId,
            description: value.description,
            billable: value.billable,
            countsTowardBudget: value.countsTowardBudget,
            syncToBasecamp: value.syncToBasecamp,
            markTaskComplete: value.markTaskComplete,
            timeZone: value.timeZone,
        };
    }
    if (action === 'discard' || action === 'retry_basecamp') {
        return isNonEmptyString(value.timeLogId)
            ? { action, timeLogId: value.timeLogId }
            : null;
    }
    return null;
}

function errorCode(error: unknown): string | undefined {
    if (!isObject(error)) return undefined;
    return typeof error.code === 'string' ? error.code : undefined;
}

function errorResponse(error: unknown): Response {
    const code = errorCode(error);
    if (code === '42501' || code === 'P0002' || code === 'PGRST116') {
        return json({ error: 'Forbidden' }, 403);
    }
    if (code === '23505' || code === '23P01' || code === '55000') {
        return json({ error: 'Timer state conflict' }, 409);
    }
    if (code?.startsWith('22')) {
        return json({ error: 'Invalid timer mutation' }, 400);
    }
    return json({ error: 'Unable to update timer' }, 500);
}

function mutationInstant(now?: string): string {
    return now ?? new Date().toISOString();
}

async function mutateSimple(
    input: Exclude<TimerMutationRequest, { action: 'finalize' | 'retry_basecamp' }>,
    deps: AttemptRouteDeps,
): Promise<void> {
    if (input.action === 'start') {
        await deps.mutateRpc('start_task_timer', {
            p_task_id: input.taskId,
            p_started_at: mutationInstant(input.now),
        });
        return;
    }
    if (input.action === 'pause') {
        await deps.mutateRpc('pause_time_attempt', {
            p_time_log_id: input.timeLogId,
            p_paused_at: mutationInstant(input.now),
        });
        return;
    }
    if (input.action === 'resume') {
        await deps.mutateRpc('resume_time_attempt', {
            p_time_log_id: input.timeLogId,
            p_resumed_at: mutationInstant(input.now),
        });
        return;
    }
    if (input.action === 'switch') {
        await deps.mutateRpc('switch_time_attempt', {
            p_from_time_log_id: input.fromTimeLogId,
            p_to_time_log_id: input.toTimeLogId ?? null,
            p_to_task_id: input.toTaskId ?? null,
            p_switched_at: mutationInstant(input.now),
        });
        return;
    }
    if (input.action === 'begin_stop') {
        await deps.mutateRpc('begin_stop_review', {
            p_time_log_id: input.timeLogId,
            p_reviewing_at: mutationInstant(input.now),
        });
        return;
    }
    await deps.mutateRpc('discard_time_attempt', { p_time_log_id: input.timeLogId });
}

export async function handleTimerMutation(
    request: Request,
    deps: AttemptRouteDeps,
): Promise<Response> {
    let rawBody: unknown;
    try {
        rawBody = await request.json();
    } catch {
        return json({ error: 'Malformed JSON' }, 400);
    }

    const input = parseTimerRequest(rawBody);
    if (!input) return json({ error: 'Invalid timer mutation' }, 400);

    try {
        const user = await deps.getUser();
        if (!user) return json({ error: 'Unauthorized' }, 401);

        if (input.action === 'finalize') {
            const finalized = await deps.finalizeOwnedAttempt({
                userId: user.id,
                timeLogId: input.timeLogId,
                description: input.description,
                billable: input.billable,
                countsTowardBudget: input.countsTowardBudget,
                markTaskComplete: input.markTaskComplete,
                timeZone: input.timeZone,
                operationId: crypto.randomUUID(),
                finalizedAt: new Date().toISOString(),
            });

            let basecampStatus: TimerStateResponse['basecampStatus'] = 'not_requested';
            if (input.syncToBasecamp) {
                const results = [];
                for (const timeLogId of finalized.finalizedTimeLogIds) {
                    try {
                        results.push(await deps.syncBasecamp(timeLogId, true));
                    } catch {
                        results.push({ ok: false });
                    }
                }
                basecampStatus = results.every(result => result.ok) ? 'synced' : 'failed';
            }

            return json({
                ...await deps.loadAttempts(user.id),
                finalizedTimeLogIds: finalized.finalizedTimeLogIds,
                ...(finalized.completionWarning
                    ? { completionWarning: finalized.completionWarning }
                    : {}),
                basecampStatus,
            } satisfies TimerStateResponse);
        }

        if (input.action === 'retry_basecamp') {
            const result = await deps.syncBasecamp(input.timeLogId, true);
            return json({
                ...await deps.loadAttempts(user.id),
                finalizedTimeLogIds: [input.timeLogId],
                basecampStatus: result.ok ? 'synced' : 'failed',
            } satisfies TimerStateResponse);
        }

        await mutateSimple(input, deps);
        return json(await deps.loadAttempts(user.id));
    } catch (error) {
        return errorResponse(error);
    }
}
