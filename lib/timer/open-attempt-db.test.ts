import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/112_resume_open_task_timer.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const actor = '00000000-0000-0000-0000-000000000001';
const org = '00000000-0000-0000-0000-000000000010';
const task = '00000000-0000-0000-0000-000000000020';
const child = '00000000-0000-0000-0000-000000000022';
const other = '00000000-0000-0000-0000-000000000021';
const eventId = '00000000-0000-0000-0000-000000000030';
const event2 = '00000000-0000-0000-0000-000000000031';
// 23:07:27 PDT on Oct 19 is the next UTC date. This is the Floor Co Design entry.
const startedAt = '2026-10-20T06:07:27.000Z';
const switchedAt = '2026-10-20T06:07:34.586Z';
const zone = 'America/Los_Angeles';

function legacyFunction(name: string): string {
    const sql = readFileSync(new URL('../../migrations/033_planner_time_segments.sql', import.meta.url), 'utf8');
    const start = sql.indexOf(`create or replace function public.${name}(`);
    const end = sql.indexOf('$$;', start);
    assert.ok(start >= 0 && end > start, name);
    return sql.slice(start, end + 3);
}

async function database(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(`
        create role authenticated;
        create role anon;
        create schema auth;
        create function auth.uid() returns uuid language sql as $$
          select nullif(current_setting('test.actor', true), '')::uuid
        $$;
        create table public.organization_members (organization_id uuid, user_id uuid);
        create table public.clients (id uuid primary key, organization_id uuid);
        create table public.projects (id uuid primary key, organization_id uuid, client_id uuid);
        create table public.tasks (
            id uuid primary key,
            organization_id uuid,
            client_id uuid,
            project_id uuid,
            title text,
            status text,
            assignee_id uuid,
            assignee_ids uuid[] default '{}',
            start_date timestamptz,
            scheduled_minutes integer,
            category text,
            status_history jsonb
        );
        create table public.planner_events (
            id uuid primary key,
            organization_id uuid,
            user_id uuid,
            task_id uuid,
            starts_at timestamptz,
            ends_at timestamptz,
            kind text,
            all_day boolean default false
        );
        create table public.time_logs (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid,
            client_id uuid,
            project_id uuid,
            task_id uuid,
            user_id uuid,
            date date,
            hours numeric,
            description text,
            billable boolean,
            counts_toward_budget boolean,
            status text,
            timer_started_at timestamptz,
            elapsed_seconds integer,
            category text,
            planned_starts_at timestamptz,
            planned_minutes integer,
            planner_event_id uuid,
            reviewing_at timestamptz,
            created_at timestamptz not null default now()
        );
        create table public.time_log_segments (
            id uuid primary key default gen_random_uuid(),
            time_log_id uuid,
            organization_id uuid,
            user_id uuid,
            started_at timestamptz not null,
            ended_at timestamptz,
            constraint time_log_segments_positive check (ended_at is null or ended_at > started_at)
        );
        create unique index one_open_time_segment_per_user
          on public.time_log_segments (organization_id, user_id)
          where ended_at is null;
        create function public.resolve_time_tracking_task_id(p_task_id uuid)
        returns uuid language sql stable as $$
          select case
            when p_task_id = '${child}'::uuid then '${task}'::uuid
            else p_task_id
          end
        $$;
        create function public.note_timer_started_on_task(
          p_task_id uuid, p_started_at timestamptz, p_actor_id uuid
        ) returns void language plpgsql as $$
        begin
          update public.tasks set status = 'in_progress'
          where id = p_task_id and status = 'todo';
        end $$;
        insert into public.organization_members values ('${org}', '${actor}');
        insert into public.tasks (
            id, organization_id, title, status, assignee_id, assignee_ids, start_date, scheduled_minutes
        ) values
          ('${task}', '${org}', 'SEO Setup', 'todo', '${actor}', array['${actor}'::uuid],
           '2026-10-19T17:00:00Z', 90),
          ('${other}', '${org}', 'Research', 'in_progress', '${actor}', array['${actor}'::uuid],
           '2026-10-19T18:00:00Z', 45);
        insert into public.planner_events (
            id, organization_id, user_id, task_id, starts_at, ends_at, kind
        ) values
          ('${eventId}', '${org}', '${actor}', '${task}', '2026-10-19T23:00:00Z', '2026-10-20T00:00:00Z', 'focus'),
          ('${event2}', '${org}', '${actor}', '${task}', '2026-10-20T00:00:00Z', '2026-10-20T01:00:00Z', 'focus');
        select set_config('test.actor', '${actor}', false);
    `);
    await db.exec(legacyFunction('pause_time_attempt'));
    await db.exec(legacyFunction('resume_time_attempt'));
    await db.exec(migration);
    return db;
}

interface LogRow {
    id: string;
    task_id: string;
    date: string;
    timer_started_at: string | null;
    status: string;
    planner_event_id: string | null;
}

function dateKey(value: unknown): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value));
    return match ? match[1] : String(value);
}

async function logs(db: PGlite): Promise<LogRow[]> {
    const result = await db.query<LogRow>(
        `select id, task_id, date::text as date, timer_started_at::text as timer_started_at,
                status, planner_event_id
         from public.time_logs order by created_at, id`,
    );
    return result.rows;
}

async function openSegments(db: PGlite, timeLogId: string): Promise<number> {
    const result = await db.query<{ count: number }>(
        `select count(*)::int as count from public.time_log_segments
         where time_log_id = $1 and ended_at is null`,
        [timeLogId],
    );
    return result.rows[0].count;
}

function start(db: PGlite, taskId: string, at: string, timeZone: string | null) {
    if (timeZone === null) {
        return db.query<LogRow>('select * from public.start_task_timer($1, $2)', [taskId, at]);
    }
    return db.query<LogRow>(
        'select * from public.start_task_timer($1, $2, $3)',
        [taskId, at, timeZone],
    );
}

test('migration 112 is mirrored and does not delete stored time', () => {
    assert.equal(schema.includes(migration.trim()), true);
    assert.match(migration, /p_started_at at time zone v_time_zone/);
    assert.match(migration, /time attempt is in review/);
    assert.match(migration, /notify pgrst, 'reload schema'/);
    assert.doesNotMatch(migration, /delete from|drop table|drop column/i);
    for (const name of ['pause_time_attempt', 'resume_time_attempt', 'begin_stop_review', 'finalize_time_attempt', 'start_task_timer_attempt', 'switch_time_attempt']) {
        const start = migration.indexOf(`create or replace function public.${name}(`);
        const body = migration.slice(start, migration.indexOf('$$;', start));
        const advisory = body.search(/pg_advisory_xact_lock/);
        let rowLock = -1;
        let searchFrom = 0;
        while (searchFrom < body.length) {
            const fromAt = body.indexOf('from public.time_logs', searchFrom);
            if (fromAt < 0) break;
            const tail = body.slice(fromAt);
            const forUpdate = tail.search(/for update/i);
            const statementEnd = tail.indexOf(';');
            if (forUpdate >= 0 && statementEnd > forUpdate) {
                rowLock = fromAt + forUpdate;
                break;
            }
            searchFrom = fromAt + 1;
        }
        assert.ok(advisory >= 0 && rowLock > advisory, `${name} locks the user before the open row`);
    }
});

test('starting a paused task resumes it and stores the local date', async () => {
    const db = await database();
    try {
        const first = (await start(db, task, startedAt, zone)).rows[0];
        assert.equal(dateKey(first.date), '2026-10-19');
        assert.equal((await db.query<{ status: string }>('select status from public.tasks where id = $1', [task])).rows[0].status, 'in_progress');
        assert.equal((await db.query<{ scheduled_minutes: number | null }>(
            'select scheduled_minutes from public.tasks where id = $1',
            [task],
        )).rows[0].scheduled_minutes, null);

        await db.query('select * from public.pause_time_attempt($1, $2)', [first.id, switchedAt]);
        await db.exec(`update public.tasks set start_date = '2026-10-21T17:00:00Z', scheduled_minutes = 45 where id = '${task}'`);

        const resumed = (await start(db, task, '2026-10-20T06:10:00.000Z', zone)).rows[0];
        const rows = await logs(db);
        assert.equal(rows.length, 1);
        assert.equal(resumed.id, first.id);
        assert.equal(dateKey(rows[0].date), '2026-10-19');
        assert.ok(rows[0].timer_started_at);
        assert.equal(await openSegments(db, first.id), 1);
        assert.equal((await db.query<{ count: number }>(
            'select count(*)::int as count from public.time_log_segments where time_log_id = $1',
            [first.id],
        )).rows[0].count, 2);
        assert.equal((await db.query<{ scheduled_minutes: number }>(
            'select scheduled_minutes from public.tasks where id = $1',
            [task],
        )).rows[0].scheduled_minutes, 45);
    } finally {
        await db.close();
    }
});

test('starting the running task is a no-op, including a switch to that same task', async () => {
    const db = await database();
    try {
        const first = (await start(db, task, startedAt, zone)).rows[0];
        await db.exec(`update public.tasks set start_date = '2026-10-21T17:00:00Z', scheduled_minutes = 30 where id = '${task}'`);

        const again = (await start(db, task, switchedAt, zone)).rows[0];
        assert.equal(again.id, first.id);
        assert.equal((await logs(db)).length, 1);
        assert.equal(await openSegments(db, first.id), 1);
        assert.equal((await db.query<{ timer_started_at: string }>(
            'select timer_started_at::text as timer_started_at from public.time_logs where id = $1',
            [first.id],
        )).rows[0].timer_started_at.slice(0, 19), '2026-10-20 06:07:27');
        assert.equal((await db.query<{ scheduled_minutes: number }>(
            'select scheduled_minutes from public.tasks where id = $1',
            [task],
        )).rows[0].scheduled_minutes, 30);

        const switched = await db.query<{ id: string }>(
            'select id from public.switch_time_attempt($1, null, $2, $3, $4)',
            [first.id, task, switchedAt, zone],
        );
        assert.deepEqual(switched.rows.map(row => row.id), [first.id]);
        assert.equal(await openSegments(db, first.id), 1);

        const viaChild = await db.query<{ id: string }>(
            'select id from public.switch_time_attempt($1, null, $2, $3, $4)',
            [first.id, child, '2026-10-20T06:08:00.000Z', zone],
        );
        assert.deepEqual(viaChild.rows.map(row => row.id), [first.id]);
        assert.equal((await logs(db)).length, 1);
    } finally {
        await db.close();
    }
});

test('switching to another task reuses that task\'s paused attempt', async () => {
    const db = await database();
    try {
        const setup = (await start(db, task, startedAt, zone)).rows[0];
        await db.query('select * from public.pause_time_attempt($1, $2)', [setup.id, switchedAt]);
        const research = (await start(db, other, '2026-10-20T06:08:00.000Z', zone)).rows[0];

        const switched = await db.query<{ id: string; timer_started_at: string | null }>(
            'select id, timer_started_at::text as timer_started_at from public.switch_time_attempt($1, null, $2, $3, $4)',
            [research.id, task, '2026-10-20T06:09:00.000Z', zone],
        );
        assert.deepEqual(switched.rows.map(row => row.id), [research.id, setup.id]);
        const rows = await logs(db);
        assert.equal(rows.length, 2);
        const setupRow = rows.find(row => row.id === setup.id);
        const researchRow = rows.find(row => row.id === research.id);
        assert.ok(setupRow?.timer_started_at);
        assert.equal(researchRow?.timer_started_at, null);
        assert.equal(dateKey(setupRow?.date), '2026-10-19');
    } finally {
        await db.close();
    }
});

test('a later stray paused attempt is the one start resumes', async () => {
    const db = await database();
    try {
        await db.exec(`
            insert into public.time_logs (
                id, organization_id, task_id, user_id, date, hours, description, billable,
                counts_toward_budget, status, timer_started_at, elapsed_seconds, created_at
            ) values
              ('00000000-0000-0000-0000-0000000000a1', '${org}', '${task}', '${actor}',
               '2026-10-20', 0, 'SEO Setup', true, false, 'in_progress', null, 0,
               '2026-10-20T06:07:27Z'),
              ('00000000-0000-0000-0000-0000000000a2', '${org}', '${task}', '${actor}',
               '2026-10-20', 0, 'SEO Setup', true, false, 'in_progress', null, 0,
               '2026-10-20T06:07:34Z');
            insert into public.time_log_segments (time_log_id, organization_id, user_id, started_at, ended_at)
            values
              ('00000000-0000-0000-0000-0000000000a1', '${org}', '${actor}',
               '2026-10-20T06:07:27Z', '2026-10-20T06:07:34Z'),
              ('00000000-0000-0000-0000-0000000000a2', '${org}', '${actor}',
               '2026-10-20T06:07:34Z', '2026-10-20T06:20:00Z');
        `);
        const resumed = (await start(db, task, '2026-10-20T06:21:00.000Z', zone)).rows[0];
        assert.equal(resumed.id, '00000000-0000-0000-0000-0000000000a2');
        const rows = await logs(db);
        assert.equal(rows.length, 2);
        assert.equal(rows.find(row => row.id.endsWith('a1'))?.timer_started_at, null);
        assert.ok(rows.find(row => row.id.endsWith('a2'))?.timer_started_at);
    } finally {
        await db.close();
    }
});

test('a task whose only open attempt is in review does not gain another row', async () => {
    const db = await database();
    try {
        const first = (await start(db, task, startedAt, zone)).rows[0];
        await db.query('select * from public.pause_time_attempt($1, $2)', [first.id, switchedAt]);
        await db.exec(`update public.time_logs set reviewing_at = '${switchedAt}' where id = '${first.id}'`);
        await assert.rejects(
            start(db, task, '2026-10-20T06:10:00.000Z', zone),
            /time attempt is in review/,
        );
        assert.equal((await logs(db)).length, 1);
    } finally {
        await db.close();
    }
});

test('callers without a timezone still reuse an open attempt and store the UTC date', async () => {
    const db = await database();
    try {
        const first = (await start(db, task, startedAt, null)).rows[0];
        assert.equal(dateKey(first.date), '2026-10-20');
        await db.query('select * from public.pause_time_attempt($1, $2)', [first.id, switchedAt]);
        const resumed = (await start(db, task, '2026-10-20T06:10:00.000Z', null)).rows[0];
        assert.equal(resumed.id, first.id);
        assert.equal((await logs(db)).length, 1);
        await assert.rejects(
            start(db, other, startedAt, 'Mars/Olympus'),
            /invalid time zone/,
        );
    } finally {
        await db.close();
    }
});

test('a planner block stays its own log and keeps the task forecast', async () => {
    const db = await database();
    try {
        const paused = (await start(db, task, startedAt, zone)).rows[0];
        await db.query('select * from public.pause_time_attempt($1, $2)', [paused.id, switchedAt]);
        await db.exec(`update public.tasks set start_date = '2026-10-19T17:00:00Z', scheduled_minutes = 90 where id = '${task}'`);

        const block = (await db.query<LogRow>(
            'select * from public.start_planner_task_session($1, $2, $3, null, $4)',
            [task, eventId, '2026-10-20T06:10:00.000Z', zone],
        )).rows[0];
        assert.notEqual(block.id, paused.id);
        assert.equal(block.planner_event_id, eventId);
        assert.equal(dateKey(block.date), '2026-10-19');
        assert.equal((await logs(db)).length, 2);
        assert.equal((await db.query<{ scheduled_minutes: number; start_date: string }>(
            'select scheduled_minutes, start_date::text as start_date from public.tasks where id = $1',
            [task],
        )).rows[0].scheduled_minutes, 90);

        const second = (await db.query<LogRow>(
            'select * from public.start_planner_task_session($1, $2, $3, $4, $5)',
            [task, event2, '2026-10-20T06:40:00.000Z', block.id, zone],
        )).rows[0];
        assert.notEqual(second.id, block.id);
        assert.equal(second.planner_event_id, event2);
        assert.equal((await logs(db)).length, 3);
        assert.equal((await db.query<{ timer_started_at: string | null }>(
            'select timer_started_at::text as timer_started_at from public.time_logs where id = $1',
            [block.id],
        )).rows[0].timer_started_at, null);
    } finally {
        await db.close();
    }
});

test('an exact switch retry does not create a third attempt', async () => {
    const db = await database();
    try {
        const setup = (await start(db, task, startedAt, zone)).rows[0];
        await db.query(
            'select * from public.switch_time_attempt($1, null, $2, $3, $4)',
            [setup.id, other, switchedAt, zone],
        );
        await db.query(
            'select * from public.switch_time_attempt($1, null, $2, $3, $4)',
            [setup.id, other, switchedAt, zone],
        );
        const rows = await logs(db);
        assert.equal(rows.length, 2);
        assert.equal(rows.filter(row => row.task_id === other).length, 1);
        assert.equal(await openSegments(db, rows.find(row => row.task_id === other)!.id), 1);
    } finally {
        await db.close();
    }
});

test('authenticated callers cannot pass the planner-only reuse flag', async () => {
    const db = await database();
    try {
        await db.exec('set role authenticated');
        await assert.rejects(
            db.query(
                'select * from public.start_task_timer_attempt($1, $2, $3, false)',
                [task, startedAt, zone],
            ),
            /permission denied/,
        );
        const allowed = await start(db, task, startedAt, zone);
        assert.equal(dateKey(allowed.rows[0].date), '2026-10-19');
        await db.exec('set role anon');
        await assert.rejects(
            start(db, task, startedAt, zone),
            /permission denied/,
        );
    } finally {
        await db.close();
    }
});
