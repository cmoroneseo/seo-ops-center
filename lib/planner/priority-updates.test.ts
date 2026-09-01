import test from 'node:test';
import assert from 'node:assert/strict';
import * as priorityUpdateHelpers from './priority-updates.ts';
import { planTaskDrop, priorityUpdatesSucceeded } from './priority-updates.ts';

test('planner task drop RPC succeeds only when Supabase returns true without an error', () => {
    const rpcSucceeded = (priorityUpdateHelpers as Record<string, unknown>)
        .plannerTaskDropRpcSucceeded as ((result: { data: unknown; error: unknown }) => boolean) | undefined;

    assert.equal(typeof rpcSucceeded, 'function', 'plannerTaskDropRpcSucceeded must be exported');
    assert.equal(rpcSucceeded?.({ data: true, error: null }), true);
    assert.equal(rpcSucceeded?.({ data: false, error: null }), false);
    assert.equal(rpcSucceeded?.({ data: null, error: null }), false);
    assert.equal(rpcSucceeded?.({ data: true, error: { message: 'permission denied' } }), false);
});

test('priority updates fail when any Supabase response contains an error', () => {
    assert.equal(priorityUpdatesSucceeded([
        { error: null },
        { error: { message: 'permission denied' } },
        { error: null },
    ]), false);
});

test('priority updates succeed when every Supabase response is error-free', () => {
    assert.equal(priorityUpdatesSucceeded([
        { error: null },
        { error: null },
    ]), true);
});

test('dropping a task on priorities requests one linked priority', () => {
    assert.deepEqual(planTaskDrop('priorities', 'task-7', []), {
        unschedule: true,
        addPriority: true,
    });
});

test('dropping an existing priority never duplicates its task', () => {
    assert.deepEqual(planTaskDrop('priorities', 'task-7', [
        { taskId: 'task-2' },
        { taskId: 'task-7' },
    ]), {
        unschedule: true,
        addPriority: false,
    });
});

test('dropping on backlog only unschedules the task', () => {
    assert.deepEqual(planTaskDrop('backlog', 'task-7', []), {
        unschedule: true,
        addPriority: false,
    });
});

test('tied priority positions have a deterministic created-at and id order', () => {
    const compare = (priorityUpdateHelpers as Record<string, unknown>)
        .comparePlannerPriorityOrder as ((
            a: { sortOrder: number; createdAt: string; id: string },
            b: { sortOrder: number; createdAt: string; id: string },
        ) => number) | undefined;
    assert.equal(typeof compare, 'function', 'comparePlannerPriorityOrder must be exported');

    const priorities = [
        { sortOrder: 4, createdAt: '2026-09-01T12:00:00Z', id: 'b' },
        { sortOrder: 4, createdAt: '2026-09-01T11:00:00Z', id: 'z' },
        { sortOrder: 4, createdAt: '2026-09-01T12:00:00Z', id: 'a' },
        { sortOrder: 2, createdAt: '2026-09-01T13:00:00Z', id: 'x' },
    ];

    assert.deepEqual(priorities.sort(compare), [
        { sortOrder: 2, createdAt: '2026-09-01T13:00:00Z', id: 'x' },
        { sortOrder: 4, createdAt: '2026-09-01T11:00:00Z', id: 'z' },
        { sortOrder: 4, createdAt: '2026-09-01T12:00:00Z', id: 'a' },
        { sortOrder: 4, createdAt: '2026-09-01T12:00:00Z', id: 'b' },
    ]);
});
