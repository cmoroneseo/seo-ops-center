import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/106_retire_month_stages.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '00000000-0000-0000-0000-000000000010';
const member = '00000000-0000-0000-0000-000000000002';
const clientA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const clientB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

const onboarding = '10000000-0000-0000-0000-000000000001';
const backlogLow = '10000000-0000-0000-0000-000000000002';
const backlogHigh = '10000000-0000-0000-0000-000000000003';
const monthTie = '10000000-0000-0000-0000-000000000010';
const monthOneLate = '10000000-0000-0000-0000-000000000011';
const monthOneEarly = '10000000-0000-0000-0000-000000000012';
const monthTwo = '10000000-0000-0000-0000-000000000013';
const monthThree = '10000000-0000-0000-0000-000000000014';
const childBacklog = '10000000-0000-0000-0000-000000000021';
const childMonthOne = '10000000-0000-0000-0000-000000000022';
const childMonthTwo = '10000000-0000-0000-0000-000000000023';
const otherClient = '10000000-0000-0000-0000-000000000031';
const loose = '10000000-0000-0000-0000-000000000032';

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create schema auth;
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        create table public.organization_members(organization_id uuid, user_id uuid, role text);
        create table public.tasks (
            id uuid primary key,
            organization_id uuid,
            client_id uuid,
            parent_task_id uuid references public.tasks(id),
            title text not null default 'task',
            status text not null default 'todo',
            stage text not null,
            position double precision not null,
            created_at timestamptz not null default '2026-01-01',
            category text,
            basecamp_todo_id bigint,
            recurrence jsonb,
            constraint tasks_stage_check check (stage in ('onboarding', 'month_1', 'month_2', 'month_3', 'backlog'))
        );
        insert into public.organization_members values ('${org}', '${member}', 'member');
        insert into public.tasks (id, organization_id, client_id, parent_task_id, title, stage, position) values
            ('${onboarding}', '${org}', '${clientA}', null, 'Kickoff', 'onboarding', 4),
            ('${backlogLow}', '${org}', '${clientA}', null, 'Low', 'backlog', 1),
            ('${backlogHigh}', '${org}', '${clientA}', null, 'High', 'backlog', 2.5),
            ('${monthTie}', '${org}', '${clientA}', null, 'Tie', 'month_1', 1),
            ('${monthOneLate}', '${org}', '${clientA}', null, 'Late', 'month_1', 9),
            ('${monthOneEarly}', '${org}', '${clientA}', null, 'Early', 'month_1', 1),
            ('${monthTwo}', '${org}', '${clientA}', null, 'Two', 'month_2', 1),
            ('${monthThree}', '${org}', '${clientA}', null, 'Three', 'month_3', 8),
            ('${childBacklog}', '${org}', '${clientA}', '${onboarding}', 'Child backlog', 'backlog', 2),
            ('${childMonthOne}', '${org}', '${clientA}', '${onboarding}', 'Child month 1', 'month_1', 4),
            ('${childMonthTwo}', '${org}', '${clientA}', '${onboarding}', 'Child month 2', 'month_2', 1),
            ('${otherClient}', '${org}', '${clientB}', null, 'Other', 'month_3', 4),
            ('${loose}', '${org}', null, null, 'Loose', 'month_1', 2);
    `);
    await db.exec(migration);
    return db;
}

async function positions(db: PGlite) {
    const result = await db.query<{ id: string; stage: string; position: number }>(
        'select id::text, stage, position from public.tasks order by id',
    );
    return new Map(result.rows.map(row => [row.id, { stage: row.stage, position: Number(row.position) }]));
}

test('migration 106 is mirrored and does not rewrite policies', () => {
    assert.ok(schema.includes(migration.trim()));
    assert.doesNotMatch(migration, /create policy|enable row level security|drop policy/i);
    assert.match(migration, /check \(stage in \('onboarding', 'backlog'\)\)/);
    assert.match(migration, /patch\.stage not in \('onboarding', 'backlog'\)/);
});

test('month stages append to backlog in month order and a second run does not renumber', async () => {
    const db = await database();
    try {
        const rows = await positions(db);
        const at = (id: string) => rows.get(id);

        assert.deepEqual(at(onboarding), { stage: 'onboarding', position: 4 });
        assert.deepEqual(at(backlogLow), { stage: 'backlog', position: 1 });
        assert.deepEqual(at(backlogHigh), { stage: 'backlog', position: 2.5 });
        assert.deepEqual(at(monthTie), { stage: 'backlog', position: 3.5 });
        assert.deepEqual(at(monthOneEarly), { stage: 'backlog', position: 4.5 });
        assert.deepEqual(at(monthOneLate), { stage: 'backlog', position: 5.5 });
        assert.deepEqual(at(monthTwo), { stage: 'backlog', position: 6.5 });
        assert.deepEqual(at(monthThree), { stage: 'backlog', position: 7.5 });

        assert.deepEqual(at(childBacklog), { stage: 'backlog', position: 2 });
        assert.deepEqual(at(childMonthOne), { stage: 'backlog', position: 3 });
        assert.deepEqual(at(childMonthTwo), { stage: 'backlog', position: 4 });

        assert.deepEqual(at(otherClient), { stage: 'backlog', position: 1 });
        assert.deepEqual(at(loose), { stage: 'backlog', position: 1 });

        await db.query(`update public.tasks set position = 42 where id = '${backlogLow}'`);
        await db.exec(migration);
        const again = await positions(db);
        assert.equal(again.get(backlogLow)?.position, 42);
        assert.equal(again.get(monthTie)?.position, 3.5);
        assert.equal(again.get(onboarding)?.stage, 'onboarding');

        const constraints = await db.query<{ count: number }>(
            `select count(*)::int as count from pg_constraint where conname = 'tasks_stage_check'`,
        );
        assert.equal(constraints.rows[0].count, 1);
        await assert.rejects(
            db.query(`update public.tasks set stage = 'month_1' where id = '${backlogLow}'`),
            /tasks_stage_check/,
        );
        await db.query(`update public.tasks set stage = 'onboarding' where id = '${backlogLow}'`);
        await assert.rejects(
            db.query(`insert into public.tasks (id, organization_id, client_id, title, stage, position)
                values ('10000000-0000-0000-0000-000000000099', '${org}', '${clientA}', 'Nope', 'month_2', 1)`),
            /tasks_stage_check/,
        );
    } finally {
        await db.close();
    }
});

test('reorder_stage_tasks rejects a month stage and still moves backlog', async () => {
    const db = await database();
    try {
        await db.exec(`select set_config('request.jwt.claim.sub', '${member}', false)`);
        const before = await positions(db);
        const monthPatch = JSON.stringify([
            { id: backlogLow, stage: 'month_1', position: 1, parent_task_id: null },
        ]).replace(/'/g, "''");
        await assert.rejects(
            db.query(`select public.reorder_stage_tasks('${org}', '${clientA}', '${monthPatch}'::jsonb)`),
            /Choose a task to move/,
        );
        assert.equal((await positions(db)).get(backlogLow)?.stage, before.get(backlogLow)?.stage);

        const movePatch = JSON.stringify([
            { id: monthTie, stage: 'onboarding', position: 1, parent_task_id: null },
            { id: onboarding, stage: 'onboarding', position: 2, parent_task_id: null },
        ]).replace(/'/g, "''");
        await db.query(`select public.reorder_stage_tasks('${org}', '${clientA}', '${movePatch}'::jsonb)`);
        const moved = await positions(db);
        assert.deepEqual(moved.get(monthTie), { stage: 'onboarding', position: 1 });
        assert.deepEqual(moved.get(onboarding), { stage: 'onboarding', position: 2 });

        const source = await db.query<{ prosrc: string }>(
            `select prosrc from pg_proc where proname = 'reorder_stage_tasks'`,
        );
        assert.match(source.rows[0].prosrc, /onboarding', 'backlog'/);
        assert.doesNotMatch(source.rows[0].prosrc, /month_1/);
    } finally {
        await db.close();
    }
});
