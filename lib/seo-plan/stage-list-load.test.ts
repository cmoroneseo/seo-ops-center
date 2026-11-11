import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { STAGE_LIST_CLIENT_COLUMNS, STAGE_LIST_TASK_COLUMNS, loadClientStageTasks } from './stage-list-load.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const clientId = '7071eda4-ccc6-4122-abef-4cb0702bc682';

function db(options: { client?: boolean; taskError?: boolean; clientError?: boolean } = {}) {
    const filters: { table: string; column: string; value: unknown }[] = [];
    const selected: string[] = [];
    const orders: { table: string; column: string }[] = [];
    const client: SupabaseClient = {
        from(table: string) {
            const api = {
                select(columns: string) {
                    selected.push(`${table}:${columns}`);
                    return api;
                },
                eq(column: string, value: unknown) {
                    filters.push({ table, column, value });
                    return api;
                },
                order(column: string) {
                    orders.push({ table, column });
                    return api;
                },
                maybeSingle() {
                    if (options.clientError) return Promise.resolve({ data: null, error: { message: 'db down' } });
                    if (options.client === false) return Promise.resolve({ data: null, error: null });
                    return Promise.resolve({ data: { id: clientId }, error: null });
                },
                then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown, reject?: (reason: unknown) => unknown) {
                    const result = options.taskError
                        ? { data: null, error: { message: 'token leak' } }
                        : {
                            data: [{
                                id: 'setup',
                                title: 'SEO Setup',
                                status: 'todo',
                                stage: 'onboarding',
                                position: 1,
                                parent_task_id: null,
                                created_at: '2026-01-02T00:00:00.000Z',
                                category: 'admin',
                                basecamp_todo_id: null,
                                recurrence: null,
                            }],
                            error: null,
                        };
                    return Promise.resolve(result).then(resolve, reject);
                },
            };
            return api;
        },
    } as unknown as SupabaseClient;
    return { client, filters, selected, orders };
}

test('stage task reads are limited to the session organization and the client', async () => {
    const fake = db();
    const tasks = await loadClientStageTasks(fake.client, org, clientId);
    assert.equal(tasks?.length, 1);
    assert.equal(tasks?.[0].title, 'SEO Setup');
    assert.equal(tasks?.[0].recurring, false);
    assert.equal(fake.filters.find(filter => filter.table === 'clients' && filter.column === 'id')?.value, clientId);
    assert.equal(fake.filters.find(filter => filter.table === 'clients' && filter.column === 'organization_id')?.value, org);
    assert.equal(fake.filters.find(filter => filter.table === 'tasks' && filter.column === 'organization_id')?.value, org);
    assert.equal(fake.filters.find(filter => filter.table === 'tasks' && filter.column === 'client_id')?.value, clientId);
    assert.deepEqual(fake.orders.map(item => item.column), ['position', 'created_at', 'id']);
    assert.equal(fake.selected.includes(`tasks:${STAGE_LIST_TASK_COLUMNS}`), true);
    assert.equal(fake.selected.includes(`clients:${STAGE_LIST_CLIENT_COLUMNS}`), true);
    assert.equal(/credential|email|secret/i.test(STAGE_LIST_TASK_COLUMNS), false);
    assert.match(STAGE_LIST_TASK_COLUMNS, /\bdescription\b/);
    assert.match(STAGE_LIST_TASK_COLUMNS, /\bestimated_hours\b/);
    assert.match(STAGE_LIST_TASK_COLUMNS, /\bassignee_ids\b/);
    assert.match(STAGE_LIST_TASK_COLUMNS, /\bpriority\b/);
    assert.match(STAGE_LIST_TASK_COLUMNS, /\bblocked_reason\b/);
});

test('a client outside the session organization does not load tasks', async () => {
    const fake = db({ client: false });
    const tasks = await loadClientStageTasks(fake.client, org, clientId);
    assert.equal(tasks, null);
    assert.equal(fake.filters.some(filter => filter.table === 'tasks'), false);
});

function taskClient(link: 'present' | 'missing'): SupabaseClient {
    return {
        from() {
            let columns = '';
            const api = {
                select(next: string) {
                    columns = next;
                    return api;
                },
                eq() { return api; },
                order() { return api; },
                maybeSingle() {
                    return Promise.resolve({ data: { id: clientId }, error: null });
                },
                then(resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) {
                    if (columns.includes('initiative_id')) {
                        if (link === 'missing') {
                            return Promise.resolve({ data: null, error: { message: 'column tasks.initiative_id does not exist' } }).then(resolve);
                        }
                        return Promise.resolve({
                            data: [{ id: 'setup', initiative_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
                            error: null,
                        }).then(resolve);
                    }
                    return Promise.resolve({
                        data: [{
                            id: 'setup',
                            title: 'SEO Setup',
                            status: 'todo',
                            stage: 'onboarding',
                            position: 1,
                            parent_task_id: null,
                            created_at: '2026-01-02T00:00:00.000Z',
                            category: null,
                            basecamp_todo_id: null,
                            recurrence: null,
                        }],
                        error: null,
                    }).then(resolve);
                },
            };
            return api;
        },
    } as unknown as SupabaseClient;
}

test('a present initiative column is attached and a missing one leaves the plan alone', async () => {
    const linked = await loadClientStageTasks(taskClient('present'), org, clientId);
    assert.equal(linked?.[0]?.title, 'SEO Setup');
    assert.equal(linked?.[0]?.initiativeId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    const plain = await loadClientStageTasks(taskClient('missing'), org, clientId);
    assert.equal(plain?.[0]?.title, 'SEO Setup');
    assert.equal('initiativeId' in (plain?.[0] ?? {}), false);
});

test('database failures stay generic', async () => {
    await assert.rejects(loadClientStageTasks(db({ clientError: true }).client, org, clientId), /Unable to load client/);
    await assert.rejects(loadClientStageTasks(db({ taskError: true }).client, org, clientId), /Unable to load tasks/);
    await assert.rejects(loadClientStageTasks(db({ taskError: true }).client, org, clientId), (error: Error) => {
        assert.equal(error.message.includes('token'), false);
        return true;
    });
});
