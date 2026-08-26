import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createImportQueueGet,
    type ImportQueueDependencies,
    type QueueSourceRow,
} from './import-queue-route.ts';

function sourceRow(overrides: Partial<QueueSourceRow> = {}): QueueSourceRow {
    return {
        id: 'log-1',
        userId: 'user-abel',
        clientId: 'client-a',
        clientName: 'Client A',
        isInternal: false,
        activityKeys: ['technical_audit'],
        taskId: null,
        taskTitle: null,
        importStatus: 'needs_context',
        date: '2026-08-06',
        hours: 4.5,
        description: '',
        countsTowardBudget: true,
        basecampProjectName: 'Scott Cole Plumbing',
        reviewNote: null,
        ...overrides,
    };
}

function harness(options: { isManager?: boolean; rows?: QueueSourceRow[] } = {}) {
    const queried: { organizationId: string; userId: string | null }[] = [];
    const dependencies: ImportQueueDependencies = {
        async authorize() {
            return {
                ok: true,
                userId: 'user-abel',
                organizationId: 'org-1',
                isManager: options.isManager ?? false,
            };
        },
        async listQueue(scope) {
            queried.push(scope);
            return options.rows ?? [sourceRow()];
        },
    };
    return { queried, get: createImportQueueGet(dependencies) };
}

function url(params: Record<string, string> = {}) {
    return new Request(
        `https://seo-pm.test/api/timesheets/imports?${new URLSearchParams({ organizationId: 'org-1', ...params })}`,
    );
}

test('a member sees only their own queue', async () => {
    const { get, queried } = harness();
    const response = await get(url());

    assert.equal(response.status, 200);
    assert.equal(queried[0].userId, 'user-abel');
});

test('a member cannot request another member’s queue', async () => {
    const { get, queried } = harness();
    const response = await get(url({ userId: 'user-carlos' }));

    assert.equal(response.status, 403);
    assert.deepEqual(queried, []);
});

test('a manager sees the whole organization by default', async () => {
    const { get, queried } = harness({ isManager: true });
    await get(url());

    assert.equal(queried[0].userId, null);
});

test('a manager can narrow to one member', async () => {
    const { get, queried } = harness({ isManager: true });
    await get(url({ userId: 'user-abel' }));

    assert.equal(queried[0].userId, 'user-abel');
});

test('rows carry derived issues and readiness', async () => {
    const { get } = harness({
        rows: [
            sourceRow({ id: 'ready' }),
            sourceRow({ id: 'blocked', activityKeys: [] }),
        ],
    });

    const payload = await (await get(url())).json();
    assert.deepEqual(payload.rows[0].issues, ['no_task_link']);
    assert.equal(payload.rows[0].isReady, true);
    assert.deepEqual(payload.rows[1].issues, ['no_activity', 'no_task_link']);
    assert.equal(payload.rows[1].isReady, false);
});

test('the summary counts what the footer needs', async () => {
    const { get } = harness({
        rows: [
            sourceRow({ id: 'a' }),
            sourceRow({ id: 'b', activityKeys: [] }),
            sourceRow({ id: 'c', importStatus: 'pending_review' }),
        ],
    });

    const payload = await (await get(url())).json();
    assert.deepEqual(payload.summary, { total: 3, ready: 1, blocked: 1, pendingReview: 1 });
});

test('minutes are precomputed so the UI does no arithmetic', async () => {
    const { get } = harness({ rows: [sourceRow({ hours: 4.5 })] });

    const payload = await (await get(url())).json();
    assert.equal(payload.rows[0].minutes, 270);
});
