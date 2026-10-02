import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/068_planner_task_sessions.sql', import.meta.url), 'utf8');
const actor = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const org = '00000000-0000-0000-0000-000000000010';
const taskId = '00000000-0000-0000-0000-000000000020';
const task2 = '00000000-0000-0000-0000-000000000021';
const eventId = '00000000-0000-0000-0000-000000000030';
const event2 = '00000000-0000-0000-0000-000000000031';

function legacyFunction(name: string): string {
    const sql = readFileSync(new URL('../../migrations/033_planner_time_segments.sql', import.meta.url), 'utf8');
    const start = sql.indexOf(`create or replace function public.${name}(`);
    const end = sql.indexOf('$$;', start);
    assert.ok(start >= 0 && end > start);
    return sql.slice(start, end + 3);
}

test('session timer RPC preserves independent blocks, validates ownership, and switches atomically using the real legacy timer functions', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create role authenticated; create role anon;
            create schema auth;
            create function auth.uid() returns uuid language sql as
              $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
            grant usage on schema auth to authenticated, anon;
            create table organization_members (organization_id uuid, user_id uuid);
            create table clients (id uuid primary key, organization_id uuid);
            create table projects (id uuid primary key, organization_id uuid, client_id uuid);
            create table tasks (
                id uuid primary key, organization_id uuid, client_id uuid, project_id uuid,
                title text, status text, assignee_id uuid, assignee_ids uuid[] default '{}',
                start_date timestamptz, scheduled_minutes integer, category text
            );
            create table planner_events (
                id uuid primary key, organization_id uuid, user_id uuid, task_id uuid,
                starts_at timestamptz, ends_at timestamptz, kind text, all_day boolean default false
            );
            create table time_logs (
                id uuid primary key default gen_random_uuid(), organization_id uuid, client_id uuid,
                project_id uuid, task_id uuid, user_id uuid, date date, hours numeric, description text,
                billable boolean, counts_toward_budget boolean, status text, timer_started_at timestamptz,
                elapsed_seconds integer, category text, planned_starts_at timestamptz,
                planned_minutes integer, planner_event_id uuid, reviewing_at timestamptz,
                created_at timestamptz default now()
            );
            create unique index one_running on time_logs (organization_id, user_id)
              where status = 'in_progress' and timer_started_at is not null;
            create table time_log_segments (
                id uuid primary key default gen_random_uuid(), time_log_id uuid, organization_id uuid,
                user_id uuid, started_at timestamptz, ended_at timestamptz
            );
            insert into organization_members values ('${org}', '${actor}');
            insert into tasks (id, organization_id, title, status, assignee_ids, start_date, scheduled_minutes)
              values ('${taskId}', '${org}', 'Roadmap', 'in_progress', array['${actor}'::uuid], '2026-09-30T17:00Z', 90),
              ('${task2}', '${org}', 'Research', 'todo', array['${other}'::uuid], '2026-10-04T17:00Z', 45);
            insert into planner_events (id, organization_id, user_id, task_id, starts_at, ends_at, kind)
              values ('${eventId}', '${org}', '${actor}', '${taskId}', '2026-10-02T17:00Z', '2026-10-02T18:00Z', 'focus'),
              ('${event2}', '${org}', '${actor}', '${task2}', '2026-10-02T18:00Z', '2026-10-02T18:30Z', 'focus');
            set test.actor = '${actor}';
        `);
        await db.exec(readFileSync(new URL('../../migrations/034_start_timer_without_project.sql', import.meta.url), 'utf8'));
        await db.exec(legacyFunction('pause_time_attempt'));
        await db.exec(legacyFunction('switch_time_attempt'));
        await db.exec(migration);
        const start = (task: string, event: string, from: string | null = null) => db.query<{
            id: string; task_id: string; planner_event_id: string; planned_minutes: number;
        }>('select * from start_planner_task_session($1, $2, $3, $4)', [task, event, '2026-10-02T17:15:00Z', from]);

        await assert.rejects(start(taskId, event2), /session is outside/);
        await db.exec(`update planner_events set user_id='${other}' where id='${eventId}'`);
        await assert.rejects(start(taskId, eventId), /session is outside/);
        await db.exec(`update planner_events set user_id='${actor}' where id='${eventId}'; update tasks set status='done' where id='${taskId}'`);
        await assert.rejects(start(taskId, eventId), /completed tasks/);
        await db.exec(`update tasks set status='in_progress' where id='${taskId}'`);
        const first = (await start(taskId, eventId)).rows[0];
        assert.equal(first.task_id, taskId);
        assert.equal(first.planner_event_id, eventId);
        assert.equal(first.planned_minutes, 60);
        assert.equal((await db.query<{ scheduled_minutes: number }>('select scheduled_minutes from tasks where id=$1', [taskId])).rows[0].scheduled_minutes, 90);
        assert.equal((await db.query<{ start_date: Date }>('select start_date from tasks where id=$1', [taskId])).rows[0].start_date.toISOString(), '2026-09-30T17:00:00.000Z');
        await assert.rejects(start(taskId, eventId), /already has tracked time/);

        await assert.rejects(db.query('select * from start_planner_task_session($1,$2,$3,$4)', [task2,event2,'2026-10-02T18:00Z',first.id]), /assigned to another/);
        // A failure inside the legacy starter rolls the previous pause back.
        await db.exec(`update tasks set assignee_ids=array['${actor}'::uuid], project_id='00000000-0000-0000-0000-000000000099' where id='${task2}'`);
        await assert.rejects(db.query('select * from start_planner_task_session($1,$2,$3,$4)', [task2,event2,'2026-10-02T18:00Z',first.id]), /task project is outside/);
        assert.ok((await db.query('select timer_started_at from time_logs where id=$1', [first.id])).rows[0].timer_started_at);
        assert.equal((await db.query('select ended_at from time_log_segments where time_log_id=$1', [first.id])).rows[0].ended_at, null);
        await db.exec(`update tasks set project_id=null where id='${task2}'`);
        const second = (await db.query<{id: string; planner_event_id: string; task_id: string}>(
            'select * from start_planner_task_session($1,$2,$3,$4)', [task2,event2,'2026-10-02T18:00Z',first.id],
        )).rows[0];
        assert.equal(second.task_id, task2);
        assert.equal(second.planner_event_id, event2);
        assert.notEqual(second.id, first.id, 'switch must snapshot the new attempt, not the paused row');
        assert.equal((await db.query('select timer_started_at from time_logs where id=$1', [first.id])).rows[0].timer_started_at, null);
        assert.equal((await db.query('select count(*)::int as count from planner_events')).rows[0].count, 2);
        assert.equal((await db.query('select scheduled_minutes from tasks where id=$1', [task2])).rows[0].scheduled_minutes, 45);
        await db.exec('set role anon');
        await assert.rejects(start(taskId, eventId), /permission denied/);
    } finally {
        await db.close();
    }
});

test('schema snapshot includes the session timer RPC migration', () => {
    assert.ok(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').includes(migration.trim()));
});
