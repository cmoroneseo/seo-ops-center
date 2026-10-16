import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/104_reorder_stage_tasks.sql', import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000010';
const otherOrg = '00000000-0000-0000-0000-000000000011';
const member = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const outsider = '00000000-0000-0000-0000-000000000004';
const client = '00000000-0000-0000-0000-000000000020';
const otherClient = '00000000-0000-0000-0000-000000000021';
const setup = '00000000-0000-0000-0000-000000000101';
const keywords = '00000000-0000-0000-0000-000000000102';
const roadmap = '00000000-0000-0000-0000-000000000103';
const foreign = '00000000-0000-0000-0000-000000000104';

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create schema auth;
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        create table organization_members(organization_id uuid, user_id uuid, role text);
        create table tasks (
            id uuid primary key,
            organization_id uuid not null,
            client_id uuid,
            title text not null,
            status text not null default 'todo',
            stage text not null default 'backlog',
            position double precision not null default 0,
            parent_task_id uuid references tasks(id),
            created_at timestamptz not null default '2026-01-01T00:00:00Z',
            category text,
            basecamp_todo_id bigint,
            recurrence jsonb
        );
        insert into organization_members values
            ('${org}', '${member}', 'member'),
            ('${org}', '${viewer}', 'viewer'),
            ('${otherOrg}', '${outsider}', 'member');
        insert into tasks (id, organization_id, client_id, title, stage, position, parent_task_id) values
            ('${setup}', '${org}', '${client}', 'SEO Setup', 'onboarding', 1, null),
            ('${keywords}', '${org}', '${client}', 'Add keywords', 'onboarding', 1, '${setup}'),
            ('${roadmap}', '${org}', '${client}', 'Create SEO Roadmap', 'onboarding', 2, null),
            ('${foreign}', '${org}', '${otherClient}', 'Other client', 'onboarding', 1, null);
    `);
    await db.exec(migration);
    return db;
}

async function actAs(db: PGlite, userId: string | null) {
    await db.exec(`select set_config('request.jwt.claim.sub', '${userId ?? ''}', false)`);
}

function patch(rows: { id: string; stage: string; position: number; parent_task_id: string | null }[]) {
    return JSON.stringify(rows).replace(/'/g, "''");
}

async function positions(db: PGlite) {
    const result = await db.query<{ id: string; stage: string; position: number; parent_task_id: string | null }>(
        `select id::text, stage, position, parent_task_id::text from tasks order by id`,
    );
    return result.rows;
}

test('a member move rewrites the pillar and its subtask together', async () => {
    const db = await database();
    try {
        await actAs(db, member);
        const payload = patch([
            { id: setup, stage: 'month_2', position: 1, parent_task_id: null },
            { id: keywords, stage: 'month_2', position: 1, parent_task_id: setup },
            { id: roadmap, stage: 'onboarding', position: 1, parent_task_id: null },
        ]);
        const result = await db.query<{ reorder_stage_tasks: { id: string; stage: string }[] }>(
            `select reorder_stage_tasks('${org}', '${client}', '${payload}'::jsonb) as reorder_stage_tasks`,
        );
        const returned = result.rows[0].reorder_stage_tasks;
        assert.equal(returned.length, 3);
        const rows = await positions(db);
        assert.deepEqual(rows.find(row => row.id === setup), {
            id: setup,
            stage: 'month_2',
            position: 1,
            parent_task_id: null,
        });
        assert.equal(rows.find(row => row.id === keywords)?.stage, 'month_2');
        assert.equal(rows.find(row => row.id === keywords)?.parent_task_id, setup);
        assert.equal(rows.find(row => row.id === roadmap)?.position, 1);
        assert.equal(rows.find(row => row.id === foreign)?.stage, 'onboarding');
    } finally {
        await db.close();
    }
});

test('a nesting violation rolls back every row in the call', async () => {
    const db = await database();
    try {
        await actAs(db, member);
        const before = await positions(db);
        const payload = patch([
            { id: setup, stage: 'month_1', position: 1, parent_task_id: roadmap },
            { id: roadmap, stage: 'month_1', position: 2, parent_task_id: null },
        ]);
        await assert.rejects(
            db.query(`select reorder_stage_tasks('${org}', '${client}', '${payload}'::jsonb)`),
            /one level deep/i,
        );
        assert.deepEqual(await positions(db), before);
    } finally {
        await db.close();
    }
});

test('a missing sibling rolls back and does not update the rows that matched', async () => {
    const db = await database();
    try {
        await actAs(db, member);
        const before = await positions(db);
        const payload = patch([
            { id: roadmap, stage: 'backlog', position: 1, parent_task_id: null },
            { id: foreign, stage: 'backlog', position: 2, parent_task_id: null },
        ]);
        await assert.rejects(
            db.query(`select reorder_stage_tasks('${org}', '${client}', '${payload}'::jsonb)`),
            /Not found/,
        );
        assert.deepEqual(await positions(db), before);
    } finally {
        await db.close();
    }
});

test('viewers, outsiders, and a signed-out session cannot move tasks', async () => {
    const db = await database();
    try {
        const payload = patch([
            { id: roadmap, stage: 'backlog', position: 1, parent_task_id: null },
        ]);
        const before = await positions(db);
        for (const userId of [viewer, outsider, null]) {
            await actAs(db, userId);
            await assert.rejects(
                db.query(`select reorder_stage_tasks('${org}', '${client}', '${payload}'::jsonb)`),
                /Forbidden|Authentication is required/,
            );
        }
        assert.deepEqual(await positions(db), before);
    } finally {
        await db.close();
    }
});

test('schema snapshot mirrors the reorder function', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.ok(schema.includes(migration.trim()));
    assert.match(schema, /create or replace function public\.reorder_stage_tasks\(\s*p_organization_id uuid/i);
    assert.match(schema, /revoke all on function public\.reorder_stage_tasks\(uuid, uuid, jsonb\) from public, anon/i);
});
