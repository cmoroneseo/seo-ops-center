import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/100_bot_api_tokens.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const ORG = '22222222-2222-4222-8222-222222222222';
const OTHER = '88888888-8888-4888-8888-888888888888';
const USER = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const OUTSIDER = '44444444-4444-4444-8444-444444444444';
const TOKEN = '55555555-5555-4555-8555-555555555555';

test('migration 100 is new tables only, unapplied, and mirrored into schema.sql', () => {
    assert.match(migration, /Not applied in this change/);
    assert.equal(/alter table\s+public\.client_integrations/i.test(migration), false);
    assert.equal(/alter table\s+public\.ga4_/i.test(migration), false);
    assert.equal(/alter table\s+public\.gsc_/i.test(migration), false);
    assert.equal(/insert into/i.test(migration), false);
    assert.equal(schema.includes(migration.trim()), true);
});

test('bot tokens are service-role writes, hide the hash, and rate limit', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create schema if not exists auth;
            create or replace function auth.uid() returns uuid language sql stable as $$ select '${USER}'::uuid $$;
            create role anon;
            create role authenticated;
            create role service_role bypassrls;
            grant usage on schema auth to anon, authenticated, service_role;
            grant execute on function auth.uid() to anon, authenticated, service_role;
            create table public.organizations(id uuid primary key);
            create table public.users(id uuid primary key);
            create table public.clients(id uuid primary key, organization_id uuid);
            create table public.organization_members(organization_id uuid, user_id uuid, role text);
            create or replace function public.get_user_admin_org_ids()
            returns setof uuid language sql stable as $$
              select organization_id from public.organization_members
              where user_id = auth.uid() and role in ('owner', 'admin')
            $$;
        `);
        await db.exec(migration);
        await db.query('insert into public.organizations(id) values ($1), ($2)', [ORG, OTHER]);
        await db.query('insert into public.users(id) values ($1)', [USER]);
        await db.query('insert into public.clients(id, organization_id) values ($1, $2), ($3, $4)', [CLIENT, ORG, OUTSIDER, OTHER]);
        await db.query(`insert into public.organization_members(organization_id, user_id, role) values ('${ORG}', '${USER}', 'owner')`);
        await db.exec('grant select on public.clients to service_role');
        await db.exec('grant select on public.organization_members to authenticated');

        await db.exec('set role service_role');
        await db.query(
            `insert into public.bot_tokens
                (id, organization_id, name, token_prefix, token_hash, client_ids, created_by, rate_limit_per_minute)
             values ($1, $2, 'Weekly', 'prefixvalue1', repeat('ab', 32), array[$3]::uuid[], $4, 2)`,
            [TOKEN, ORG, CLIENT, USER],
        );
        await assert.rejects(db.query(
            `insert into public.bot_tokens
                (organization_id, name, token_prefix, token_hash, client_ids)
             values ($1, 'Bad', 'prefixvalue2', repeat('cd', 32), array[$2]::uuid[])`,
            [ORG, OUTSIDER],
        ), /outside the organization/i);

        const first = await db.query<{ allowed: string }>(
            `select (public.consume_bot_token_quota($1, '2026-10-15T00:00:00Z'))->>'allowed' as allowed`,
            [TOKEN],
        );
        const second = await db.query<{ remaining: string }>(
            `select (public.consume_bot_token_quota($1, '2026-10-15T00:00:01Z'))->>'remaining' as remaining`,
            [TOKEN],
        );
        assert.equal(first.rows[0].allowed, 'true');
        assert.equal(second.rows[0].remaining, '0');
        const limited = await db.query<{ allowed: string; retry: string }>(
            `select allowed, retry_after_seconds as retry
             from jsonb_to_record(public.consume_bot_token_quota($1, '2026-10-15T00:00:30Z'))
             as x(allowed text, retry_after_seconds text)`,
            [TOKEN],
        );
        assert.equal(limited.rows[0].allowed, 'false');
        assert.ok(Number(limited.rows[0].retry) > 0);
        const reset = await db.query<{ allowed: string }>(
            `select (public.consume_bot_token_quota($1, '2026-10-15T00:01:01Z'))->>'allowed' as allowed`,
            [TOKEN],
        );
        const count = await db.query<{ count: number }>(`select window_count as count from public.bot_tokens where id = $1`, [TOKEN]);
        assert.equal(reset.rows[0].allowed, 'true');
        assert.equal(Number(count.rows[0].count), 1);
        await db.query(`update public.bot_tokens set revoked_at = now() where id = $1`, [TOKEN]);
        const inactive = await db.query<{ inactive: string }>(
            `select (public.consume_bot_token_quota($1, now()))->>'inactive' as inactive`,
            [TOKEN],
        );
        assert.equal(inactive.rows[0].inactive, 'true');
        await db.query(
            `insert into public.bot_api_audit (organization_id, token_id, token_prefix, route, client_id, status, error_code)
             values ($1, $2, 'prefixvalue1', 'ga4', $3, 200, null)`,
            [ORG, TOKEN, CLIENT],
        );

        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query('select id from public.bot_tokens'), /permission denied/i);
        await db.exec('reset role');
        await db.exec('set role authenticated');
        const visible = await db.query<{ name: string }>('select name from public.bot_tokens');
        assert.equal(visible.rows[0]?.name, 'Weekly');
        await assert.rejects(db.query('select token_hash from public.bot_tokens'), /permission denied/i);
        await assert.rejects(db.query(
            `insert into public.bot_tokens (organization_id, name, token_prefix, token_hash)
             values ($1, 'Browser', 'prefixvalue3', repeat('ef', 32))`,
            [ORG],
        ), /permission denied/i);
        await assert.rejects(
            db.query(`select public.consume_bot_token_quota($1, now())`, [TOKEN]),
            /permission denied/i,
        );
        const audit = await db.query('select route, error_code from public.bot_api_audit');
        assert.equal(audit.rows[0]?.route, 'ga4');
    } finally {
        await db.close();
    }
});
