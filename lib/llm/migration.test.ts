import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { utcMonthWindow } from './cost.ts';

const migration = readFileSync(new URL('../../migrations/082_llm_calls.sql', import.meta.url), 'utf8');

const org = '06e536b9-beac-49bc-8c96-1df021102590';
const otherOrg = '11111111-1111-4111-8111-111111111111';
const client = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const otherClient = '22222222-2222-4222-8222-222222222222';

test('the migration does not add a prompt or completion column', () => {
    assert.equal(/^\s*(prompt|completion|messages|content)\s+/im.test(migration), false);
});

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create function public.get_user_org_ids() returns setof uuid
        language sql stable as $$
            select nullif(current_setting('test.org', true), '')::uuid
        $$;
        create table public.organizations (id uuid primary key, name text);
        create table public.clients (
            id uuid primary key,
            organization_id uuid not null references public.organizations(id)
        );
    `);
    await db.exec(migration);
    await db.exec(`
        insert into public.organizations (id, name) values ('${org}', 'Sandbox'), ('${otherOrg}', 'Other');
        insert into public.clients (id, organization_id) values ('${client}', '${org}'), ('${otherClient}', '${otherOrg}');
    `);
    return db;
}

test('the default monthly cap is $50 and owners can raise it', async () => {
    const db = await database();
    const caps = await db.query<{ llm_monthly_spend_cap_usd: string }>(
        'select llm_monthly_spend_cap_usd::text from public.organizations where id = $1',
        [org],
    );
    assert.equal(caps.rows[0]?.llm_monthly_spend_cap_usd, '50.00');
    await db.exec(`update public.organizations set llm_monthly_spend_cap_usd = 75 where id = '${org}'`);
    await assert.rejects(
        () => db.exec(`update public.organizations set llm_monthly_spend_cap_usd = -1 where id = '${org}'`),
    );
});

test('the ledger rejects prompt text, a foreign client, and a blocked row with a cost', async () => {
    const db = await database();
    await db.exec(`
        insert into public.llm_calls (
            organization_id, client_id, feature, ref_id, model,
            input_tokens, output_tokens, cost_usd, latency_ms, status
        ) values (
            '${org}', '${client}', 'content_writer.draft', 'brief_1', 'anthropic/claude-opus-5.5',
            25000, 5000, 0.20000000, 80, 'succeeded'
        );
    `);
    await assert.rejects(
        () => db.exec(`
            insert into public.llm_calls (
                organization_id, feature, model, status, error
            ) values (
                '${org}', 'content_writer.draft', 'anthropic/claude-opus-5.5', 'failed',
                'the client said keep this private'
            );
        `),
    );
    await assert.rejects(
        () => db.exec(`
            insert into public.llm_calls (
                organization_id, client_id, feature, model, status, latency_ms
            ) values (
                '${org}', '${otherClient}', 'content_writer.draft', 'anthropic/claude-opus-5.5', 'succeeded', 1
            );
        `),
    );
    await assert.rejects(
        () => db.exec(`
            insert into public.llm_calls (
                organization_id, feature, model, cost_usd, status, error
            ) values (
                '${org}', 'content_writer.draft', 'anthropic/claude-opus-5.5', 1, 'blocked', 'monthly_spend_cap'
            );
        `),
    );
});

test('monthly spend sums succeeded and failed costs and skips blocked rows', async () => {
    const db = await database();
    await db.exec(`
        insert into public.llm_calls (
            organization_id, feature, model, cost_usd, input_tokens, output_tokens, latency_ms, status, error
        ) values
            ('${org}', 'content_writer.draft', 'anthropic/claude-opus-5.5', 0.20000000, 1, 1, 1, 'succeeded', null),
            ('${org}', 'content_writer.check', 'anthropic/claude-haiku-5.5', 0.01000000, 1, 1, 1, 'failed', 'provider_error'),
            ('${org}', 'content_writer.draft', 'anthropic/claude-opus-5.5', 0, 0, 0, null, 'blocked', 'monthly_spend_cap'),
            ('${otherOrg}', 'content_writer.draft', 'anthropic/claude-opus-5.5', 9, 1, 1, 1, 'succeeded', null);
    `);
    const window = utcMonthWindow(new Date());
    const spend = await db.query<{ spend: string }>(
        `select public.llm_month_spend_usd($1, $2::timestamptz, $3::timestamptz)::text as spend`,
        [org, window.start.toISOString(), window.end.toISOString()],
    );
    assert.equal(Number(spend.rows[0]?.spend), 0.21);
});

test('authenticated members can read their org and cannot insert', async () => {
    const db = await database();
    await db.exec(`
        insert into public.llm_calls (
            organization_id, feature, model, cost_usd, latency_ms, status
        ) values (
            '${org}', 'content_writer.draft', 'anthropic/claude-opus-5.5', 0.20000000, 1, 'succeeded'
        );
    `);
    await db.exec(`set role authenticated; select set_config('test.org', '${org}', false);`);
    const visible = await db.query<{ n: number }>('select count(*)::int as n from public.llm_calls');
    assert.equal(visible.rows[0]?.n, 1);
    await assert.rejects(
        () => db.exec(`
            insert into public.llm_calls (organization_id, feature, model, status, latency_ms)
            values ('${org}', 'content_writer.draft', 'anthropic/claude-opus-5.5', 'succeeded', 1);
        `),
    );
    await db.exec(`select set_config('test.org', '${otherOrg}', false);`);
    const hidden = await db.query<{ n: number }>('select count(*)::int as n from public.llm_calls');
    assert.equal(hidden.rows[0]?.n, 0);
});
