import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/111_plan_basecamp_sync_state.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('migration 111 records one sync attempt and keeps it off the browser', () => {
    for (const needle of [
        'basecamp_sync_state',
        'basecamp_sync_error',
        'basecamp_sync_attempted_at',
        'basecamp_plan_sync_state',
        'tasks_basecamp_sync_failed_idx',
        'protect_task_basecamp_sync_state',
        'protect_client_basecamp_plan_sync',
        "auth.role() = 'service_role'",
        'task Basecamp sync state is server-controlled',
        "basecamp_sync_state in ('ok', 'failed')",
    ]) {
        assert.equal(migration.includes(needle), true, needle);
    }
    const sql = migration.replace(/--.*$/gm, '');
    assert.equal(sql.includes('updated_at'), false);
    assert.equal(schema.includes('protect_task_basecamp_sync_state'), true);
    assert.equal(schema.includes('protect_client_basecamp_plan_sync'), true);
});

test('the sync columns apply on the current tasks shape, which has no updated_at', async () => {
    const db = new PGlite();
    await db.exec(`
        create schema auth;
        create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
        create table public.tasks (
            id uuid primary key,
            title text not null,
            stage text,
            due_date date,
            basecamp_todo_id bigint
        );
        create table public.clients (
            id uuid primary key,
            name text not null
        );
    `);
    await db.exec(migration);
    const columns = await db.query<{ column_name: string }>(`
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'tasks'
          and column_name in ('basecamp_sync_state', 'basecamp_sync_error', 'basecamp_sync_attempted_at', 'updated_at')
        order by column_name
    `);
    assert.deepEqual(columns.rows.map(row => row.column_name), [
        'basecamp_sync_attempted_at',
        'basecamp_sync_error',
        'basecamp_sync_state',
    ]);
    await db.exec(`
        insert into public.tasks (id, title, stage) values
          ('00000000-0000-0000-0000-000000000001', 'Blog', 'backlog');
        update public.tasks
           set basecamp_sync_state = 'failed',
               basecamp_sync_error = 'Basecamp returned 404.',
               basecamp_sync_attempted_at = '2026-10-20T18:14:00Z'
         where id = '00000000-0000-0000-0000-000000000001';
    `);
    const failed = await db.query(`select basecamp_sync_state from public.tasks`);
    assert.equal(failed.rows[0].basecamp_sync_state, 'failed');
    await assert.rejects(
        () => db.exec(`update public.tasks set basecamp_sync_state = 'pending'`),
        /tasks_basecamp_sync_state_check/,
    );
});
