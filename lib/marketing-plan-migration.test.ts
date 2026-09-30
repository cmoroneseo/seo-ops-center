import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../migrations/059_marketing_plan_execution.sql', import.meta.url), 'utf8');
test('promotion is retry safe, preserves source scope, and respects RLS', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create role authenticated;
            create schema auth;
            create function auth.uid() returns uuid language sql as $$select '00000000-0000-0000-0000-000000000001'::uuid$$;
            create table marketing_plans(id uuid primary key);
            create table tasks(id uuid primary key default gen_random_uuid(), organization_id uuid, client_id uuid, title text, description text, priority text, status text, assignee_ids uuid[], due_date date, created_by uuid, status_history jsonb);
            create table marketing_plan_items(id uuid primary key, organization_id uuid, client_id uuid, title text, description text, priority text, status text, assignee_id uuid, due_date date, task_id uuid references tasks(id), updated_at timestamptz);
            alter table marketing_plan_items enable row level security;
            alter table tasks enable row level security;
            create policy items_scope on marketing_plan_items for all to authenticated using (organization_id = '00000000-0000-0000-0000-000000000010') with check (organization_id = '00000000-0000-0000-0000-000000000010');
            create policy tasks_scope on tasks for all to authenticated using (organization_id = '00000000-0000-0000-0000-000000000010') with check (organization_id = '00000000-0000-0000-0000-000000000010');
            grant usage on schema public, auth to authenticated;
            grant select, insert, update on marketing_plan_items, tasks to authenticated;
            insert into marketing_plan_items(id, organization_id, client_id, title, priority, status) values
            ('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','Owned item','high','todo'),
            ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','Foreign item','high','todo'),
            ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','Ignored item','high','ignored');
        `);
        await db.exec(migration);
        await db.exec('set role authenticated');
        const query = "select * from create_task_from_marketing_plan_item('00000000-0000-0000-0000-000000000100')";
        const first = await db.query(query); const retry = await db.query(query);
        assert.deepEqual(retry.rows, first.rows);
        assert.equal((await db.query<{count: number}>('select count(*)::int as count from tasks')).rows[0].count, 1);
        assert.equal((first.rows[0] as {organization_id: string}).organization_id, '00000000-0000-0000-0000-000000000010');
        await assert.rejects(db.query("select create_task_from_marketing_plan_item('00000000-0000-0000-0000-000000000101')"), /unavailable/);
        await assert.rejects(db.query("select create_task_from_marketing_plan_item('00000000-0000-0000-0000-000000000102')"), /Only open/);
    } finally { await db.close(); }
    assert.ok(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').includes(migration.trim()));
});
