import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';

import { rewriteStageTasks } from './stage-reorder-db.ts';
import type { StageReorderWrite } from './stage-reorder.ts';

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const clientId = '7071eda4-ccc6-4122-abef-4cb0702bc682';
const setup = '208dbc36-1111-4111-8111-111111111111';
const keywords = '208dbc36-2222-4222-8222-222222222222';

const writes: StageReorderWrite[] = [
    { id: setup, stage: 'backlog', position: 1, parentTaskId: null },
    { id: keywords, stage: 'backlog', position: 1, parentTaskId: setup },
];

function fake(result: { data: unknown; error: { message: string } | null }) {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const db = {
        from() {
            throw new Error('row updates must go through the reorder function');
        },
        rpc(name: string, args: Record<string, unknown>) {
            calls.push({ name, args });
            return Promise.resolve(result);
        },
    };
    return { db: db as unknown as SupabaseClient, calls };
}

test('the rewrite is one function call for every affected row', async () => {
    const { db, calls } = fake({
        data: [
            {
                id: setup,
                title: 'SEO Setup',
                status: 'todo',
                stage: 'backlog',
                position: 1,
                parent_task_id: null,
                created_at: '2026-01-01T00:00:00.000Z',
                category: null,
                basecamp_todo_id: null,
                recurrence: null,
            },
            {
                id: keywords,
                title: 'Add keywords',
                status: 'todo',
                stage: 'backlog',
                position: 1,
                parent_task_id: setup,
                created_at: '2026-01-01T00:00:00.000Z',
                category: null,
                basecamp_todo_id: null,
                recurrence: null,
            },
        ],
        error: null,
    });
    const tasks = await rewriteStageTasks(db, org, clientId, writes);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'reorder_stage_tasks');
    assert.equal(calls[0].args.p_organization_id, org);
    assert.equal(calls[0].args.p_client_id, clientId);
    assert.deepEqual(calls[0].args.p_patches, [
        { id: setup, stage: 'backlog', position: 1, parent_task_id: null },
        { id: keywords, stage: 'backlog', position: 1, parent_task_id: setup },
    ]);
    assert.deepEqual(tasks.map(task => [task.id, task.stage, task.parentTaskId]), [
        [setup, 'backlog', null],
        [keywords, 'backlog', setup],
    ]);
});

test('a database error or a short result throws instead of returning a partial order', async () => {
    const failed = fake({ data: null, error: { message: 'token sk_live_secret' } });
    await assert.rejects(rewriteStageTasks(failed.db, org, clientId, writes), /Unable to move tasks/);
    assert.equal(failed.calls.length, 1);

    const short = fake({ data: [], error: null });
    await assert.rejects(rewriteStageTasks(short.db, org, clientId, writes), /Unable to move tasks/);
    assert.equal(short.calls.length, 1);
});
