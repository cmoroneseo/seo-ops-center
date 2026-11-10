import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/123_plan_phase_stages.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '00000000-0000-0000-0000-000000000010';
const member = '00000000-0000-0000-0000-000000000002';
const client = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const onboarding = '10000000-0000-0000-0000-000000000001';
const backlog = '10000000-0000-0000-0000-000000000002';
const month = '10000000-0000-0000-0000-000000000003';

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
        insert into public.tasks (id, organization_id, client_id, title, stage, position) values
            ('${onboarding}', '${org}', '${client}', 'Kickoff', 'onboarding', 1),
            ('${backlog}', '${org}', '${client}', 'Later', 'backlog', 4),
            ('${month}', '${org}', '${client}', 'First month crawl', 'month_1', 2);
    `);
    await db.exec(migration);
    return db;
}

async function rows(db: PGlite) {
    const result = await db.query<{ id: string; stage: string; position: number }>(
        'select id::text, stage, position from public.tasks order by id',
    );
    return result.rows;
}

test('migration 123 is mirrored, allows phases, and does not rewrite rows', async () => {
    assert.ok(schema.includes(migration.trim()));
    assert.doesNotMatch(migration, /create policy|enable row level security|drop policy/i);
    assert.doesNotMatch(migration, /set stage = 'backlog'/);
    assert.match(migration, /foundation', 'growth', 'scale'/);

    const db = await database();
    try {
        assert.deepEqual(await rows(db), [
            { id: onboarding, stage: 'onboarding', position: 1 },
            { id: backlog, stage: 'backlog', position: 4 },
            { id: month, stage: 'month_1', position: 2 },
        ]);
        await db.exec(migration);
        assert.deepEqual(await rows(db), [
            { id: onboarding, stage: 'onboarding', position: 1 },
            { id: backlog, stage: 'backlog', position: 4 },
            { id: month, stage: 'month_1', position: 2 },
        ]);

        await db.query(`insert into public.tasks (id, organization_id, client_id, title, stage, position)
            values ('10000000-0000-0000-0000-000000000099', '${org}', '${client}', 'Trust the site', 'foundation', 1)`);
        await db.exec(`select set_config('request.jwt.claim.sub', '${member}', false)`);
        const payload = JSON.stringify([
            { id: backlog, stage: 'growth', position: 1, parent_task_id: null },
        ]).replace(/'/g, "''");
        await db.query(`select public.reorder_stage_tasks('${org}', '${client}', '${payload}'::jsonb)`);
        const after = await rows(db);
        assert.equal(after.find(row => row.id === backlog)?.stage, 'growth');
        assert.equal(after.find(row => row.id === month)?.stage, 'month_1');
        assert.equal(after.find(row => row.id === onboarding)?.stage, 'onboarding');
    } finally {
        await db.close();
    }
});
