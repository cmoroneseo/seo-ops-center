import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

import { MIGRATED_BLOCKED_REASON, migrateLegacyTaskStatus } from './status.ts';

const migration = readFileSync(new URL('../../migrations/110_simplify_task_status.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const ORG = '11111111-1111-4111-8111-111111111111';
const DONE_AT = '2026-08-01T12:00:00.000Z';
const APPROVED_AT = '2026-09-12T16:30:00.000Z';
const UPDATED = '2026-10-02T15:00:00.000Z';
const NOW = '2026-10-19T18:00:00.000Z';

interface Seed {
    id: string;
    status: string;
    history?: { status: string; at: string }[];
    completedAt?: string | null;
    updatedAt?: string | null;
}

function id(n: number): string {
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

const seeds: Seed[] = [
    { id: id(1), status: 'todo' },
    { id: id(2), status: 'todo' },
    { id: id(3), status: 'todo' },
    { id: id(4), status: 'todo', completedAt: DONE_AT },
    { id: id(5), status: 'in_progress' },
    { id: id(6), status: 'in_progress' },
    { id: id(7), status: 'in_progress' },
    { id: id(8), status: 'review' },
    { id: id(9), status: 'review', completedAt: DONE_AT },
    { id: id(10), status: 'approved', completedAt: DONE_AT, history: [{ status: 'approved', at: APPROVED_AT }] },
    {
        id: id(11),
        status: 'approved',
        history: [
            { status: 'review', at: '2026-09-01T00:00:00.000Z' },
            { status: 'approved', at: APPROVED_AT },
        ],
        updatedAt: UPDATED,
    },
    { id: id(12), status: 'approved', history: [{ status: 'approved', at: 'not-a-date' }], updatedAt: UPDATED },
    {
        id: id(13),
        status: 'blocked',
        history: [
            { status: 'todo', at: '2026-01-01T00:00:00.000Z' },
            { status: 'in_progress', at: '2026-02-01T00:00:00.000Z' },
            { status: 'blocked', at: '2026-03-01T00:00:00.000Z' },
        ],
    },
    {
        id: id(14),
        status: 'blocked',
        history: [
            { status: 'review', at: '2026-04-01T00:00:00.000Z' },
            { status: 'blocked', at: '2026-05-01T00:00:00.000Z' },
        ],
    },
    { id: id(15), status: 'blocked', history: [] },
    { id: id(16), status: 'blocked', history: [{ status: 'blocked', at: '2026-05-01T00:00:00.000Z' }] },
    {
        id: id(17),
        status: 'blocked',
        history: [
            { status: 'approved', at: APPROVED_AT },
            { status: 'blocked', at: '2026-10-01T00:00:00.000Z' },
        ],
        updatedAt: UPDATED,
    },
    { id: id(18), status: 'done', completedAt: DONE_AT },
    { id: id(19), status: 'done', history: [{ status: 'done', at: DONE_AT }], updatedAt: UPDATED },
    { id: id(20), status: 'done', updatedAt: UPDATED },
];

function instant(value: unknown): string | null {
    if (value == null || value === '') return null;
    const time = new Date(String(value)).getTime();
    if (Number.isNaN(time)) return null;
    return new Date(time).toISOString();
}

async function counts(db: PGlite): Promise<Record<string, number>> {
    const result = await db.query<{ status: string; rows: number }>(
        'select status, count(*)::int as rows from public.tasks group by status order by status',
    );
    return Object.fromEntries(result.rows.map(row => [row.status, Number(row.rows)]));
}

test('migration 110 is mirrored and retires the old task statuses', () => {
    assert.equal(schema.includes(migration.trim()), true);
    assert.match(migration, /blocked_reason text/i);
    assert.match(migration, /check \(status in \('todo', 'in_progress', 'done'\)\)/i);
    assert.match(migration, /Migrated from Blocked status/);
    assert.match(migration, /perform public\.note_timer_started_on_task\(owned_task\.id, p_started_at, actor_id\)/);
    assert.match(migration, /v_status not in \('todo', 'in_progress', 'done'\)/);
    assert.match(migration, /old\.status = 'done'/);
    assert.doesNotMatch(migration, /create policy|enable row level security/i);
});

test('legacy rows map once, completion is stamped, and the blocked label follows done', async () => {
    const db = new PGlite();
    await db.exec(`
        do $$ begin
          if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
          if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
          if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
        end $$;
        create table public.tasks (
            id uuid primary key,
            organization_id uuid,
            status text not null,
            status_history jsonb,
            completed_at timestamptz,
            updated_at timestamptz,
            constraint tasks_status_check check (status in ('todo', 'in_progress', 'review', 'approved', 'blocked', 'done'))
        );
        create table public.marketing_plan_items (
            id uuid primary key,
            task_id uuid,
            organization_id uuid,
            status text,
            updated_at timestamptz
        );
        create table public.projects (id uuid primary key);
        create table public.time_logs (id uuid primary key);
        create table public.search_investigations (id uuid primary key);
        create table public.time_log_segments (id uuid primary key);
    `);

    for (const seed of seeds) {
        await db.query(
            `insert into public.tasks (id, organization_id, status, status_history, completed_at, updated_at)
             values ($1, $2, $3, $4::jsonb, $5, $6)`,
            [seed.id, ORG, seed.status, JSON.stringify(seed.history ?? []), seed.completedAt ?? null, seed.updatedAt ?? null],
        );
    }
    await db.query(
        `insert into public.marketing_plan_items (id, task_id, organization_id, status) values
           ($1, $2, $5, 'done'),
           ($3, $4, $5, 'todo'),
           ($6, $7, $5, 'done')`,
        [id(101), id(8), id(102), id(10), ORG, id(103), id(13)],
    );

    const before = await counts(db);
    assert.deepEqual(before, { todo: 4, in_progress: 3, review: 2, approved: 3, blocked: 5, done: 3 });

    await db.exec(migration);

    const after = await counts(db);
    assert.deepEqual(after, { todo: 6, in_progress: 7, done: 7 });

    const rows = await db.query<{
        id: string;
        status: string;
        completed_at: string | null;
        blocked_reason: string | null;
        status_history: { status?: string; by?: string }[] | null;
    }>('select id, status, completed_at, blocked_reason, status_history from public.tasks order by id');

    let labels = 0;
    let doneMissing = 0;
    for (const row of rows.rows) {
        const seed = seeds.find(item => item.id === row.id);
        assert.ok(seed, row.id);
        const expected = migrateLegacyTaskStatus({
            status: seed.status,
            statusHistory: seed.history ?? [],
            completedAt: seed.completedAt ?? null,
            updatedAt: seed.updatedAt ?? null,
            now: NOW,
        });
        assert.equal(row.status, expected.status, seed.status);
        assert.equal(instant(row.completed_at), expected.completedAt, `${seed.status} completed_at`);
        assert.equal(row.blocked_reason, expected.blockedReason, seed.status);
        const history = Array.isArray(row.status_history) ? row.status_history : [];
        const appended = history.length - (seed.history?.length ?? 0);
        assert.equal(appended, expected.statusChanged ? 1 : 0, `${seed.status} history`);
        if (expected.statusChanged) {
            assert.equal(history.at(-1)?.status, expected.status);
            assert.equal(history.at(-1)?.by, 'status-simplification');
        }
        if (row.blocked_reason) labels += 1;
        if (row.status === 'done' && row.completed_at == null) doneMissing += 1;
    }
    assert.equal(labels, 4);
    assert.equal(doneMissing, 0);
    assert.equal(
        rows.rows.filter(row => row.blocked_reason === MIGRATED_BLOCKED_REASON).length,
        4,
    );

    const items = await db.query<{ task_id: string; status: string }>(
        'select task_id, status from public.marketing_plan_items order by id',
    );
    const itemStatus = Object.fromEntries(items.rows.map(row => [row.task_id, row.status]));
    assert.equal(itemStatus[id(8)], 'done', 'review moving to in progress must not uncheck');
    assert.equal(itemStatus[id(10)], 'done', 'approved becoming done checks the item');
    assert.equal(itemStatus[id(13)], 'done', 'blocked moving to in progress must not uncheck');

    const historyBefore = rows.rows.map(row => JSON.stringify(row.status_history));
    await db.exec(migration);
    const second = await db.query<{ id: string; status_history: unknown; status: string; blocked_reason: string | null }>(
        'select id, status, blocked_reason, status_history from public.tasks order by id',
    );
    assert.deepEqual(second.rows.map(row => JSON.stringify(row.status_history)), historyBefore);
    assert.deepEqual(await counts(db), after);

    await assert.rejects(db.query(`update public.tasks set status = 'review' where id = $1`, [id(1)]));

    const fresh = id(21);
    await db.query(
        `insert into public.tasks (id, organization_id, status, blocked_reason) values ($1, $2, 'todo', 'Waiting on client logins')`,
        [fresh, ORG],
    );
    await db.query(`update public.tasks set status = 'done' where id = $1`, [fresh]);
    const completed = (await db.query<{ completed_at: string | null; blocked_reason: string | null; status: string }>(
        'select status, completed_at, blocked_reason from public.tasks where id = $1',
        [fresh],
    )).rows[0];
    assert.equal(completed.status, 'done');
    assert.ok(completed.completed_at, 'marking done stamps completed_at when the writer omits it');
    assert.equal(completed.blocked_reason, null);

    await db.query(`update public.tasks set status = 'todo' where id = $1`, [fresh]);
    const reopened = (await db.query<{ completed_at: string | null; status: string }>(
        'select status, completed_at from public.tasks where id = $1',
        [fresh],
    )).rows[0];
    assert.equal(reopened.status, 'todo');
    assert.equal(reopened.completed_at, null);

    const started = id(22);
    await db.query(
        `insert into public.tasks (id, organization_id, status, status_history) values ($1, $2, 'todo', '[]'::jsonb)`,
        [started, ORG],
    );
    await db.query(`select public.note_timer_started_on_task($1, $2, null)`, [started, NOW]);
    await db.query(`select public.note_timer_started_on_task($1, $2, null)`, [started, NOW]);
    const timer = (await db.query<{ status: string; history_len: number }>(
        `select status, jsonb_array_length(status_history) as history_len from public.tasks where id = $1`,
        [started],
    )).rows[0];
    assert.equal(timer.status, 'in_progress');
    assert.equal(Number(timer.history_len), 1);

    await db.query(`select public.note_timer_started_on_task($1, $2, null)`, [id(18), NOW]);
    const doneTimer = (await db.query<{ status: string }>(
        'select status from public.tasks where id = $1',
        [id(18)],
    )).rows[0];
    assert.equal(doneTimer.status, 'done');
});
