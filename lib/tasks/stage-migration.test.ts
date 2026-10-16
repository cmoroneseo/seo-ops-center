import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/103_task_stage_position.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const clientA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const clientB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2';

const onboardingEarly = '00000000-0000-0000-0000-000000000001';
const monthOne = '00000000-0000-0000-0000-000000000002';
const plain = '00000000-0000-0000-0000-000000000003';
const onboardingLate = '00000000-0000-0000-0000-000000000004';
const child = '00000000-0000-0000-0000-000000000005';
const grandchild = '00000000-0000-0000-0000-000000000006';
const childTie = '00000000-0000-0000-0000-000000000007';
const childOwnPhase = '00000000-0000-0000-0000-000000000008';
const otherClient = '00000000-0000-0000-0000-000000000009';
const excluded = '00000000-0000-0000-0000-00000000000a';
const childBacklogLink = '00000000-0000-0000-0000-00000000000b';

async function database() {
    const db = new PGlite();
    await db.exec(`
        create table public.tasks (
            id uuid primary key,
            client_id uuid,
            parent_task_id uuid references public.tasks(id),
            created_at timestamptz not null,
            due_date timestamptz
        );
        create table public.marketing_plan_items (
            id uuid primary key,
            task_id uuid,
            roadmap_included boolean not null,
            roadmap_phase text not null,
            sort_order int
        );
        insert into public.tasks (id, client_id, parent_task_id, created_at, due_date) values
            ('${onboardingEarly}', '${clientA}', null, '2026-01-01', '2026-02-01'),
            ('${monthOne}', '${clientA}', null, '2026-01-02', '2026-01-03'),
            ('${plain}', '${clientA}', null, '2026-01-03', '2026-01-04'),
            ('${onboardingLate}', '${clientA}', null, '2026-01-04', null),
            ('${child}', '${clientA}', '${onboardingEarly}', '2026-01-05', '2026-06-01'),
            ('${grandchild}', '${clientA}', '${child}', '2026-01-06', null),
            ('${childTie}', '${clientA}', '${onboardingEarly}', '2026-01-05', null),
            ('${childOwnPhase}', '${clientA}', '${monthOne}', '2026-01-08', null),
            ('${otherClient}', '${clientB}', null, '2026-01-01', null),
            ('${excluded}', '${clientA}', null, '2026-01-09', '2026-01-10'),
            ('${childBacklogLink}', '${clientA}', '${onboardingEarly}', '2026-01-11', null);
        insert into public.marketing_plan_items (id, task_id, roadmap_included, roadmap_phase, sort_order) values
            ('10000000-0000-0000-0000-000000000001', '${onboardingEarly}', true, 'month_3', 1),
            ('10000000-0000-0000-0000-000000000002', '${onboardingEarly}', true, 'onboarding', 9),
            ('10000000-0000-0000-0000-000000000003', '${monthOne}', true, 'month_1', 1),
            ('10000000-0000-0000-0000-000000000004', '${onboardingLate}', true, 'onboarding', 3),
            ('10000000-0000-0000-0000-000000000005', '${childOwnPhase}', true, 'month_2', 4),
            ('10000000-0000-0000-0000-000000000006', '${otherClient}', true, 'onboarding', 1),
            ('10000000-0000-0000-0000-000000000007', '${excluded}', false, 'onboarding', 0),
            ('10000000-0000-0000-0000-000000000008', '${childBacklogLink}', true, 'backlog', 2);
    `);
    await db.exec(migration);
    return db;
}

test('migration 103 is mirrored and does not read due dates or rewrite policies', () => {
    assert.ok(schema.includes(migration.trim()));
    const executable = migration.replace(/--[^\n]*/g, '');
    assert.doesNotMatch(executable, /due_date/i);
    assert.doesNotMatch(migration, /create policy|enable row level security|drop policy/i);
    assert.match(migration, /tasks_client_stage_position_idx[\s\S]*\(client_id, stage, parent_task_id, position\)/);
});

test('backfill uses the earliest included phase, then the parent, and orders each column', async () => {
    const db = await database();
    try {
        const rows = await db.query<{ id: string; stage: string; position: number }>(
            'select id, stage, position from tasks order by id',
        );
        const byId = new Map(rows.rows.map(row => [row.id, row]));
        const stage = (id: string) => byId.get(id)?.stage;
        const position = (id: string) => Number(byId.get(id)?.position);

        assert.equal(stage(onboardingEarly), 'onboarding');
        assert.equal(stage(onboardingLate), 'onboarding');
        assert.equal(position(onboardingLate), 1);
        assert.equal(position(onboardingEarly), 2);

        assert.equal(stage(monthOne), 'month_1');
        assert.equal(position(monthOne), 1);
        assert.equal(stage(childOwnPhase), 'month_2');
        assert.equal(position(childOwnPhase), 1);

        assert.equal(stage(child), 'onboarding');
        assert.equal(stage(grandchild), 'onboarding');
        assert.equal(stage(childTie), 'onboarding');
        assert.equal(position(child), 1);
        assert.equal(position(childTie), 2);
        assert.equal(position(grandchild), 1);

        assert.equal(stage(plain), 'backlog');
        assert.equal(stage(excluded), 'backlog');
        assert.equal(position(plain), 1);
        assert.equal(position(excluded), 2);
        assert.equal(stage(childBacklogLink), 'backlog');
        assert.equal(position(childBacklogLink), 1);

        assert.equal(stage(otherClient), 'onboarding');
        assert.equal(position(otherClient), 1);

        const columns = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
            `select column_name, is_nullable, column_default
             from information_schema.columns
             where table_name = 'tasks' and column_name in ('stage', 'position')
             order by column_name`,
        );
        assert.equal(columns.rows[0].column_name, 'position');
        assert.equal(columns.rows[0].is_nullable, 'NO');
        assert.match(columns.rows[0].column_default ?? '', /0/);
        assert.equal(columns.rows[1].column_name, 'stage');
        assert.equal(columns.rows[1].is_nullable, 'NO');
        assert.match(columns.rows[1].column_default ?? '', /backlog/);

        await assert.rejects(db.query(`update tasks set stage = 'month_4' where id = '${plain}'`), /tasks_stage_check/);
    } finally {
        await db.close();
    }
});

test('running the migration again keeps a later stage edit and still defaults new rows', async () => {
    const db = await database();
    try {
        await db.query(`update tasks set stage = 'month_3', position = 7.5 where id = '${plain}'`);
        await db.exec(migration);
        const kept = await db.query<{ stage: string; position: number }>(
            `select stage, position from tasks where id = '${plain}'`,
        );
        assert.equal(kept.rows[0].stage, 'month_3');
        assert.equal(Number(kept.rows[0].position), 7.5);

        const inserted = '00000000-0000-0000-0000-00000000000c';
        await db.query(
            `insert into tasks (id, client_id, created_at) values ('${inserted}', '${clientA}', '2026-03-01')`,
        );
        const created = await db.query<{ stage: string; position: number }>(
            `select stage, position from tasks where id = '${inserted}'`,
        );
        assert.equal(created.rows[0].stage, 'backlog');
        assert.equal(Number(created.rows[0].position), 0);

        const index = await db.query<{ indexdef: string }>(
            `select indexdef from pg_indexes where indexname = 'tasks_client_stage_position_idx'`,
        );
        assert.match(index.rows[0].indexdef, /\(client_id, stage, parent_task_id, "position"\)/);
    } finally {
        await db.close();
    }
});
