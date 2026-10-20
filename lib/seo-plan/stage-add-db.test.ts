import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
    clientBelongsToOrganization,
    deleteStageTasks,
    insertStageTasks,
    loadStageAddParent,
    maxStageAddPosition,
} from './stage-add-db.ts';
import { STAGE_LIST_TASK_COLUMNS } from './stage-list-load.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const other = '11111111-1111-4111-8111-111111111111';
const clientId = '7071eda4-ccc6-4122-abef-4cb0702bc682';
const parentId = '208dbc36-0000-4000-8000-000000000001';

interface Call {
    table: string;
    op: string;
    column?: string;
    value?: unknown;
    columns?: string;
}

function fake(options: {
    client?: { data: unknown; error: { message: string } | null };
    parent?: { data: unknown; error: { message: string } | null };
    max?: { data: unknown; error: { message: string } | null };
    insert?: { data: unknown; error: { message: string } | null };
} = {}) {
    const calls: Call[] = [];
    const client = {
        from(table: string) {
            const filters: { column: string }[] = [];
            const api = {
                select(columns: string) {
                    calls.push({ table, op: 'select', columns });
                    return api;
                },
                eq(column: string, value: unknown) {
                    filters.push({ column });
                    calls.push({ table, op: 'eq', column, value });
                    return api;
                },
                is(column: string, value: unknown) {
                    calls.push({ table, op: 'is', column, value });
                    return api;
                },
                order(column: string, value: unknown) {
                    calls.push({ table, op: 'order', column, value });
                    return api;
                },
                limit(value: number) {
                    calls.push({ table, op: 'limit', value });
                    return api;
                },
                maybeSingle() {
                    if (table === 'clients') return Promise.resolve(options.client ?? { data: { id: clientId }, error: null });
                    if (filters.some(filter => filter.column === 'id')) {
                        return Promise.resolve(options.parent ?? { data: null, error: null });
                    }
                    return Promise.resolve(options.max ?? { data: { position: 4 }, error: null });
                },
                insert(rows: unknown) {
                    calls.push({ table, op: 'insert', value: rows });
                    return {
                        select(columns: string) {
                            calls.push({ table, op: 'insert-select', columns });
                            return Promise.resolve(options.insert ?? {
                                data: [{
                                    id: 'created',
                                    title: 'Review robots.txt',
                                    status: 'todo',
                                    stage: 'backlog',
                                    position: 5,
                                    parent_task_id: null,
                                    created_at: '2026-10-16T00:00:00.000Z',
                                    category: null,
                                    basecamp_todo_id: null,
                                    recurrence: null,
                                }],
                                error: null,
                            });
                        },
                    };
                },
            };
            return api;
        },
    } as unknown as SupabaseClient;
    return { client, calls };
}

test('the client check is limited to the session organization', async () => {
    const store = fake();
    assert.equal(await clientBelongsToOrganization(store.client, org, clientId), true);
    assert.equal(store.calls.find(call => call.table === 'clients' && call.column === 'id')?.value, clientId);
    assert.equal(store.calls.find(call => call.table === 'clients' && call.column === 'organization_id')?.value, org);
    assert.equal(store.calls.some(call => call.value === other), false);

    const missing = fake({ client: { data: null, error: null } });
    assert.equal(await clientBelongsToOrganization(missing.client, org, clientId), false);
});

test('a parent read cannot cross clients or organizations', async () => {
    const store = fake({
        parent: {
            data: { title: 'SEO Setup', stage: 'onboarding', parent_task_id: null },
            error: null,
        },
    });
    const parent = await loadStageAddParent(store.client, org, clientId, parentId);
    assert.deepEqual(parent, { title: 'SEO Setup', stage: 'onboarding', parentTaskId: null });
    assert.equal(store.calls.find(call => call.column === 'id')?.value, parentId);
    assert.equal(store.calls.find(call => call.column === 'organization_id')?.value, org);
    assert.equal(store.calls.find(call => call.column === 'client_id')?.value, clientId);
    assert.equal(store.calls.some(call => call.columns?.includes('description')), false);
    assert.equal(/email|assignee|secret|credential/i.test(store.calls.map(call => call.columns ?? '').join(' ')), false);
});

test('top-level placement is the stage, and a subtask placement is the pillar', async () => {
    const top = fake();
    assert.equal(await maxStageAddPosition(top.client, org, clientId, 'backlog', null), 4);
    assert.equal(top.calls.find(call => call.op === 'is' && call.column === 'parent_task_id')?.value, null);
    assert.equal(top.calls.find(call => call.column === 'stage')?.value, 'backlog');
    assert.equal(top.calls.find(call => call.column === 'organization_id')?.value, org);
    assert.equal(top.calls.find(call => call.column === 'client_id')?.value, clientId);

    const child = fake();
    await maxStageAddPosition(child.client, org, clientId, 'onboarding', parentId);
    assert.equal(child.calls.find(call => call.column === 'parent_task_id')?.value, parentId);
    assert.equal(child.calls.some(call => call.column === 'stage'), false);
    assert.equal(child.calls.some(call => call.op === 'is'), false);
});

test('insert selects only the stage-list columns', async () => {
    const store = fake();
    const tasks = await insertStageTasks(store.client, [{ title: 'Review robots.txt', organization_id: org }]);
    assert.equal(tasks[0]?.title, 'Review robots.txt');
    assert.equal(tasks[0]?.basecamp, false);
    assert.equal(store.calls.find(call => call.op === 'insert-select')?.columns, STAGE_LIST_TASK_COLUMNS);
    assert.equal(/credential|email|description|secret/i.test(STAGE_LIST_TASK_COLUMNS), false);
    assert.match(STAGE_LIST_TASK_COLUMNS, /\bassignee_ids\b/);
});

test('database failures stay generic', async () => {
    const secret = { data: null, error: { message: 'token sk_live_secret' } };
    await assert.rejects(clientBelongsToOrganization(fake({ client: secret }).client, org, clientId), /Unable to load client/);
    await assert.rejects(loadStageAddParent(fake({ parent: secret }).client, org, clientId, parentId), /Unable to load task/);
    await assert.rejects(maxStageAddPosition(fake({ max: secret }).client, org, clientId, 'backlog', null), /Unable to place tasks/);
    await assert.rejects(insertStageTasks(fake({ insert: secret }).client, [{}]), /Unable to create tasks/);
    await assert.rejects(insertStageTasks(fake({ insert: secret }).client, [{}]), (error: Error) => {
        assert.equal(error.message.includes('sk_live'), false);
        assert.equal(error.message.includes('token'), false);
        return true;
    });
});

test('undoing an add deletes only the ids from that add', async () => {
    const calls: { column?: string; ids?: string[] }[] = [];
    const db = {
        from() {
            return {
                delete() {
                    return {
                        in(column: string, ids: string[]) {
                            calls.push({ column, ids });
                            return Promise.resolve({ error: null });
                        },
                    };
                },
            };
        },
    } as unknown as SupabaseClient;
    await deleteStageTasks(db, []);
    assert.equal(calls.length, 0);
    await deleteStageTasks(db, ['pillar-1', 'pillar-2']);
    assert.deepEqual(calls, [{ column: 'id', ids: ['pillar-1', 'pillar-2'] }]);

    const failing = {
        from() {
            return {
                delete() {
                    return {
                        in() {
                            return Promise.resolve({ error: { message: 'token sk_live_secret' } });
                        },
                    };
                },
            };
        },
    } as unknown as SupabaseClient;
    await assert.rejects(deleteStageTasks(failing, ['pillar-1']), (error: Error) => {
        assert.equal(error.message, 'Unable to undo tasks');
        assert.equal(error.message.includes('sk_live'), false);
        return true;
    });
});
