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
    /** Injectable wall clock for validating explicit backdated starts. */
    now?(): Date;
    /** Must authorize a finalized, user-owned local log before provider work. */
    syncBasecamp(
        timeLogId: string,
        createIfMissing: boolean,
    ): Promise<BasecampSyncOutcome>;
}

export interface BasecampSyncOutcome {
    ok: boolean;
    /** The destination declined the entry (not configured, nothing to send). */
    skipped?: boolean;
    error?: string;
}

/** A skipped destination never claims a timesheet entry that does not exist. */
export function basecampStatusFromOutcomes(
    outcomes: BasecampSyncOutcome[],
): NonNullable<TimerStateResponse['basecampStatus']> {
    if (outcomes.length === 0) return 'not_requested';
    if (outcomes.some(outcome => !outcome.ok)) return 'failed';
    return outcomes.every(outcome => outcome.skipped === true) ? 'not_requested' : 'synced';
}

export interface CompletedTask {
    id: string;
    organizationId: string;
    clientId: string | null;
    title: string;
    priority: string | null;
    category: string | null;
}

export interface CompletionInput {
    taskId: string;
    userId: string;
    actorName: string;
    operationId: string;
    finalizedAt: string;
}

export interface CompletionDeps {
    completeOwnedTask(taskId: string, finalizedAt: string): Promise<CompletedTask | null>;
    emitTaskCompleted(task: CompletedTask, input: CompletionInput): Promise<void>;
    /**
     * Check off the task's linked Basecamp to-do. Best-effort — matches the
     * fire-and-forget completion push in updateTask (lib/supabase/tasks.ts). A
     * failure here must not undo the completed task or produce a warning; the
     * task is already done locally.
     */
    syncBasecampTodoCompletion?(task: CompletedTask): Promise<void>;
}

const COMPLETION_WARNING = 'Time was saved, but task completion could not be fully recorded.';

/** Privileged activity is allowed only after the authenticated update returns a row. */
export async function completeFinalizedTask(
    input: CompletionInput,
    deps: CompletionDeps,
): Promise<string | undefined> {
    try {
        const completedTask = await deps.completeOwnedTask(input.taskId, input.finalizedAt);
        if (!completedTask) return COMPLETION_WARNING;
        if (completedTask.clientId) {
            await deps.emitTaskCompleted(completedTask, input);
            // The Basecamp to-do checkbox is best-effort: never let a provider
            // failure roll back the completed task or surface a warning. Only a
            // client task can carry a Basecamp to-do, so skip internal work.
            if (deps.syncBasecampTodoCompletion) {
                try {
                    await deps.syncBasecampTodoCompletion(completedTask);
                } catch {
                    // Task is done locally; the to-do can be reconciled later.
                }
            }
        }
        return undefined;
    } catch {
        return COMPLETION_WARNING;
    }
}

type JsonObject = Record<string, unknown>;

const actionFields: Record<TimerMutationRequest['action'], readonly string[]> = {
    start: ['action', 'taskId', 'now', 'timeZone'],
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

function isValidTimeZone(value: unknown): value is string {
    if (!isNonEmptyString(value)) return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
        return true;
    } catch {
        return false;
    }
}

function localDateKey(instant: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
}

function isAllowedBackdatedStart(startedAt: string, timeZone: string, now: Date): boolean {
    const start = new Date(startedAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(now.getTime())) return false;
    const currentMinute = new Date(now);
    currentMinute.setSeconds(0, 0);
    return start.getTime() < currentMinute.getTime()
        && localDateKey(start, timeZone) === localDateKey(now, timeZone);
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
        const hasExplicitInstant = value.now !== undefined;
        const hasTimeZone = value.timeZone !== undefined;
        if (
            !isNonEmptyString(value.taskId)
            || !isOptionalInstant(value.now)
            || hasExplicitInstant !== hasTimeZone
            || (hasTimeZone && !isValidTimeZone(value.timeZone))
        ) return null;
        return {
            action,
            taskId: value.taskId,
            ...(value.now ? { now: value.now, timeZone: value.timeZone as string } : {}),
        };
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

function isOwnershipError(error: unknown): boolean {
    const code = errorCode(error);
    return code === '42501' || code === 'P0002' || code === 'PGRST116';
}

async function loadAttemptsAfterDurableMutation(
    deps: AttemptRouteDeps,
    userId: string,
    recoveryWarning: string,
): Promise<TimerStateResponse> {
    try {
        return await deps.loadAttempts(userId);
    } catch {
        return { running: null, paused: [], recoveryWarning };
    }
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

        if (
            input.action === 'start'
            && input.now
            && (!input.timeZone || !isAllowedBackdatedStart(
                input.now,
                input.timeZone,
                deps.now?.() ?? new Date(),
            ))
        ) {
            return json({ error: 'Start time must be earlier today' }, 400);
        }

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

            const results: BasecampSyncOutcome[] = [];
            if (input.syncToBasecamp) {
                for (const timeLogId of finalized.finalizedTimeLogIds) {
                    try {
                        results.push(await deps.syncBasecamp(timeLogId, true));
                    } catch {
                        results.push({ ok: false });
                    }
                }
            }
            const basecampStatus = basecampStatusFromOutcomes(results);

            const attempts = await loadAttemptsAfterDurableMutation(
                deps,
                user.id,
                'Time was saved, but current timer state could not be reloaded.',
            );
            return json({
                ...attempts,
                finalizedTimeLogIds: finalized.finalizedTimeLogIds,
                ...(finalized.completionWarning
                    ? { completionWarning: finalized.completionWarning }
                    : {}),
                basecampStatus,
            } satisfies TimerStateResponse);
        }

        if (input.action === 'retry_basecamp') {
            let result: BasecampSyncOutcome;
            try {
                result = await deps.syncBasecamp(input.timeLogId, true);
            } catch (error) {
                if (isOwnershipError(error)) throw error;
                result = { ok: false };
            }
            const attempts = await loadAttemptsAfterDurableMutation(
                deps,
                user.id,
                'Basecamp retry finished, but current timer state could not be reloaded.',
            );
            return json({
                ...attempts,
                finalizedTimeLogIds: [input.timeLogId],
                basecampStatus: basecampStatusFromOutcomes([result]),
            } satisfies TimerStateResponse);
        }

        await mutateSimple(input, deps);
        // The transition is committed. A failed canonical reload must not be
        // reported as a failed mutation, or the user retries an action that
        // already succeeded and hits the one-open-segment conflict.
        return json(await loadAttemptsAfterDurableMutation(
            deps,
            user.id,
            'The timer was updated, but current timer state could not be reloaded.',
        ));
    } catch (error) {
        return errorResponse(error);
    }
}
