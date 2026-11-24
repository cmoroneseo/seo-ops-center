import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { trimAuditColumns, writeBotTimer } from './timer-store.ts';

const migration = readFileSync(new URL('../../migrations/143_bot_timer_trim.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('migration 143 mirrors the audit columns and bot writer in schema.sql', () => {
    assert.ok(schema.includes(migration));
    for (const column of Object.keys(trimAuditColumns({ fromSeconds: 1, at: '', userId: null, botKeyId: null }))) {
        assert.match(migration, new RegExp(`add column if not exists ${column}\\b`));
    }
});

test('migration 143 atomically keeps corrected stretches and carries audit onto each finalized day', async t => {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role;
        create table public.time_logs (
          id uuid default gen_random_uuid() primary key,
          organization_id uuid, bot_key_id uuid, client_id uuid, project_id uuid, task_id uuid, user_id uuid,
          status text, timer_started_at timestamptz, date date, hours numeric(5,2), elapsed_seconds integer,
          description text, billable boolean, counts_toward_budget boolean, session_notes jsonb,
          operation_id uuid, bot_operation_id uuid, source text
        );
        create table public.time_log_segments (
          id uuid primary key, time_log_id uuid references public.time_logs(id), organization_id uuid, user_id uuid,
          started_at timestamptz, ended_at timestamptz check (ended_at > started_at), note text
        );
    `);
    await db.exec(migration);
    await db.exec(migration);
    const timer = {
        id: '11111111-1111-4111-8111-111111111111',
        organizationId: '22222222-2222-4222-8222-222222222222',
        botKeyId: '33333333-3333-4333-8333-333333333333',
        startedAt: null,
        elapsedSeconds: 10800,
    };
    const userId = '44444444-4444-4444-8444-444444444444';
    const original = [
        { startedAt: '2026-11-16T23:00:00Z', endedAt: '2026-11-17T01:00:00Z', note: 'Retained' },
        { startedAt: '2026-11-17T02:00:00Z', endedAt: '2026-11-17T03:00:00Z', note: 'Removed' },
    ];
    await db.query(`insert into public.time_logs
        (id, organization_id, bot_key_id, user_id, status, date, hours, elapsed_seconds)
        values ($1, $2, $3, $4, 'paused', '2026-11-16', 3, 10800)`,
    [timer.id, timer.organizationId, timer.botKeyId, userId]);
    for (const stretch of original) {
        await db.query(`insert into public.time_log_segments
          values (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [timer.id, timer.organizationId, userId, stretch.startedAt, stretch.endedAt, stretch.note]);
    }

    const privilege = await db.query(`select
        has_function_privilege('anon', 'public.write_bot_timer(uuid,uuid,uuid,text,timestamptz,integer,timestamptz,jsonb,jsonb,jsonb)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.write_bot_timer(uuid,uuid,uuid,text,timestamptz,integer,timestamptz,jsonb,jsonb,jsonb)', 'execute') as authenticated,
        has_function_privilege('service_role', 'public.write_bot_timer(uuid,uuid,uuid,text,timestamptz,integer,timestamptz,jsonb,jsonb,jsonb)', 'execute') as service_role`);
    assert.deepEqual(privilege.rows, [{ anon: false, authenticated: false, service_role: true }]);

    await db.exec(`
        grant select, insert, update on public.time_logs to authenticated;
        grant select, insert, update, delete on public.time_log_segments to authenticated;
        set role authenticated;
    `);
    await assert.rejects(() => db.exec("update public.time_logs set status = 'logged'"), /server-controlled/);
    await assert.rejects(() => db.exec('update public.time_logs set elapsed_seconds = 20000'), /server-controlled/);
    await assert.rejects(() => db.exec('delete from public.time_log_segments'), /server-controlled/);
    await assert.rejects(() => db.exec(`insert into public.time_logs (status, trimmed_from_seconds)
        values ('logged', 1)`), /server-controlled/);
    await db.exec('reset role');

    const client = {
        async rpc(name: string, args: Record<string, unknown>) {
            assert.equal(name, 'write_bot_timer');
            const { rows } = await db.query(`select * from public.write_bot_timer($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                Object.values(args).map(value => typeof value === 'object' && value !== null ? JSON.stringify(value) : value));
            return rows;
        },
    } as never;
    const at = '2026-11-17T03:30:00Z';
    const kept = [{ ...original[0], endedAt: '2026-11-17T00:30:00Z' }];
    const audit = trimAuditColumns({ fromSeconds: 10800, at, userId, botKeyId: null });
    const [edited] = await writeBotTimer(client, timer, {
        ...audit, hours: 1.5, elapsed_seconds: 5400, description: 'Corrected',
    }, kept);
    assert.equal(edited.status, 'paused');
    assert.equal(edited.elapsed_seconds, 5400);
    assert.deepEqual((await db.query('select note, extract(epoch from ended_at - started_at)::integer as seconds from public.time_log_segments')).rows,
        [{ note: 'Retained', seconds: 5400 }]);

    const finalPatch = {
        status: 'logged', hours: 1, elapsed_seconds: 3600,
        operation_id: '55555555-5555-4555-8555-555555555555',
    };
    assert.deepEqual(await writeBotTimer(client, timer, finalPatch, original), []);
    const updatedTimer = { ...timer, elapsedSeconds: 5400, trimmedAt: at };
    const extra = [{ date: '2026-11-17', seconds: 1800, hours: 0.5 }];
    await assert.rejects(() => writeBotTimer(client, updatedTimer, finalPatch, kept, [...extra, { ...extra[0], hours: 1000 }]));
    assert.deepEqual((await db.query('select status, elapsed_seconds from public.time_logs')).rows, [{ status: 'paused', elapsed_seconds: 5400 }]);

    const finalized = await writeBotTimer(client, updatedTimer, finalPatch, kept, extra);
    assert.deepEqual(finalized.map(row => [row.status, row.elapsed_seconds, row.trimmed_by, Number(row.trimmed_from_seconds)]), [
        ['logged', 3600, userId, 10800],
        ['logged', 1800, userId, 10800],
    ]);
});
