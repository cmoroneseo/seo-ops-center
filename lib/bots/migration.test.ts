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
