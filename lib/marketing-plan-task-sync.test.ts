/**
 * Run with: node --import tsx --test lib/marketing-plan-task-sync.test.ts
 * The database half uses PGlite and never connects to production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(
    new URL('../migrations/059_marketing_plan_task_sync.sql', import.meta.url),
    'utf8',
);
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

function functionBody(sql: string): string {
    const match = sql.match(
        /create or replace function public\.sync_marketing_plan_item_from_task\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i,
    );
    assert.ok(match, 'missing sync_marketing_plan_item_from_task function');
    return match[1];
}

test('task-sync migration is mirrored into schema.sql', () => {
    for (const sql of [migration, schema]) {
        const body = functionBody(sql);
        assert.match(body, /new\.status in \('done', 'approved'\)/i);
        assert.match(body, /and status = 'todo'/i);
        assert.match(body, /and status = 'done'/i);
        assert.match(body, /organization_id = new\.organization_id/i);
        assert.match(body, /new\.status is not distinct from old\.status/i);
        assert.match(sql, /after update of status on public\.tasks/i);
        assert.match(sql, /security definer/i);
        assert.match(sql, /set search_path = pg_catalog, public/i);
        assert.match(
            sql,
            /item\.status = 'todo'[\s\S]+task\.status in \('done', 'approved'\)/i,
        );
    }
    assert.doesNotMatch(migration, /drop table|drop column/i);
});

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

test('linked checklist items follow task status, including writers that skip updateTask', async () => {
    const db = new PGlite();
    await db.exec(`
        create table public.tasks (
            id uuid primary key,
            organization_id uuid not null,
            status text not null,
            title text not null default ''
        );
        create table public.marketing_plan_items (
            id uuid primary key,
            organization_id uuid not null,
            task_id uuid references public.tasks(id) on delete set null,
            status text not null check (status in ('todo', 'done', 'ignored')),
            title text not null default '',
            updated_at timestamptz not null default timezone('utc', now())
        );
        insert into public.tasks (id, organization_id, status, title) values
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '${ORG}', 'done', 'finished'),
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '${ORG}', 'todo', 'still open'),
            ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', '${ORG}', 'approved', 'accepted');
        insert into public.marketing_plan_items
            (id, organization_id, task_id, status, title, updated_at) values
            ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '${ORG}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'todo', 'catch up', '2020-01-01'),
            ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '${ORG}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'ignored', 'skip', '2020-01-01'),
            ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3', '${ORG}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'done', 'checked by hand', '2020-01-01'),
            ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4', '${ORG}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'todo', 'approved work', '2020-01-01');
    `);
    await db.exec(migration);

    const statusOf = async (id: string) => {
        const res = await db.query<{ status: string; updated_at: string }>(
            'select status, updated_at::text as updated_at from public.marketing_plan_items where id = $1',
            [id],
        );
        return res.rows[0];
    };

    assert.equal((await statusOf('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1')).status, 'done');
    assert.equal((await statusOf('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2')).status, 'ignored');
    assert.equal((await statusOf('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3')).status, 'done');
    assert.equal((await statusOf('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4')).status, 'done');

    await db.exec(`
        insert into public.tasks (id, organization_id, status, title) values
            ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '${ORG}', 'todo', 'live'),
            ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '${ORG}', 'todo', 'untouched'),
            ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '${ORG}', 'done', 'reopen me'),
            ('cccccccc-cccc-4ccc-8ccc-ccccccccccc4', '${ORG}', 'todo', 'approve me'),
            ('cccccccc-cccc-4ccc-8ccc-ccccccccccc5', '${ORG}', 'done', 'block me'),
            ('cccccccc-cccc-4ccc-8ccc-ccccccccccc6', '${ORG}', 'todo', 'other org task');
        insert into public.marketing_plan_items
            (id, organization_id, task_id, status, title, updated_at) values
            ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '${ORG}', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'todo', 'will complete', '2020-01-01'),
            ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', '${ORG}', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'todo', 'title only', '2020-01-01'),
            ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3', '${ORG}', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'done', 'will reopen', '2020-01-01'),
            ('dddddddd-dddd-4ddd-8ddd-ddddddddddd4', '${ORG}', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc4', 'todo', 'will approve', '2020-01-01'),
            ('dddddddd-dddd-4ddd-8ddd-ddddddddddd5', '${ORG}', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc5', 'done', 'will block', '2020-01-01'),
            ('dddddddd-dddd-4ddd-8ddd-ddddddddddd6', '${ORG}', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'ignored', 'stay ignored', '2020-01-01'),
            ('dddddddd-dddd-4ddd-8ddd-ddddddddddd7', '${ORG}', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'todo', 'different task', '2020-01-01'),
            ('dddddddd-dddd-4ddd-8ddd-ddddddddddd8', '${OTHER}', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc6', 'todo', 'wrong org', '2020-01-01');
    `);

    // Direct status write — the same shape as the Basecamp webhook and the
    // timer-finalize route, neither of which calls updateTask.
    await db.query(`update public.tasks set status = 'done' where id = $1`, [
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    ]);
    assert.equal((await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd1')).status, 'done');
    assert.equal((await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd6')).status, 'ignored');

    const beforeTitle = await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd2');
    await db.query(`update public.tasks set title = 'renamed' where id = $1`, [
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    ]);
    const afterTitle = await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd2');
    assert.equal(afterTitle.status, 'todo');
    assert.equal(afterTitle.updated_at, beforeTitle.updated_at);
    assert.equal((await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd7')).status, 'todo');

    await db.query(`update public.tasks set status = 'in_progress' where id = $1`, [
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    ]);
    assert.equal((await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd3')).status, 'todo');

    await db.query(`update public.tasks set status = 'approved' where id = $1`, [
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
    ]);
    assert.equal((await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd4')).status, 'done');

    await db.query(`update public.tasks set status = 'blocked' where id = $1`, [
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc5',
    ]);
    assert.equal((await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd5')).status, 'todo');

    await db.query(`update public.tasks set status = 'done' where id = $1`, [
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc6',
    ]);
    assert.equal((await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd8')).status, 'todo');

    // Writing the same status again must not touch the item.
    const stable = await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd1');
    await db.query(`update public.tasks set status = 'done' where id = $1`, [
        'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    ]);
    const still = await statusOf('dddddddd-dddd-4ddd-8ddd-ddddddddddd1');
    assert.equal(still.status, 'done');
    assert.equal(still.updated_at, stable.updated_at);

    // The item write does not depend on the caller's privileges on the
    // checklist table. Authenticated can update their own task and nothing else.
    await db.exec(`
        create role authenticated;
        grant select, update on public.tasks to authenticated;
        alter table public.tasks enable row level security;
        alter table public.marketing_plan_items enable row level security;
        create policy tasks_org on public.tasks for update
            using (organization_id = nullif(current_setting('test.org', true), '')::uuid)
            with check (organization_id = nullif(current_setting('test.org', true), '')::uuid);
        create policy tasks_read on public.tasks for select
            using (organization_id = nullif(current_setting('test.org', true), '')::uuid);
        insert into public.tasks (id, organization_id, status, title) values
            ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', '${ORG}', 'todo', 'member task'),
            ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', '${OTHER}', 'todo', 'someone else');
        insert into public.marketing_plan_items
            (id, organization_id, task_id, status, title) values
            ('ffffffff-ffff-4fff-8fff-fffffffffff1', '${ORG}', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'todo', 'member item'),
            ('ffffffff-ffff-4fff-8fff-fffffffffff2', '${OTHER}', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2', 'todo', 'other item');
    `);
    await db.exec(`set role authenticated; set test.org = '${ORG}'`);
    const own = await db.query<{ id: string }>(
        `update public.tasks set status = 'done' where id = $1 returning id`,
        ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'],
    );
    assert.deepEqual(own.rows.map(row => row.id), ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1']);
    const foreign = await db.query(
        `update public.tasks set status = 'done' where id = $1 returning id`,
        ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2'],
    );
    assert.equal(foreign.rows.length, 0);
    await db.exec('reset role');
    assert.equal((await statusOf('ffffffff-ffff-4fff-8fff-fffffffffff1')).status, 'done');
    assert.equal((await statusOf('ffffffff-ffff-4fff-8fff-fffffffffff2')).status, 'todo');

    await db.close();
});
