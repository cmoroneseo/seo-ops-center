import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMappingUpdate, type MappingContext } from './mapping.ts';

function context(overrides: Partial<MappingContext> = {}): MappingContext {
    return {
        organizationId: 'org-1',
        actorUserId: 'user-carlos',
        now: '2026-08-24T18:00:00Z',
        log: {
            id: 'log-1',
            organizationId: 'org-1',
            importStatus: 'needs_review',
            source: 'basecamp',
        },
        client: { id: 'client-a', organizationId: 'org-1' },
        task: null,
        member: { userId: 'user-abel', organizationId: 'org-1' },
        ...overrides,
    };
}

const request = { timeLogId: 'log-1', clientId: 'client-a', taskId: null, userId: 'user-abel' };

test('a resolved mapping marks the row mapped and records who did it', () => {
    const result = buildMappingUpdate(context(), request);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.patch, {
        client_id: 'client-a',
        task_id: null,
        user_id: 'user-abel',
        import_status: 'mapped',
        mapped_by: 'user-carlos',
        mapped_at: '2026-08-24T18:00:00Z',
    });
});

test('a task mapping carries the task and must agree with the client', () => {
    const result = buildMappingUpdate(
        context({ task: { id: 'task-9', organizationId: 'org-1', clientId: 'client-a' } }),
        { ...request, taskId: 'task-9' },
    );

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.patch.task_id, 'task-9');
});

test('a task belonging to another client is rejected', () => {
    const result = buildMappingUpdate(
        context({ task: { id: 'task-9', organizationId: 'org-1', clientId: 'client-b' } }),
        { ...request, taskId: 'task-9' },
    );

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});

test('a client in another organization is rejected', () => {
    const result = buildMappingUpdate(
        context({ client: { id: 'client-x', organizationId: 'org-2' } }),
        { ...request, clientId: 'client-x' },
    );

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 403);
});

test('a task in another organization is rejected', () => {
    const result = buildMappingUpdate(
        context({ task: { id: 'task-x', organizationId: 'org-2', clientId: 'client-a' } }),
        { ...request, taskId: 'task-x' },
    );

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 403);
});

test('a member in another organization is rejected', () => {
    const result = buildMappingUpdate(
        context({ member: { userId: 'user-outsider', organizationId: 'org-2' } }),
        { ...request, userId: 'user-outsider' },
    );

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 403);
});

test('a time log in another organization is rejected', () => {
    const result = buildMappingUpdate(
        context({ log: { id: 'log-1', organizationId: 'org-2', importStatus: 'needs_review', source: 'basecamp' } }),
        request,
    );

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 403);
});

test('a missing client, task, or member is a not-found, never a guess', () => {
    assert.equal(buildMappingUpdate(context({ client: null }), request).ok, false);
    assert.equal(buildMappingUpdate(context({ member: null }), request).ok, false);
    assert.equal(
        buildMappingUpdate(context(), { ...request, taskId: 'task-missing' }).ok,
        false,
    );
});

test('mapping requires an explicit member — it is never inferred', () => {
    const result = buildMappingUpdate(context(), { ...request, userId: '' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});

test('mapping requires an explicit client', () => {
    const result = buildMappingUpdate(context(), { ...request, clientId: '' });

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});

test('an already-mapped row is not remapped through this path', () => {
    const result = buildMappingUpdate(
        context({ log: { id: 'log-1', organizationId: 'org-1', importStatus: 'mapped', source: 'basecamp' } }),
        request,
    );

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 409);
});

test('a voided row cannot be resurrected by mapping it', () => {
    const result = buildMappingUpdate(
        context({ log: { id: 'log-1', organizationId: 'org-1', importStatus: 'voided', source: 'basecamp' } }),
        request,
    );

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 409);
});
