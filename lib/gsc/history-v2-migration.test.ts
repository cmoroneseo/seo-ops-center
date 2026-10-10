import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/074_gsc_history_v2.sql', import.meta.url), 'utf8');
const org = '11111111-1111-4111-8111-111111111111';
const client = '33333333-3333-4333-8333-333333333333';
const paused = '44444444-4444-4444-8444-444444444444';

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create function public.get_user_org_ids() returns setof uuid language sql stable as $$ select nullif(current_setting('test.org', true), '')::uuid $$;
        create table public.organizations(id uuid primary key);
        create table public.users(id uuid primary key);
        create table public.projects(id uuid primary key, organization_id uuid);
        create table public.clients(
            id uuid primary key,
            organization_id uuid not null,
            name text not null,
            status text not null default 'active'
        );
        create table public.client_integrations(
            client_id uuid,
            organization_id uuid,
            service text,
            sync_status text,
            credentials jsonb,
            last_synced_at timestamptz
        );
        create table public.metrics (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            project_id uuid,
            date date not null,
            source text not null check (source in ('gsc', 'ga4', 'gbp', 'ahrefs')),
            data jsonb not null,
            created_at timestamptz not null default now(),
            client_id uuid,
            metric_month text,
            sync_run_id uuid,
            source_type text default 'auto' check (source_type in ('auto', 'manual'))
        );
        create table public.sync_runs (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            started_at timestamptz not null default now(),
            finished_at timestamptz,
            status text default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
            clients_synced integer default 0,
            clients_errored integer default 0,
            error_summary jsonb default '[]'::jsonb,
            created_at timestamptz not null default now()
        );
        grant all on public.organizations, public.clients, public.client_integrations, public.metrics, public.sync_runs to service_role;
        insert into public.organizations values ('${org}');
        insert into public.clients values ('${client}', '${org}', 'Scott Cole', 'active'), ('${paused}', '${org}', 'Paused Co', 'paused');
        insert into public.client_integrations values
            ('${client}', '${org}', 'gsc', 'active', '{"site_url":"sc-domain:example.com"}', '2026-09-30T00:00:00Z'),
            ('${client}', '${org}', 'ga4', 'pending_setup', '{}', null);
    `);
    await db.exec(readFileSync(new URL('../../migrations/049_gsc_performance_history.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../../migrations/067_gsc_fresh_data.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../../migrations/066_gsc_background_sync.sql', import.meta.url), 'utf8'));
    await db.exec(readFileSync(new URL('../../migrations/073_metrics_integrity_and_sync_outcomes.sql', import.meta.url), 'utf8'));
    const fact = JSON.stringify([
        { grain: 'property', query: '', page: '', clicks: 8, impressions: 20, position: 4 },
        { grain: 'page', query: '', page: 'https://example.com/?utm_medium=gbp', clicks: 5, impressions: 8, position: 2 },
        { grain: 'page', query: '', page: 'https://example.com/a', clicks: 3, impressions: 12, position: 6 },
    ]);
    await db.query(
        'select public.replace_gsc_history_day($1,$2,$3,$4,$5,false,false,$6::jsonb,false)',
        [org, client, 'sc-domain:example.com', '2024-06-01', '2024-06-02T00:00:00Z', fact],
    );
    await db.exec(migration);
    return db;
}

test('migration 074 labels existing GBP rows, accepts v2 grains, and keeps provenance', async () => {
    const db = await database();
    try {
        const surfaces = await db.query<{ page: string; surface: string }>(
            "select page, surface from gsc_history_facts where grain = 'page' order by page",
        );
        assert.deepEqual(surfaces.rows, [
            { page: 'https://example.com/?utm_medium=gbp', surface: 'gbp_link' },
            { page: 'https://example.com/a', surface: 'organic' },
        ]);
        const again = await db.query<{ backfill_gsc_history_surface: number }>(
            'select public.backfill_gsc_history_surface($1, $2)',
            [1, 100001],
        );
        assert.equal(again.rows[0].backfill_gsc_history_surface, 0);

        await db.exec('set role service_role');
        const v2 = JSON.stringify([
            { grain: 'property_device', device: 'DESKTOP', clicks: 6, impressions: 10, position: 3 },
            { grain: 'property_device', device: 'MOBILE', clicks: 2, impressions: 10, position: 5 },
            { grain: 'property_country', country: 'usa', clicks: 8, impressions: 20, position: 4 },
            { grain: 'page_organic', page: 'https://example.com/a', clicks: 3, impressions: 12, position: 6 },
        ]);
        assert.equal((await db.query(
            'select public.replace_gsc_history_day($1,$2,$3,$4,$5,false,false,$6::jsonb,false) as saved',
            [org, client, 'sc-domain:example.com', '2024-06-02', '2024-06-03T00:00:00Z', v2],
        )).rows[0].saved, true);
        const grains = await db.query<{ grain: string; query: string; device: string | null; country: string | null; surface: string }>(
            "select grain, query, device, country, surface from gsc_history_facts f join gsc_history_days d on d.id = f.day_id where d.data_date = '2024-06-02' order by grain, query",
        );
        assert.deepEqual(grains.rows, [
            { grain: 'page_organic', query: '', device: null, country: null, surface: 'organic' },
            { grain: 'property_country', query: 'usa', device: null, country: 'usa', surface: 'organic' },
            { grain: 'property_device', query: 'DESKTOP', device: 'DESKTOP', country: null, surface: 'organic' },
            { grain: 'property_device', query: 'MOBILE', device: 'MOBILE', country: null, surface: 'organic' },
        ]);

        const classified = JSON.stringify([{ grain: 'page', page: 'https://example.com/x?utm_medium=GBP', clicks: 1, impressions: 1, position: 1 }]);
        await db.query(
            'select public.replace_gsc_history_day($1,$2,$3,$4,$5,false,false,$6::jsonb,false)',
            [org, client, 'sc-domain:example.com', '2024-06-03', '2024-06-04T00:00:00Z', classified],
        );
        const labeled = await db.query<{ surface: string }>(
            "select f.surface from gsc_history_facts f join gsc_history_days d on d.id = f.day_id where d.data_date = '2024-06-03'",
        );
        assert.equal(labeled.rows[0].surface, 'gbp_link');

        await assert.rejects(db.query(
            'select public.replace_gsc_history_day($1,$2,$3,$4,$5,false,false,$6::jsonb,false)',
            [org, client, 'sc-domain:example.com', '2024-06-04', '2024-06-05T00:00:00Z', JSON.stringify([
                { grain: 'property_device', device: 'DESKTOP', clicks: 1, impressions: 1, position: 1 },
                { grain: 'property_device', device: 'DESKTOP', clicks: 2, impressions: 2, position: 2 },
            ])],
        ), /duplicate key|unique/i);

        const coverage = await db.query<{ client_name: string; gsc_connected: boolean; ga4_connected: boolean; history_days: number }>(
            'select client_name, gsc_connected, ga4_connected, history_days from client_search_coverage order by client_name',
        );
        assert.deepEqual(coverage.rows, [{ client_name: 'Scott Cole', gsc_connected: true, ga4_connected: false, history_days: 3 }]);

        const provenance = JSON.stringify({ source: 'gsc_history', finality: { final: true, days_present: 30, days_expected: 30, complete_through: '2026-09-30' } });
        assert.equal((await db.query(
            `select write_metric($1,$2,'gsc','2026-09',$3::jsonb,'auto',null,null,$4::jsonb) as write_metric`,
            [org, client, JSON.stringify({ organic_clicks: 30 }), provenance],
        )).rows[0].write_metric, 'inserted');
        assert.equal((await db.query(
            `select write_metric($1,$2,'gsc','2026-09',$3::jsonb,'auto',null,null) as write_metric`,
            [org, client, JSON.stringify({ organic_clicks: 31 })],
        )).rows[0].write_metric, 'updated');
        const kept = await db.query<{ data: { organic_clicks: number }; provenance: { source: string } }>(
            "select data, provenance from metrics where metric_month = '2026-09'",
        );
        assert.equal(kept.rows[0].data.organic_clicks, 31);
        assert.equal(kept.rows[0].provenance.source, 'gsc_history');

        await db.exec('reset role; set role anon');
        await assert.rejects(db.query('select * from client_search_coverage'), /permission denied/);
        await assert.rejects(db.query('select public.enqueue_gsc_v2_backfill($1,$2)', [org, client]), /permission denied/);
    } finally {
        await db.close();
    }
});

test('v2 backfill jobs are leased apart from the daily sync and resume from the cursor', async () => {
    const db = await database();
    try {
        await db.exec('set role service_role');
        assert.equal((await db.query('select public.enqueue_gsc_sync($1,$2) as queued', [org, client])).rows[0].queued, true);
        assert.equal((await db.query('select public.enqueue_gsc_v2_backfill($1,$2) as queued', [org, client])).rows[0].queued, true);
        assert.equal((await db.query('select count(*)::int as n from gsc_sync_jobs')).rows[0].n, 2);
        const daily = (await db.query<{ kind: string; cursor_date: string | null }>('select kind, cursor_date from public.claim_gsc_sync()')).rows[0];
        assert.equal(daily.kind, 'daily');
        const backfill = (await db.query<{ id: string; kind: string; lease_token: string; cursor_date: string | null }>(
            "select id, kind, lease_token, cursor_date from public.claim_gsc_sync(null, 'v2_backfill')",
        )).rows[0];
        assert.equal(backfill.kind, 'v2_backfill');
        assert.equal(backfill.cursor_date, null);
        await db.query("update gsc_sync_jobs set cursor_date = '2026-09-01', lease_until = now() - interval '1 second' where id = $1", [backfill.id]);
        const resumed = (await db.query<{ cursor_date: string; lease_token: string }>(
            "select cursor_date::text, lease_token from public.claim_gsc_sync(null, 'v2_backfill')",
        )).rows[0];
        assert.equal(resumed.cursor_date, '2026-09-01');
        assert.notEqual(resumed.lease_token, backfill.lease_token);
        assert.equal((await db.query('select * from public.claim_gsc_sync()')).rows.length, 0);
    } finally {
        await db.close();
    }
});

test('a parked idle backfill job is not claimed and is not woken by enqueue', async () => {
    const db = await database();
    try {
        await db.exec('set role service_role');
        assert.equal((await db.query('select public.enqueue_gsc_v2_backfill($1,$2) as queued', [org, client])).rows[0].queued, true);
        await db.query(
            "update gsc_sync_jobs set status = 'idle', available_at = now() + interval '30 days', cursor_date = '2026-08-01' where kind = 'v2_backfill'",
        );
        const before = (await db.query<{ status: string; available_at: Date }>(
            "select status, available_at from gsc_sync_jobs where kind = 'v2_backfill'",
        )).rows[0];
        assert.equal((await db.query('select public.enqueue_gsc_v2_backfill($1,$2) as queued', [org, client])).rows[0].queued, true);
        const after = (await db.query<{ status: string; available_at: Date }>(
            "select status, available_at from gsc_sync_jobs where kind = 'v2_backfill'",
        )).rows[0];
        assert.equal(after.status, 'idle');
        assert.equal(new Date(after.available_at).toISOString(), new Date(before.available_at).toISOString());
        assert.equal((await db.query("select * from public.claim_gsc_sync(null, 'v2_backfill')")).rows.length, 0);
    } finally {
        await db.close();
    }
});

test('schema.sql mirrors the GSC history v2 migration', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.equal(schema.includes(migration), true);
});
