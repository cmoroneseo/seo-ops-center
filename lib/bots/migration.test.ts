import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/113_bot_time_api.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('migration 113 is unapplied, hashed keys, and mirrored into schema.sql', () => {
    for (const needle of [
        'NOT APPLIED',
        'sgszojorcftyaknruckh',
        'Not applied in this change',
        'public.bot_api_keys',
        'public.bot_operations',
        'bot_api_keys_hash_unique',
        'bot_operations_idempotency_unique',
        'tasks_bot_operation_unique',
        'time_logs_bot_operation_unique',
        'protect_bot_attribution',
        'bot attribution is server-controlled',
        "auth.role() = 'service_role'",
        'revoke all on table public.bot_api_keys',
        'revoke all on table public.bot_operations',
        'key_hash',
        'idempotency_key',
    ]) {
        assert.equal(migration.includes(needle), true, needle);
    }
    assert.equal(schema.includes(migration.trim()), true);
    const sql = migration.replace(/--.*$/gm, '');
    assert.equal(/^\s*(update|delete from|truncate)\s/im.test(sql), false);
});

test('one hash and one idempotency key cannot be stored twice', async () => {
    const db = new PGlite();
    await db.exec(`
        create schema auth;
        create role anon;
        create role authenticated;
        create role service_role;
        create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
        create function auth.role() returns text language sql stable as $$ select 'authenticated' $$;
        create table public.organizations(id uuid primary key);
        create table public.users(id uuid primary key);
        create table public.organization_members(
          organization_id uuid,
          user_id uuid,
          role text
        );
        create table public.clients(id uuid primary key, organization_id uuid);
        create table public.tasks(
          id uuid primary key default gen_random_uuid(),
          organization_id uuid,
          client_id uuid,
          title text
        );
        create table public.time_logs(
          id uuid primary key default gen_random_uuid(),
          organization_id uuid,
          client_id uuid,
          hours numeric
        );
        create function uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
    `);
    await db.exec(migration);

    const org = '22222222-2222-4222-8222-222222222222';
    const hash = 'a'.repeat(64);
    await db.query('insert into public.organizations(id) values ($1)', [org]);
    await db.query(
        `insert into public.bot_api_keys (organization_id, name, key_prefix, key_hash)
         values ($1, 'ecoworkz', 'seo_bot_example', $2)`,
        [org, hash],
    );
    await assert.rejects(
        () => db.query(
            `insert into public.bot_api_keys (organization_id, name, key_prefix, key_hash)
             values ($1, 'other', 'seo_bot_example', $2)`,
            [org, hash],
        ),
        /bot_api_keys_hash_unique|duplicate key/,
    );

    const key = await db.query<{ id: string }>('select id from public.bot_api_keys');
    const keyId = key.rows[0].id;
    await db.query(
        `insert into public.bot_operations (organization_id, bot_key_id, idempotency_key, request_hash)
         values ($1, $2, 'ecoworkz-brief-2026-11-03', $3)`,
        [org, keyId, 'b'.repeat(64)],
    );
    await assert.rejects(
        () => db.query(
            `insert into public.bot_operations (organization_id, bot_key_id, idempotency_key, request_hash)
             values ($1, $2, 'ecoworkz-brief-2026-11-03', $3)`,
            [org, keyId, 'c'.repeat(64)],
        ),
        /bot_operations_idempotency_unique|duplicate key/,
    );
});

test('migration 114 is unapplied and allows one running timer per bot', async () => {
    const sql = readFileSync(new URL('../../migrations/114_bot_running_timer.sql', import.meta.url), 'utf8');
    const mirrored = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    for (const needle of [
        'NOT APPLIED',
        'sgszojorcftyaknruckh',
        'Not applied in this change',
        'time_logs_one_running_bot_timer',
        'needs_review',
    ]) {
        assert.equal(sql.includes(needle), true, needle);
    }
    assert.equal(mirrored.includes(sql.trim()), true);
    assert.equal(/^\s*(update|delete from|truncate)\s/im.test(sql.replace(/--.*$/gm, '')), false);

    const db = new PGlite();
    await db.exec(`
        create table public.time_logs (
          id uuid primary key default gen_random_uuid(),
          bot_key_id uuid,
          status text not null
        );
    `);
    await db.exec(sql);
    const botA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const botB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await db.query(
        `insert into public.time_logs (bot_key_id, status) values ($1, 'in_progress')`,
        [botA],
    );
    await assert.rejects(
        () => db.query(
            `insert into public.time_logs (bot_key_id, status) values ($1, 'in_progress')`,
            [botA],
        ),
        /time_logs_one_running_bot_timer|duplicate key/,
    );
    await db.query(
        `insert into public.time_logs (bot_key_id, status) values ($1, 'logged')`,
        [botA],
    );
    await db.query(
        `insert into public.time_logs (bot_key_id, status) values ($1, 'in_progress')`,
        [botB],
    );
    await db.query(
        `insert into public.time_logs (bot_key_id, status) values (null, 'in_progress'), (null, 'in_progress')`,
    );
});

test('migration 125 is unapplied and lets a bot pause without taking the open-segment slot', async () => {
    const sql = readFileSync(new URL('../../migrations/125_bot_timer_pause.sql', import.meta.url), 'utf8');
    const mirrored = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    for (const needle of [
        'NOT APPLIED',
        'sgszojorcftyaknruckh',
        'Not applied in this change',
        'time_logs_status_check',
        "'paused'",
        'time_log_segments',
        'add column if not exists note text',
        'one_open_time_segment_per_user',
    ]) {
        assert.equal(sql.includes(needle), true, needle);
    }
    assert.equal(mirrored.includes(sql.trim()), true);
    assert.equal(/^\s*(update|delete from|truncate)\s/im.test(sql.replace(/--.*$/gm, '')), false);

    const db = new PGlite();
    await db.exec(`
        create table public.time_logs (
          id uuid primary key default gen_random_uuid(),
          bot_key_id uuid,
          status text not null default 'logged' check (status in ('in_progress', 'logged', 'needs_review'))
        );
        create table public.time_log_segments (
          id uuid primary key default gen_random_uuid(),
          time_log_id uuid,
          organization_id uuid,
          user_id uuid,
          started_at timestamptz not null,
          ended_at timestamptz
        );
        create unique index one_open_time_segment_per_user
          on public.time_log_segments (organization_id, user_id)
          where ended_at is null;
        create unique index time_logs_one_running_bot_timer
          on public.time_logs (bot_key_id)
          where status = 'in_progress' and bot_key_id is not null;
    `);
    await db.exec(sql);

    const bot = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const user = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const org = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await db.query(
        `insert into public.time_logs (bot_key_id, status) values ($1, 'paused'), ($1, 'paused'), ($1, 'in_progress')`,
        [bot],
    );
    await assert.rejects(
        () => db.query(`insert into public.time_logs (bot_key_id, status) values ($1, 'in_progress')`, [bot]),
        /time_logs_one_running_bot_timer|duplicate key/,
    );
    await assert.rejects(
        () => db.query(`insert into public.time_logs (bot_key_id, status) values ($1, 'nope')`, [bot]),
        /time_logs_status_check|check constraint/,
    );

    const log = await db.query<{ id: string }>(`select id from public.time_logs where status = 'paused' limit 1`);
    await db.query(
        `insert into public.time_log_segments (time_log_id, organization_id, user_id, started_at, ended_at, note)
         values ($1, $2, $3, '2026-11-03T18:00:00Z', '2026-11-03T18:30:00Z', 'Mapped the keyword set'),
                ($1, $2, $3, '2026-11-03T19:00:00Z', '2026-11-03T19:20:00Z', 'Drafted the brief')`,
        [log.rows[0].id, org, user],
    );
    await db.query(
        `insert into public.time_log_segments (time_log_id, organization_id, user_id, started_at)
         values ($1, $2, $3, '2026-11-03T20:00:00Z')`,
        [log.rows[0].id, org, user],
    );
    await assert.rejects(
        () => db.query(
            `insert into public.time_log_segments (time_log_id, organization_id, user_id, started_at)
             values ($1, $2, $3, '2026-11-03T21:00:00Z')`,
            [log.rows[0].id, org, user],
        ),
        /one_open_time_segment_per_user|duplicate key/,
    );
});
