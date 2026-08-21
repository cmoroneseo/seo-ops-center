import test from 'node:test';
import assert from 'node:assert/strict';
import {
    completeFinalizedTask,
    handleTimerMutation,
    type AttemptRouteDeps,
    type FinalizeAttemptInput,
} from './attempt-route.ts';
import {
    timerStateFromRows,
    type TimerMutationRequest,
    type TimerStateResponse,
} from './contracts.ts';

const emptyState = (): TimerStateResponse => ({ running: null, paused: [] });

function request(body: TimerMutationRequest | Record<string, unknown> | string): Request {
    return new Request('https://seo-ops.test/api/time-tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

function dependencies(overrides: Partial<AttemptRouteDeps> = {}): AttemptRouteDeps {
    return {
        getUser: async () => ({ id: 'user-1' }),
        mutateRpc: async () => null,
        loadAttempts: async () => emptyState(),
        finalizeOwnedAttempt: async () => ({ finalizedTimeLogIds: ['log-1'] }),
        syncBasecamp: async () => ({ ok: true }),
        ...overrides,
    };
}

async function body(response: Response): Promise<Record<string, unknown>> {
    return await response.json() as Record<string, unknown>;
}

test('rejects an unauthenticated timer mutation before any mutation dependency runs', async () => {
    let mutated = false;
    const response = await handleTimerMutation(request({ action: 'pause', timeLogId: 'log-1' }), dependencies({
        getUser: async () => null,
        mutateRpc: async () => {
            mutated = true;
        },
    }));

    assert.equal(response.status, 401);
    assert.equal(mutated, false);
});

test('returns 400 for malformed JSON without calling a mutation dependency', async () => {
    let mutated = false;
    const response = await handleTimerMutation(request('{'), dependencies({
        mutateRpc: async () => {
            mutated = true;
        },
    }));

    assert.equal(response.status, 400);
    assert.equal(mutated, false);
});

test('start accepts intent only and delegates tenant resolution to start_task_timer', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const response = await handleTimerMutation(request({
        action: 'start',
        taskId: 'task-1',
        now: '2026-08-20T20:00:00.000Z',
    }), dependencies({
        mutateRpc: async (name, args) => {
            calls.push([name, args]);
        },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [[
        'start_task_timer',
        { p_task_id: 'task-1', p_started_at: '2026-08-20T20:00:00.000Z' },
    ]]);

    const spoofed = await handleTimerMutation(request({
        action: 'start',
        taskId: 'task-1',
        organizationId: 'org-attacker',
        clientId: 'client-attacker',
    }), dependencies());
    assert.equal(spoofed.status, 400);
});

test('maps an inaccessible time log RPC rejection to 403', async () => {
    const forbidden = Object.assign(new Error('owned in-progress time attempt not found'), { code: '42501' });
    const response = await handleTimerMutation(request({ action: 'pause', timeLogId: 'other-log' }), dependencies({
        mutateRpc: async () => { throw forbidden; },
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(await body(response), { error: 'Forbidden' });
});

test('does not reveal whether a requested task exists outside the actor boundary', async () => {
    const hidden = Object.assign(new Error('task not found'), { code: 'P0002' });
    const response = await handleTimerMutation(request({ action: 'start', taskId: 'hidden-task' }), dependencies({
        mutateRpc: async () => { throw hidden; },
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(await body(response), { error: 'Forbidden' });
});

test('switch requires exactly one target and uses the atomic switch RPC', async () => {
    for (const invalid of [
        { action: 'switch', fromTimeLogId: 'from-1' },
        { action: 'switch', fromTimeLogId: 'from-1', toTimeLogId: 'to-1', toTaskId: 'task-1' },
    ]) {
        const response = await handleTimerMutation(request(invalid), dependencies());
        assert.equal(response.status, 400);
    }

    const calls: Array<[string, Record<string, unknown>]> = [];
    const response = await handleTimerMutation(request({
        action: 'switch',
        fromTimeLogId: 'from-1',
        toTimeLogId: 'to-1',
        now: '2026-08-20T21:00:00.000Z',
    }), dependencies({
        mutateRpc: async (name, args) => { calls.push([name, args]); },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [[
        'switch_time_attempt',
        {
            p_from_time_log_id: 'from-1',
            p_to_time_log_id: 'to-1',
            p_to_task_id: null,
            p_switched_at: '2026-08-20T21:00:00.000Z',
        },
    ]]);
});

test('all simple transitions use their exact RPC and then return canonical state', async () => {
    const expected = { running: null, paused: [], basecampStatus: 'not_requested' as const };
    const cases: Array<[TimerMutationRequest, string, Record<string, unknown>]> = [
        [
            { action: 'pause', timeLogId: 'log-1', now: '2026-08-20T20:01:00.000Z' },
            'pause_time_attempt',
            { p_time_log_id: 'log-1', p_paused_at: '2026-08-20T20:01:00.000Z' },
        ],
        [
            { action: 'resume', timeLogId: 'log-1', now: '2026-08-20T20:02:00.000Z' },
            'resume_time_attempt',
            { p_time_log_id: 'log-1', p_resumed_at: '2026-08-20T20:02:00.000Z' },
        ],
        [
            { action: 'begin_stop', timeLogId: 'log-1', now: '2026-08-20T20:03:00.000Z' },
            'begin_stop_review',
            { p_time_log_id: 'log-1', p_reviewing_at: '2026-08-20T20:03:00.000Z' },
        ],
        [
            { action: 'discard', timeLogId: 'log-1' },
            'discard_time_attempt',
            { p_time_log_id: 'log-1' },
        ],
    ];

    for (const [input, expectedRpc, expectedArgs] of cases) {
        const calls: Array<[string, Record<string, unknown>]> = [];
        const response = await handleTimerMutation(request(input), dependencies({
            mutateRpc: async (name, args) => { calls.push([name, args]); },
            loadAttempts: async () => expected,
        }));
        assert.equal(response.status, 200);
        assert.deepEqual(calls, [[expectedRpc, expectedArgs]]);
        assert.deepEqual(await response.json(), expected);
    }
});

const finalizeRequest: TimerMutationRequest = {
    action: 'finalize',
    timeLogId: 'attempt-1',
    description: 'Reviewed work',
    billable: true,
    countsTowardBudget: true,
    syncToBasecamp: true,
    markTaskComplete: true,
    timeZone: 'America/Los_Angeles',
};

test('finalize makes local time safe before completion and starts Basecamp last', async () => {
    const events: string[] = [];
    let finalizedInput: FinalizeAttemptInput | undefined;
    const response = await handleTimerMutation(request(finalizeRequest), dependencies({
        finalizeOwnedAttempt: async input => {
            finalizedInput = input;
            events.push('local-and-completion');
            return { finalizedTimeLogIds: ['day-1', 'day-2'] };
        },
        loadAttempts: async () => {
            events.push('canonical');
            return emptyState();
        },
        syncBasecamp: async timeLogId => {
            events.push(`basecamp:${timeLogId}`);
            return { ok: true };
        },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(events, ['local-and-completion', 'basecamp:day-1', 'basecamp:day-2', 'canonical']);
    assert.equal(finalizedInput?.userId, 'user-1');
    assert.equal(finalizedInput?.timeLogId, 'attempt-1');
    assert.equal(finalizedInput?.markTaskComplete, true);
    assert.match(finalizedInput?.operationId ?? '', /^[0-9a-f-]{36}$/i);
    assert.deepEqual(await response.json(), {
        running: null,
        paused: [],
        finalizedTimeLogIds: ['day-1', 'day-2'],
        basecampStatus: 'synced',
    });
});

test('an unselected Basecamp toggle reaches no provider dependency at all', async () => {
    let providerCalls = 0;
    const response = await handleTimerMutation(request({ ...finalizeRequest, syncToBasecamp: false }), dependencies({
        syncBasecamp: async () => {
            providerCalls += 1;
            return { ok: true };
        },
    }));

    assert.equal(response.status, 200);
    assert.equal(providerCalls, 0);
    assert.equal((await body(response)).basecampStatus, 'not_requested');
});

test('a skipped provider sync is never reported as a synced timesheet entry', async () => {
    const response = await handleTimerMutation(request(finalizeRequest), dependencies({
        finalizeOwnedAttempt: async () => ({ finalizedTimeLogIds: ['day-1'] }),
        syncBasecamp: async () => ({ ok: true, skipped: true }),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        running: null,
        paused: [],
        finalizedTimeLogIds: ['day-1'],
        basecampStatus: 'not_requested',
    });

    const retried = await handleTimerMutation(request({ action: 'retry_basecamp', timeLogId: 'day-1' }), dependencies({
        syncBasecamp: async () => ({ ok: true, skipped: true }),
    }));
    assert.equal((await body(retried)).basecampStatus, 'not_requested');
});

test('a partially skipped multi-date sync still reports the dates that reached Basecamp', async () => {
    const response = await handleTimerMutation(request(finalizeRequest), dependencies({
        finalizeOwnedAttempt: async () => ({ finalizedTimeLogIds: ['day-1', 'day-2'] }),
        syncBasecamp: async timeLogId => timeLogId === 'day-2'
            ? { ok: true, skipped: true }
            : { ok: true },
    }));

    assert.equal((await body(response)).basecampStatus, 'synced');
});

test('completion failure is a warning and retains finalized local IDs', async () => {
    const response = await handleTimerMutation(request({ ...finalizeRequest, syncToBasecamp: false }), dependencies({
        finalizeOwnedAttempt: async () => ({
            finalizedTimeLogIds: ['day-1'],
            completionWarning: 'Time saved, but task completion failed',
        }),
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        running: null,
        paused: [],
        finalizedTimeLogIds: ['day-1'],
        completionWarning: 'Time saved, but task completion failed',
        basecampStatus: 'not_requested',
    });
});

test('Basecamp failure reports failed while retaining every finalized local ID', async () => {
    const response = await handleTimerMutation(request(finalizeRequest), dependencies({
        finalizeOwnedAttempt: async () => ({ finalizedTimeLogIds: ['day-1', 'day-2'] }),
        syncBasecamp: async timeLogId => timeLogId === 'day-2'
            ? { ok: false, error: 'provider unavailable' }
            : { ok: true },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        running: null,
        paused: [],
        finalizedTimeLogIds: ['day-1', 'day-2'],
        basecampStatus: 'failed',
    });
});

test('an unexpected Basecamp exception cannot erase already-finalized local IDs', async () => {
    const response = await handleTimerMutation(request(finalizeRequest), dependencies({
        finalizeOwnedAttempt: async () => ({ finalizedTimeLogIds: ['day-1'] }),
        syncBasecamp: async () => { throw new Error('network failure'); },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        running: null,
        paused: [],
        finalizedTimeLogIds: ['day-1'],
        basecampStatus: 'failed',
    });
});

test('finalized IDs survive loadAttempts failure with durable completion and Basecamp status', async () => {
    const response = await handleTimerMutation(request(finalizeRequest), dependencies({
        finalizeOwnedAttempt: async () => ({
            finalizedTimeLogIds: ['day-1', 'day-2'],
            completionWarning: 'Time saved, but completion failed',
        }),
        syncBasecamp: async () => ({ ok: true }),
        loadAttempts: async () => { throw new Error('recovery query unavailable'); },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        running: null,
        paused: [],
        finalizedTimeLogIds: ['day-1', 'day-2'],
        completionWarning: 'Time saved, but completion failed',
        basecampStatus: 'synced',
        recoveryWarning: 'Time was saved, but current timer state could not be reloaded.',
    });
});

test('retry delegates provenance checks and creation policy to the protected sync dependency', async () => {
    const calls: Array<[string, boolean]> = [];
    const response = await handleTimerMutation(request({ action: 'retry_basecamp', timeLogId: 'logged-owned' }), dependencies({
        syncBasecamp: async (timeLogId, createIfMissing) => {
            calls.push([timeLogId, createIfMissing]);
            return { ok: true };
        },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(calls, [['logged-owned', true]]);
    assert.deepEqual(await response.json(), {
        running: null,
        paused: [],
        finalizedTimeLogIds: ['logged-owned'],
        basecampStatus: 'synced',
    });

    const forbidden = Object.assign(new Error('finalized owned time log not found'), { code: '42501' });
    const rejected = await handleTimerMutation(request({ action: 'retry_basecamp', timeLogId: 'foreign-or-open' }), dependencies({
        syncBasecamp: async () => { throw forbidden; },
    }));
    assert.equal(rejected.status, 403);
});

test('retry provider exception returns failed status without false ownership mapping', async () => {
    const response = await handleTimerMutation(request({
        action: 'retry_basecamp',
        timeLogId: 'logged-owned',
    }), dependencies({
        syncBasecamp: async () => { throw new Error('provider runtime failed'); },
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        running: null,
        paused: [],
        finalizedTimeLogIds: ['logged-owned'],
        basecampStatus: 'failed',
    });
});

test('zero-row task completion produces completionWarning and performs no privileged activity insert', async () => {
    let privilegedInsert = false;
    const warning = await completeFinalizedTask(
        {
            taskId: 'task-1',
            userId: 'user-1',
            actorName: 'Ada',
            operationId: 'operation-1',
            finalizedAt: '2026-08-20T22:00:00.000Z',
        },
        {
            completeOwnedTask: async () => null,
            emitTaskCompleted: async () => { privilegedInsert = true; },
        },
    );

    assert.equal(warning, 'Time was saved, but task completion could not be fully recorded.');
    assert.equal(privilegedInsert, false);
});

test('strict discriminated validation rejects unknown actions, fields, and invalid values', async () => {
    const invalidBodies = [
        { action: 'wat', timeLogId: 'log-1' },
        { action: 'toString', timeLogId: 'log-1' },
        { action: 'pause', timeLogId: '', now: '2026-08-20T20:00:00.000Z' },
        { action: 'resume', timeLogId: 'log-1', elapsedSeconds: 20 },
        { ...finalizeRequest, billable: 'yes' },
        { ...finalizeRequest, timeZone: '' },
    ];
    for (const invalid of invalidBodies) {
        const response = await handleTimerMutation(request(invalid), dependencies());
        assert.equal(response.status, 400);
    }
});

test('maps conflicting transitions to 409 without leaking database messages', async () => {
    const conflict = Object.assign(new Error('duplicate key value violates constraint details'), { code: '23505' });
    const response = await handleTimerMutation(request({ action: 'resume', timeLogId: 'log-1' }), dependencies({
        mutateRpc: async () => { throw conflict; },
    }));

    assert.equal(response.status, 409);
    assert.deepEqual(await body(response), { error: 'Timer state conflict' });
});

test('canonical recovery maps attempt and segment rows without leaking snake_case', () => {
    const state = timerStateFromRows([
        {
            id: 'running-1',
            organization_id: 'org-1',
            client_id: 'client-1',
            project_id: 'project-1',
            task_id: 'task-1',
            user_id: 'user-1',
            date: '2026-08-20',
            hours: '0',
            description: 'Work',
            billable: true,
            counts_toward_budget: true,
            status: 'in_progress',
            timer_started_at: '2026-08-20T20:00:00.000Z',
            elapsed_seconds: 0,
            planned_starts_at: '2026-08-20T19:00:00.000Z',
            planned_minutes: 60,
            reviewing_at: null,
            operation_id: null,
            clients: { name: 'Acme' },
            tasks: { title: 'Audit' },
            time_log_segments: [{
                id: 'segment-1',
                time_log_id: 'running-1',
                organization_id: 'org-1',
                user_id: 'user-1',
                started_at: '2026-08-20T20:00:00.000Z',
                ended_at: null,
            }],
        },
        {
            id: 'paused-1',
            organization_id: 'org-1',
            user_id: 'user-1',
            date: '2026-08-20',
            hours: 0,
            description: '',
            status: 'in_progress',
            timer_started_at: null,
            elapsed_seconds: 120,
            time_log_segments: [],
        },
    ]);

    assert.equal(state.running?.id, 'running-1');
    assert.equal(state.running?.clientName, 'Acme');
    assert.equal(state.running?.taskTitle, 'Audit');
    assert.equal(state.running?.plannedMinutes, 60);
    assert.deepEqual(state.running?.segments, [{
        id: 'segment-1',
        timeLogId: 'running-1',
        organizationId: 'org-1',
        userId: 'user-1',
        startedAt: '2026-08-20T20:00:00.000Z',
        endedAt: undefined,
    }]);
    assert.deepEqual(state.paused.map(attempt => attempt.id), ['paused-1']);
    assert.equal('organization_id' in (state.running ?? {}), false);
    assert.equal('time_log_segments' in (state.running ?? {}), false);
});
