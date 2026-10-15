import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/096_ga4_history.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
const second = '66666666-6666-4666-8666-666666666666';
const property = 'properties/1';
const analytics = 'https://www.googleapis.com/auth/analytics.readonly';

type Queryable = {
    exec: (sql: string) => Promise<unknown>;
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
    close: () => Promise<unknown>;
};

async function database() {
    const db = new PGlite() as unknown as Queryable;
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create function public.get_user_org_ids() returns setof uuid
        language sql stable as $$ select nullif(current_setting('test.org', true), '')::uuid $$;
        create table public.organizations(id uuid primary key);
        create table public.clients(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id),
            name text not null,
            status text not null
        );
        create table public.client_integrations(
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            client_id uuid not null,
            service text not null,
            sync_status text not null default 'active',
            credentials jsonb not null default '{}'::jsonb
        );
        create table public.metrics(id uuid primary key, source text, data jsonb);
        create table public.gsc_history_days(id uuid primary key);
        insert into public.organizations values ('${org}'), ('${otherOrg}');
        insert into public.clients values
            ('${client}', '${org}', 'Example', 'active'),
            ('${second}', '${org}', 'Second', 'active');
        grant all on public.organizations, public.clients, public.client_integrations,
            public.metrics, public.gsc_history_days to service_role;
    `);
    await db.exec(migration);
    return db;
}

const daily = {
    organic_sessions: null,
    sessions: null,
    engaged_sessions: null,
    engagement_rate: null,
    key_events: null,
    total_key_events_by_name: { purchase: null },
};

async function replace(db: Queryable, input: { fetchedAt?: string; daily?: unknown; pages?: unknown; day?: string }) {
    const result = await db.query<{ saved: boolean }>(
        `select public.replace_ga4_day($1,$2,$3,$4::date,$5::timestamptz,$6,$7,$8,$9::jsonb,$10::jsonb) as saved`,
        [
            org, client, property, input.day ?? '2026-10-12', input.fetchedAt ?? '2026-10-15T00:00:00Z',
            true, false, false, JSON.stringify(input.daily ?? daily), JSON.stringify(input.pages ?? []),
        ],
    );
    return result.rows[0].saved;
}

test('migration 096 is new tables only and is mirrored into schema.sql', () => {
    assert.equal(migration.includes('Not applied in this change.'), true);
    assert.equal(/security definer/i.test(migration), false);
    assert.equal(/alter table\s+public\.(metrics|gsc_|bing_|client_integrations)/i.test(migration), false);
    assert.match(migration, /unique \(client_id, property, kind\)/);
    assert.match(migration, /for update of j skip locked/);
    assert.match(migration, /count\(\*\)[\s\S]*>= 5/);
    assert.equal(/organic_sessions double precision default/i.test(migration), false);
    assert.equal(schema.includes('create table public.ga4_sync_jobs'), true);
    assert.equal(schema.includes('create table public.ga4_history_days'), true);
    assert.equal(schema.includes('create table public.ga4_daily'), true);
    assert.equal(schema.includes('create table public.ga4_landing_page_days'), true);
    assert.equal(schema.includes('create table public.client_ga4_settings'), true);
    assert.equal(schema.includes('create function public.enqueue_ga4_sync'), true);
    assert.equal(schema.includes('create function public.enqueue_ga4_backfill'), true);
    assert.equal(schema.includes('create function public.claim_ga4_sync'), true);
    assert.equal(schema.includes('create function public.replace_ga4_day'), true);
});

test('a replaced day keeps nulls, stores a real zero, and a second write does not duplicate', async () => {
    const db = await database();
    try {
        const defaults = await db.query<{ column_default: string | null }>(
            `select column_default from information_schema.columns
             where table_schema = 'public' and table_name = 'ga4_daily' and column_name = 'sessions'`,
        );
        assert.equal(defaults.rows[0].column_default, null);
        await db.exec('set role service_role');
        await db.query(
            `insert into public.client_integrations(organization_id, client_id, service, sync_status, credentials)
             values ($1, $2, 'ga4', 'active', $3::jsonb)`,
            [org, client, JSON.stringify({ property_id: property, granted_scopes: [analytics] })],
        );
        assert.equal(await replace(db, {}), true);
        assert.equal(await replace(db, {
            daily: { ...daily, sessions: 0, organic_sessions: 0 },
            pages: [{ landing_page_raw: '/a', landing_page_norm: '/a', organic_sessions: null, engaged_sessions: 0, key_events: null }],
        }), true);
        const row = await db.query<{ sessions: number | null; organic_sessions: number | null; key_events: number | null; n: number }>(`
            select d.sessions, d.organic_sessions, d.key_events,
                   (select count(*)::int from public.ga4_landing_page_days p where p.day_id = d.day_id) as n
            from public.ga4_daily d
        `);
        assert.equal(row.rows.length, 1);
        assert.equal(row.rows[0].sessions, 0);
        assert.equal(row.rows[0].organic_sessions, 0);
        assert.equal(row.rows[0].key_events, null);
        assert.equal(row.rows[0].n, 1);
        const page = await db.query<{ organic_sessions: number | null; engaged_sessions: number | null }>(
            `select organic_sessions, engaged_sessions::float8 from public.ga4_landing_page_days`,
        );
        assert.equal(page.rows[0].organic_sessions, null);
        assert.equal(page.rows[0].engaged_sessions, 0);

        assert.equal(await replace(db, { fetchedAt: '2026-10-14T00:00:00Z', daily: { ...daily, sessions: 9 } }), false);
        assert.equal((await db.query<{ sessions: number }>(`select sessions::float8 as sessions from public.ga4_daily`)).rows[0].sessions, 0);
        await assert.rejects(
            () => replace(db, { fetchedAt: '2026-10-16T00:00:00Z', daily: { ...daily, sessions: -1 } }),
            /Invalid GA4 metric/,
        );
        assert.equal((await db.query<{ sessions: number }>(`select sessions::float8 as sessions from public.ga4_daily`)).rows[0].sessions, 0);
        await assert.rejects(
            () => replace(db, {
                pages: [
                    { landing_page_raw: '/a', landing_page_norm: '/a', organic_sessions: 1, engaged_sessions: null, key_events: null },
                    { landing_page_raw: '/a?x=1', landing_page_norm: '/a', organic_sessions: 1, engaged_sessions: null, key_events: null },
                ],
            }),
            /Duplicate GA4 landing page/,
        );
        assert.equal((await db.query<{ n: number }>(`select count(*)::int as n from public.ga4_history_days`)).rows[0].n, 1);
    } finally {
        await db.close();
    }
});

test('jobs lease one property at a time, cap at five, and skip a grant without Analytics', async () => {
    const db = await database();
    try {
        await db.exec('set role service_role');
        assert.equal((await db.query<{ queued: boolean }>(`select public.enqueue_ga4_sync($1,$2) as queued`, [org, client])).rows[0].queued, false);
        await db.query(
            `insert into public.client_integrations(organization_id, client_id, service, sync_status, credentials) values
             ($1, $2, 'ga4', 'active', '{"property_id":"properties/1","granted_scopes":["openid"]}'),
             ($1, $3, 'ga4', 'active', '{"property_id":"properties/2"}')`,
            [org, client, second],
        );
        assert.equal((await db.query<{ queued: boolean }>(`select public.enqueue_ga4_sync($1,$2) as queued`, [org, client])).rows[0].queued, false);
        assert.equal((await db.query<{ queued: boolean }>(`select public.enqueue_ga4_sync($1,$2) as queued`, [org, second])).rows[0].queued, true);
        assert.equal((await db.query<{ queued: boolean }>(`select public.enqueue_ga4_backfill($1,$2) as queued`, [org, second])).rows[0].queued, true);
        const claimed = (await db.query<{ property: string; kind: string; attempts: number }>(
            `select property, kind, attempts from public.claim_ga4_sync(null, 'daily')`,
        )).rows;
        assert.equal(claimed.length, 1);
        assert.equal(claimed[0].property, 'properties/2');
        assert.equal(claimed[0].attempts, 1);
        assert.equal((await db.query(`select * from public.claim_ga4_sync(null, 'backfill')`)).rows.length, 0);

        await db.query(`update public.ga4_sync_jobs set status = 'idle', lease_until = null where kind = 'daily'`);
        for (let index = 0; index < 5; index += 1) {
            await db.query(
                `insert into public.ga4_sync_jobs(organization_id, client_id, property, kind, status, lease_until)
                 values ($1, $2, $3, 'daily', 'running', now() + interval '5 minutes')`,
                [org, second, `properties/${100 + index}`],
            );
        }
        assert.equal((await db.query(`select * from public.claim_ga4_sync(null, 'daily')`)).rows.length, 0);

        const oldest = (await db.query<{ oldest: Date }>(
            `select (date_trunc('month', (now() at time zone 'utc'))::date - interval '15 months')::date as oldest`,
        )).rows[0].oldest;
        const oldestIso = oldest.toISOString().slice(0, 10);
        await db.query(
            `update public.ga4_sync_jobs set status = 'idle', cursor_date = $1::date, available_at = now() - interval '1 day', lease_until = null
             where kind = 'backfill'`,
            [oldestIso],
        );
        assert.equal((await db.query<{ queued: boolean }>(`select public.enqueue_ga4_backfill($1,$2) as queued`, [org, second])).rows[0].queued, true);
        assert.equal((await db.query<{ status: string }>(
            `select status from public.ga4_sync_jobs where kind = 'backfill'`,
        )).rows[0].status, 'idle');

        await db.query(
            `insert into public.client_ga4_settings(client_id, organization_id, ga4_key_events) values ($1, $2, null)`,
            [client, org],
        );
        assert.equal((await db.query<{ ga4_key_events: string[] | null }>(
            `select ga4_key_events from public.client_ga4_settings`,
        )).rows[0].ga4_key_events, null);

        await db.exec('reset role');
        await db.exec(`select set_config('test.org', '${org}', false)`);
        await db.exec('set role authenticated');
        await assert.rejects(db.query(`select public.enqueue_ga4_sync($1,$2)`, [org, second]), /permission denied/);
        await assert.rejects(db.query(`select * from public.ga4_sync_jobs`), /permission denied/);
        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query(`select * from public.ga4_history_days`), /permission denied/);
    } finally {
        await db.close();
    }
});

test('members can read their org GA4 rows and cannot write them', async () => {
    const db = await database();
    try {
        await db.exec('set role service_role');
        await db.query(
            `insert into public.client_integrations(organization_id, client_id, service, credentials)
             values ($1, $2, 'ga4', '{"property_id":"properties/1"}')`,
            [org, client],
        );
        await replace(db, { pages: [{ landing_page_raw: '/a', landing_page_norm: '/a', organic_sessions: null, engaged_sessions: null, key_events: null }] });
        await db.exec('reset role');
        await db.exec(`select set_config('test.org', '${org}', false)`);
        await db.exec('set role authenticated');
        assert.equal((await db.query<{ sessions: number | null }>(`select sessions from public.ga4_daily`)).rows[0].sessions, null);
        assert.equal((await db.query(`select landing_page_norm from public.ga4_landing_page_days`)).rows.length, 1);
        await assert.rejects(
            db.query(`insert into public.ga4_history_days(organization_id, client_id, property, day, fetched_at, is_final, sampled, thresholded, row_count)
                      values ('${org}', '${client}', 'properties/9', '2026-10-01', now(), false, false, false, 0)`),
            /permission denied/,
        );
        await db.exec('reset role');
        await db.exec(`select set_config('test.org', '${otherOrg}', false)`);
        await db.exec('set role authenticated');
        assert.equal((await db.query(`select * from public.ga4_history_days`)).rows.length, 0);
        assert.equal((await db.query(`select * from public.ga4_daily`)).rows.length, 0);
    } finally {
        await db.close();
    }
});
