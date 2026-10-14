import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { parseAgencyAggregate, parseTopQueries } from './aggregate.ts';

const migration = readFileSync(new URL('../../migrations/091_agency_dashboard_speed.sql', import.meta.url), 'utf8');
const org = '11111111-1111-4111-8111-111111111111';
const active = '33333333-3333-4333-8333-333333333333';
const paused = '44444444-4444-4444-8444-444444444444';
const switched = '55555555-5555-4555-8555-555555555555';

test('migration 091 keeps property totals off the query grain and reserves 089', () => {
    assert.equal(migration.includes('089 stays reserved'), true);
    assert.equal(migration.includes('gsc_history_facts_property_day_idx'), true);
    assert.match(migration, /where grain = 'property'/);
    assert.equal(migration.includes("grain = 'query_page'"), true);
    assert.equal(migration.includes('agency_dashboard_top_queries'), true);
    assert.equal(migration.includes('security invoker'), true);
    assert.equal(/security definer/i.test(migration), false);
});

test('property totals ignore query rows, and top queries load for one client', async () => {
    const db = new PGlite();
    try {
        await db.exec(`
            create role anon;
            create role authenticated;
            create role service_role bypassrls;
            create table public.clients(
                id uuid primary key,
                organization_id uuid not null,
                name text not null,
                status text not null
            );
            create table public.client_integrations(
                client_id uuid,
                organization_id uuid,
                service text,
                sync_status text,
                credentials jsonb
            );
            create table public.gsc_history_days(
                id uuid primary key,
                organization_id uuid not null,
                client_id uuid not null,
                property text not null,
                data_date date not null,
                search_type text not null default 'web',
                fetched_at timestamptz not null default now(),
                imported_at timestamptz not null default now(),
                is_incomplete boolean not null default false
            );
            create table public.gsc_history_facts(
                id bigint generated always as identity primary key,
                day_id uuid not null references public.gsc_history_days(id),
                grain text not null,
                page text not null default '',
                query text not null default '',
                clicks bigint not null,
                impressions bigint not null,
                position double precision not null
            );
        `);
        await db.exec(migration);
        await db.exec(`
            insert into public.clients(id, organization_id, name, status) values
                ('${active}', '${org}', 'Active', 'active'),
                ('${paused}', '${org}', 'Paused', 'paused'),
                ('${switched}', '${org}', 'Switched', 'active');
            insert into public.client_integrations(client_id, organization_id, service, sync_status, credentials) values
                ('${active}', '${org}', 'gsc', 'active', '{"site_url":"sc-domain:a.example"}'),
                ('${paused}', '${org}', 'gsc', 'active', '{"site_url":"sc-domain:paused.example"}'),
                ('${switched}', '${org}', 'gsc', 'active', '{"site_url":"sc-domain:c.example"}');
        `);

        async function day(id: string, client: string, property: string, date: string, incomplete = false) {
            await db.query(
                'insert into public.gsc_history_days(id, organization_id, client_id, property, data_date, is_incomplete, imported_at) values ($1,$2,$3,$4,$5,$6,$7)',
                [id, org, client, property, date, incomplete, '2026-10-12T18:00:00Z'],
            );
        }
        async function fact(dayId: string, grain: string, query: string, clicks: number, impressions: number, position: number) {
            await db.query(
                'insert into public.gsc_history_facts(day_id, grain, query, clicks, impressions, position) values ($1,$2,$3,$4,$5,$6)',
                [dayId, grain, query, clicks, impressions, position],
            );
        }

        await day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', active, 'sc-domain:a.example', '2026-10-07', true);
        await day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', active, 'sc-domain:a.example', '2026-10-06');
        await day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', active, 'sc-domain:a.example', '2026-09-30');
        await day('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', paused, 'sc-domain:paused.example', '2026-10-08');
        await day('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', switched, 'sc-domain:c.example', '2026-10-05');
        await day('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', switched, 'https://old.example/', '2026-10-07');

        await fact('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'property', '', 10, 100, 4);
        await fact('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'property', '', 5, 300, 10);
        await fact('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'property', '', 20, 200, 5);
        await fact('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'property', '', 999, 999, 1);
        await fact('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'property', '', 2, 20, 6);
        await fact('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', 'property', '', 777, 777, 1);
        for (const [query, clicks] of [['alpha', 9], ['beta', 4], ['gamma', 2], ['delta', 1], ['zero', 0]] as const) {
            await fact('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'query_page', query, clicks, 10, 3);
        }

        const asOf = await db.query<{ agency_dashboard_as_of: Date | string }>('select public.agency_dashboard_as_of($1)', [org]);
        const asOfValue = asOf.rows[0].agency_dashboard_as_of;
        const asOfIso = asOfValue instanceof Date
            ? asOfValue.toISOString().slice(0, 10)
            : String(asOfValue).slice(0, 10);
        assert.equal(asOfIso, '2026-10-07');

        const raw = await db.query<{ agency_dashboard_gsc: unknown }>(
            'select public.agency_dashboard_gsc($1,$2,$3,$4,$5,$6)',
            [org, '2026-10-01', '2026-10-07', '2026-09-24', '2026-09-30', 'day'],
        );
        const payload = typeof raw.rows[0].agency_dashboard_gsc === 'string'
            ? JSON.parse(raw.rows[0].agency_dashboard_gsc)
            : raw.rows[0].agency_dashboard_gsc;
        const parsed = parseAgencyAggregate(payload);
        const activeRow = parsed.clients.find(row => row.clientId === active)!;
        assert.equal(parsed.queriesKnown, false);
        assert.equal(activeRow.current?.clicks, 15);
        assert.equal(activeRow.current?.impressions, 400);
        assert.equal(activeRow.current?.positionWeight, 3400);
        assert.equal(activeRow.previous?.clicks, 20);
        assert.deepEqual(activeRow.queries, []);
        const queries = await db.query<{ agency_dashboard_top_queries: unknown }>(
            'select public.agency_dashboard_top_queries($1,$2,$3,$4)',
            [org, active, '2026-10-01', '2026-10-07'],
        );
        const queryPayload = typeof queries.rows[0].agency_dashboard_top_queries === 'string'
            ? JSON.parse(queries.rows[0].agency_dashboard_top_queries)
            : queries.rows[0].agency_dashboard_top_queries;
        const top = parseTopQueries(queryPayload);
        assert.deepEqual(top.queries.map(query => query.query), ['alpha', 'beta', 'gamma']);
        assert.equal(top.reason, null);
        const missing = await db.query<{ agency_dashboard_top_queries: unknown }>(
            'select public.agency_dashboard_top_queries($1,$2,$3,$4)',
            [org, switched, '2026-10-01', '2026-10-07'],
        );
        const missingPayload = typeof missing.rows[0].agency_dashboard_top_queries === 'string'
            ? JSON.parse(missing.rows[0].agency_dashboard_top_queries)
            : missing.rows[0].agency_dashboard_top_queries;
        assert.equal(parseTopQueries(missingPayload).reason, 'not_stored');
        await fact('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'query_page', 'silent', 0, 5, 3);
        const silent = await db.query<{ agency_dashboard_top_queries: unknown }>(
            'select public.agency_dashboard_top_queries($1,$2,$3,$4)',
            [org, switched, '2026-10-01', '2026-10-07'],
        );
        const silentPayload = typeof silent.rows[0].agency_dashboard_top_queries === 'string'
            ? JSON.parse(silent.rows[0].agency_dashboard_top_queries)
            : silent.rows[0].agency_dashboard_top_queries;
        assert.equal(parseTopQueries(silentPayload).reason, 'no_clicks');
        assert.equal(parsed.clients.some(row => row.clientId === paused), false);
        const switchedRow = parsed.clients.find(row => row.clientId === switched)!;
        assert.equal(switchedRow.current?.clicks, 2);
        assert.equal(parsed.freshness.settling, true);
        assert.equal(activeRow.series.some(point => point.bucket === '2026-10-05'), false);
        assert.equal(activeRow.series.find(point => point.bucket === '2026-10-07')?.clicks, 10);

        await assert.rejects(
            db.query('select public.agency_dashboard_gsc($1,$2,$3,$4,$5,$6)', [org, '2026-10-01', '2026-10-07', '2026-09-24', '2026-09-30', 'year']),
            /Invalid dashboard bucket/,
        );
        await db.exec('reset role; set role anon');
        await assert.rejects(
            db.query('select public.agency_dashboard_as_of($1)', [org]),
            /permission denied/,
        );
    } finally {
        await db.close();
    }
});
