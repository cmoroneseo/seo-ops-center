import assert from 'node:assert/strict';
import test from 'node:test';

import { handlePlanBasecampSync } from './basecamp-sync-route.ts';
import type { PlanBasecampReadout } from './basecamp-push.ts';
import type { PlanPushOutcome } from './basecamp-push-run.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const taskId = '208dbc36-1111-4111-8111-111111111111';

const readout: PlanBasecampReadout = {
    taskId,
    qualifies: true,
    state: 'failed',
    error: 'Basecamp returned 404.',
    attemptedAt: '2026-10-20T18:14:00.000Z',
    basecampTodoId: '77',
    clientFailure: null,
    connected: true,
};

function deps(role: 'member' | 'viewer' = 'member') {
    const calls: string[] = [];
    return {
        calls,
        session: async () => ({ ok: true as const, userId: 'user-1', organizationId: org, role }),
        loadTask: async () => ({ organizationId: org }),
        read: async () => {
            calls.push('read');
            return readout;
        },
        sync: async () => {
            calls.push('sync');
            const outcome: PlanPushOutcome = {
                status: 'ok',
                todoId: '77',
                sync: { state: 'ok', error: null, attemptedAt: '2026-10-20T18:20:00.000Z' },
                banner: { connected: true, failure: null },
            };
            return outcome;
        },
    };
}

test('a retry pushes once and returns the cleared state', async () => {
    const dependencies = deps();
    const result = await handlePlanBasecampSync('POST', 'https://seo.test/api/seo-plan/basecamp-sync', {
        taskId,
    }, dependencies);
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.deepEqual(dependencies.calls, ['sync']);
    assert.equal((result.body.sync as { state: string }).state, 'ok');
});

test('a viewer can read the sync line and cannot push', async () => {
    const dependencies = deps('viewer');
    const read = await handlePlanBasecampSync(
        'GET',
        `https://seo.test/api/seo-plan/basecamp-sync?taskId=${taskId}`,
        null,
        dependencies,
    );
    assert.equal(read.status, 200);
    assert.equal(read.body.state, 'failed');
    const push = await handlePlanBasecampSync('POST', 'https://seo.test/api/seo-plan/basecamp-sync', { taskId }, dependencies);
    assert.equal(push.status, 403);
    assert.deepEqual(dependencies.calls, ['read']);
});
