import { test } from 'node:test';
import assert from 'node:assert/strict';

type RouteModule = typeof import('./webhook-route.ts');

async function loadRouteModule(): Promise<RouteModule> {
    try {
        return await import('./webhook-route.ts');
    } catch (error) {
        assert.fail(`Basecamp webhook handler must be implemented: ${String(error)}`);
    }
}

function request(
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
) {
    return new Request('https://seo-pm.test/api/integrations/basecamp/webhook', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Basecamp3 Webhook',
            'X-Request-Id': '983c75a3-3dc2-465c-9ade-816aaf660d4e',
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

const completionPayload = {
    id: 1695159515,
    kind: 'todo_completed',
    recording: {
        id: 77,
        type: 'Todo',
        completed: true,
        url: 'https://3.basecampapi.com/5338018/buckets/202/todos/77.json',
    },
    creator: { name: 'Carlos Morones' },
};

const task = {
    id: 'task-a',
    status: 'in_progress',
    statusHistory: [],
    organizationId: 'org-a',
    clientId: 'client-a',
    title: 'Canonical task',
    basecampTodoId: '77',
    basecampProjectId: '202',
};

function dependencies(overrides: Record<string, unknown> = {}) {
    const calls = {
        claimed: [] as string[],
        processed: [] as string[],
        updated: [] as string[],
        provider: [] as string[],
    };
    const value = {
        expectedAccountId: '5338018',
        now: () => '2026-08-24T23:00:00.000Z',
        store: {
            async claimDelivery(delivery: { eventId: string }) {
                calls.claimed.push(delivery.eventId);
                return 'new' as const;
            },
            async markDeliveryProcessed(eventId: string) {
                calls.processed.push(eventId);
            },
            async getTaskByTodoId() {
                return task;
            },
            async updateTaskStatus(_task: typeof task, status: string) {
                calls.updated.push(status);
                return true;
            },
        },
        provider: {
            isConfigured: () => true,
            async getTodo(projectId: string, todoId: string) {
                calls.provider.push(`${projectId}:${todoId}`);
                return { id: 77, completed: true };
            },
        },
        async logCompletion() {},
        ...overrides,
    };
    return { value, calls };
}

async function responseBody(response: Response) {
    return await response.json() as Record<string, unknown>;
}

test('accepts a real Basecamp delivery without a custom secret and verifies provider state before completing', async () => {
    const { createBasecampWebhookPost } = await loadRouteModule();
    const { value, calls } = dependencies();
    const post = createBasecampWebhookPost(value);

    const response = await post(request(completionPayload));

    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), {
        ok: true,
        action: 'completed',
        taskId: 'task-a',
    });
    assert.deepEqual(calls.provider, ['202:77']);
    assert.deepEqual(calls.updated, ['done']);
    assert.deepEqual(calls.processed, ['1695159515']);
});

test('uses authenticated provider state instead of trusting a stale completion payload', async () => {
    const { createBasecampWebhookPost } = await loadRouteModule();
    const { value, calls } = dependencies({
        provider: {
            isConfigured: () => true,
            async getTodo(projectId: string, todoId: string) {
                calls.provider.push(`${projectId}:${todoId}`);
                return { id: 77, completed: false };
            },
        },
        store: {
            async claimDelivery() { return 'new' as const; },
            async markDeliveryProcessed(eventId: string) { calls.processed.push(eventId); },
            async getTaskByTodoId() { return { ...task, status: 'done' }; },
            async updateTaskStatus(_task: typeof task, status: string) {
                calls.updated.push(status);
                return true;
            },
        },
    });
    const post = createBasecampWebhookPost(value);

    const response = await post(request(completionPayload));

    assert.equal(response.status, 200);
    assert.equal((await responseBody(response)).action, 'reopened');
    assert.deepEqual(calls.updated, ['todo']);
});

test('deduplicates an already-processed Basecamp event before provider or task work', async () => {
    const { createBasecampWebhookPost } = await loadRouteModule();
    const { value, calls } = dependencies({
        store: {
            async claimDelivery() { return 'processed' as const; },
            async markDeliveryProcessed() { throw new Error('must not mark twice'); },
            async getTaskByTodoId() { throw new Error('task lookup must not run'); },
            async updateTaskStatus() { throw new Error('task update must not run'); },
        },
        provider: {
            isConfigured: () => { throw new Error('provider must not run'); },
            async getTodo() { throw new Error('provider must not run'); },
        },
    });
    const post = createBasecampWebhookPost(value);

    const response = await post(request(completionPayload));

    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), { ok: true, skipped: 'duplicate' });
    assert.deepEqual(calls.updated, []);
});

test('acknowledges irrelevant Basecamp events without calling the provider', async () => {
    const { createBasecampWebhookPost } = await loadRouteModule();
    const { value, calls } = dependencies({
        provider: {
            isConfigured: () => { throw new Error('provider must not run'); },
            async getTodo() { throw new Error('provider must not run'); },
        },
    });
    const post = createBasecampWebhookPost(value);

    const response = await post(request({
        ...completionPayload,
        id: 1695159904,
        kind: 'todo_rescheduled',
    }));

    assert.equal(response.status, 200);
    assert.deepEqual(await responseBody(response), { ok: true, skipped: 'todo_rescheduled' });
    assert.deepEqual(calls.provider, []);
    assert.deepEqual(calls.processed, ['1695159904']);
});

test('rejects malformed delivery envelopes before creating a receipt', async () => {
    const { createBasecampWebhookPost } = await loadRouteModule();
    const { value, calls } = dependencies();
    const post = createBasecampWebhookPost(value);

    const response = await post(request(completionPayload, {
        'User-Agent': 'Not Basecamp',
    }));

    assert.equal(response.status, 401);
    assert.deepEqual(calls.claimed, []);
    assert.deepEqual(calls.provider, []);
});

test('rejects payload provenance that conflicts with the canonical account and project', async () => {
    const { createBasecampWebhookPost } = await loadRouteModule();
    const { value, calls } = dependencies();
    const post = createBasecampWebhookPost(value);

    const response = await post(request({
        ...completionPayload,
        recording: {
            ...completionPayload.recording,
            url: 'https://3.basecampapi.com/9999999/buckets/303/todos/77.json',
        },
    }));

    assert.equal(response.status, 403);
    assert.deepEqual(calls.provider, []);
    assert.deepEqual(calls.updated, []);
});

test('leaves a receipt retryable when provider verification is temporarily unavailable', async () => {
    const { createBasecampWebhookPost } = await loadRouteModule();
    const { value, calls } = dependencies({
        provider: {
            isConfigured: () => true,
            async getTodo() { return null; },
        },
    });
    const post = createBasecampWebhookPost(value);

    const response = await post(request(completionPayload));

    assert.equal(response.status, 503);
    assert.deepEqual(calls.processed, []);
    assert.deepEqual(calls.updated, []);
});
