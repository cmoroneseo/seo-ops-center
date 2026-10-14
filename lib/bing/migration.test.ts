import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/094_bing_webmaster.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
const paused = '44444444-4444-4444-8444-444444444444';
const zero = '55555555-5555-4555-8555-555555555555';
const second = '66666666-6666-4666-8666-666666666666';
const site = 'https://example.com/';
const zeroSite = 'https://zero.example/';
const pausedSite = 'https://paused.example/';
const secondSite = 'https://second.example/';
const googleDay = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

type Queryable = {
    exec: (sql: string) => Promise<unknown>;
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
    close: () => Promise<unknown>;
};

function json(value: unknown): unknown {
    return typeof value === 'string' ? JSON.parse(value) : value;
}

function day(value: unknown): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
}

function keysDeep(value: unknown, found = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
        for (const item of value) keysDeep(item, found);
        return found;
    }
    if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
            found.add(key);
            keysDeep(child, found);
        }
    }
    return found;
}

async function googleRow(db: Queryable) {
    const result = await db.query<{
        id: string;
        property: string;
        data_date: string | Date;
        search_type: string;
        grain: string;
        clicks: number;
        impressions: number;
        position: number;
    }>(`
        select d.id::text, d.property, d.data_date::text, d.search_type, f.grain,
               f.clicks::int, f.impressions::int, f.position::float8 as position
        from public.gsc_history_days d
        join public.gsc_history_facts f on f.day_id = d.id
        order by f.grain
    `);
    return result.rows.map(row => ({ ...row, data_date: day(row.data_date) }));
}

async function columnNames(db: Queryable, table: string) {
    const result = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = $1
         order by column_name`,
        [table],
    );
    return result.rows.map(row => row.column_name);
}

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
            credentials jsonb not null default '{}'::jsonb,
            constraint client_integrations_service_check check (service in ('ga4', 'gsc', 'gbp', 'ahrefs'))
        );
        create table public.gsc_history_days(
            id uuid primary key,
            organization_id uuid not null,
            client_id uuid not null,
            property text not null,
            data_date date not null,
            search_type text not null default 'web',
            fetched_at timestamptz not null
        );
        create table public.gsc_history_facts(
            id bigint generated always as identity primary key,
            day_id uuid not null references public.gsc_history_days(id),
            grain text not null,
            query text not null default '',
            page text not null default '',
            clicks bigint not null,
            impressions bigint not null,
            position double precision not null
        );
        insert into public.organizations values ('${org}'), ('${otherOrg}');
        insert into public.clients values
            ('${client}', '${org}', 'Example', 'active'),
            ('${paused}', '${org}', 'Paused Co', 'paused'),
            ('${zero}', '${org}', 'Zero Co', 'active'),
            ('${second}', '${org}', 'Second', 'active');
        insert into public.client_integrations(organization_id, client_id, service, sync_status, credentials) values
            ('${org}', '${client}', 'gsc', 'active', '{"site_url":"sc-domain:example.com","access_token":"google-token"}');
        insert into public.gsc_history_days(id, organization_id, client_id, property, data_date, fetched_at)
        values ('${googleDay}', '${org}', '${client}', 'sc-domain:example.com', '2026-10-01', '2026-10-02T00:00:00Z');
        insert into public.gsc_history_facts(day_id, grain, clicks, impressions, position)
        values ('${googleDay}', 'property', 999, 5000, 4.25);
    `);
    await assert.rejects(
        db.query(
            `insert into public.client_integrations(organization_id, client_id, service, credentials)
             values ($1, $2, 'bing', '{"site_url":"https://example.com/"}')`,
            [org, client],
        ),
        /check|violates/i,
    );
    const before = await googleRow(db);
    const daysBefore = await columnNames(db, 'gsc_history_days');
    const factsBefore = await columnNames(db, 'gsc_history_facts');
    await db.exec(migration);
    await db.exec(`
        grant all on public.organizations, public.clients, public.client_integrations,
            public.gsc_history_days, public.gsc_history_facts to service_role;
    `);
    return { db, before, daysBefore, factsBefore };
}

async function replace(
    db: Queryable,
    input: {
        clientId?: string;
        siteUrl?: string;
        fetchedAt?: string;
        traffic: unknown;
        queries: unknown;
        pages: unknown;
    },
) {
    const result = await db.query<{ saved: boolean }>(
        `select public.replace_bing_snapshot($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb) as saved`,
        [
            org,
            input.clientId ?? client,
            input.siteUrl ?? site,
            input.fetchedAt ?? '2026-10-08T00:00:00Z',
            JSON.stringify(input.traffic),
            input.queries == null ? null : JSON.stringify(input.queries),
            input.pages == null ? null : JSON.stringify(input.pages),
        ],
    );
    return result.rows[0].saved;
}

test('migration 094 does not touch Google history and is mirrored into schema.sql', () => {
    assert.equal(migration.includes('Not applied in this change.'), true);
    assert.equal(/security definer/i.test(migration), false);
    assert.equal(migration.includes('security invoker'), true);
    assert.equal(/alter table\s+public\.gsc_/i.test(migration), false);
    assert.equal(/on public\.gsc_history/i.test(migration), false);
    assert.equal(migration.includes('function public.agency_dashboard_gsc'), false);
    assert.equal(migration.includes('replace_gsc_history_day'), false);
    assert.match(migration, /for update of j skip locked/);
    assert.match(migration, /unique \(client_id, site_url, data_date\)/);
    assert.match(migration, /unique \(client_id, site_url, week_ending, query_key\)/);
    assert.match(migration, /unique \(client_id, site_url, week_ending, page_key\)/);
    assert.equal(/insert into public\.clients\b/i.test(migration), false);
    assert.equal(/insert into public\.client_integrations\b/i.test(migration), false);
    assert.equal(schema.includes('create table public.bing_traffic_days'), true);
    assert.equal(schema.includes('create function public.replace_bing_snapshot'), true);
    assert.equal(schema.includes('client_integrations_bing_site_url_check'), true);
});

test('a snapshot replaces Bing rows in place and leaves the Google day untouched', async () => {
    const { db, before, daysBefore, factsBefore } = await database();
    try {
        assert.deepEqual(await columnNames(db, 'gsc_history_days'), daysBefore);
        assert.deepEqual(await columnNames(db, 'gsc_history_facts'), factsBefore);
        assert.deepEqual(await googleRow(db), before);

        await db.exec('set role service_role');
        await db.query(
            `insert into public.client_integrations(organization_id, client_id, service, sync_status, credentials) values
                ($1, $2, 'bing', 'active', '{"site_url":"https://example.com/"}'),
                ($1, $3, 'bing', 'active', '{"site_url":"https://zero.example/"}'),
                ($1, $4, 'bing', 'active', '{"site_url":"https://paused.example/"}'),
                ($1, $5, 'bing', 'active', '{"site_url":"https://second.example/"}')`,
            [org, client, zero, paused, second],
        );
        await assert.rejects(
            db.query(
                `insert into public.client_integrations(organization_id, client_id, service, credentials)
                 values ($1, $2, 'bing', '{"site_url":"https://example.com/","AuthenticationCode":"discard-me"}')`,
                [org, client],
            ),
            /check|violates/i,
        );
        await assert.rejects(
            db.query(
                `insert into public.client_integrations(organization_id, client_id, service, credentials)
                 values ($1, $2, 'indexnow', '{"site_url":"https://example.com/"}')`,
                [org, second],
            ),
            /check|violates/i,
        );
        const googleCreds = await db.query<{ credentials: { access_token?: string } }>(
            `select credentials from public.client_integrations where service = 'gsc'`,
        );
        assert.equal(googleCreds.rows[0].credentials.access_token, 'google-token');

        const traffic = [
            { data_date: '2026-10-01', clicks: 1, impressions: 10 },
            { data_date: '2026-10-02', clicks: 1, impressions: 10 },
            { data_date: '2026-10-03', clicks: 1, impressions: 10 },
            { data_date: '2026-10-04', clicks: 1, impressions: 10 },
            { data_date: '2026-10-05', clicks: 1, impressions: 10 },
            { data_date: '2026-10-06', clicks: 1, impressions: 10 },
            { data_date: '2026-10-07', clicks: 1, impressions: 10 },
            { data_date: '2026-09-20', clicks: 0, impressions: 4 },
        ];
        const queries = [
            { week_ending: '2026-10-04', query: 'alpha', clicks: 4, impressions: 10, avg_impression_position: 10, avg_click_position: 3 },
            { week_ending: '2026-10-04', query: 'beta', clicks: 1, impressions: 30, avg_impression_position: 20, avg_click_position: null },
            { week_ending: '2026-10-04', query: 'gamma', clicks: 3, impressions: 100, avg_impression_position: null, avg_click_position: null },
            { week_ending: '2026-10-04', query: 'hidden', clicks: 0, impressions: 10, avg_impression_position: 5, avg_click_position: 1 },
            { week_ending: '2026-09-26', query: 'old', clicks: 2, impressions: 8, avg_impression_position: 4, avg_click_position: 2 },
            { week_ending: '2026-10-08', query: 'outside', clicks: 9, impressions: 9, avg_impression_position: 1, avg_click_position: 1 },
        ];
        const pages = [
            { week_ending: '2026-10-04', page: 'https://example.com/a', clicks: 4, impressions: 10, avg_impression_position: 8, avg_click_position: 2 },
        ];
        assert.equal(await replace(db, { traffic, queries, pages }), true);
        assert.equal(await replace(db, { traffic, queries, pages }), true);

        const counts = await db.query<{ traffic: number; queries: number; pages: number }>(`
            select
                (select count(*)::int from public.bing_traffic_days where client_id = '${client}') as traffic,
                (select count(*)::int from public.bing_query_weeks where client_id = '${client}') as queries,
                (select count(*)::int from public.bing_page_weeks where client_id = '${client}') as pages
        `);
        assert.deepEqual(counts.rows[0], { traffic: 8, queries: 6, pages: 1 });
        const zeroDay = await db.query<{ clicks: number; impressions: number }>(
            `select clicks::int, impressions::int from public.bing_traffic_days
             where client_id = '${client}' and data_date = '2026-09-20'`,
        );
        assert.deepEqual(zeroDay.rows[0], { clicks: 0, impressions: 4 });
        const missingPosition = await db.query<{ avg_impression_position: number | null }>(
            `select avg_impression_position::float8 from public.bing_query_weeks where query = 'gamma'`,
        );
        assert.equal(missingPosition.rows[0].avg_impression_position, null);

        assert.equal(await replace(db, {
            clientId: second,
            siteUrl: secondSite,
            traffic: [{ data_date: '2026-10-03', clicks: 4, impressions: 4 }],
            queries: [],
            pages: [],
        }), true);
        const keptAside = await db.query<{ clicks: number }>(
            `select clicks::int from public.bing_traffic_days where client_id = '${second}'`,
        );
        assert.equal(keptAside.rows[0].clicks, 4);

        await assert.rejects(
            replace(db, {
                traffic: [{ data_date: '2026-10-01', clicks: -1, impressions: 1 }],
                queries: [],
                pages: [],
            }),
            /Invalid Bing traffic row/,
        );
        await assert.rejects(
            replace(db, {
                traffic: [
                    { data_date: '2026-10-01', clicks: 1, impressions: 1 },
                    { data_date: '2026-10-01', clicks: 2, impressions: 2 },
                ],
                queries: [],
                pages: [],
            }),
            /Duplicate Bing traffic day/,
        );
        await assert.rejects(
            replace(db, {
                traffic,
                queries: [
                    { week_ending: '2026-10-04', query: 'alpha', clicks: 1, impressions: 1, avg_impression_position: -1, avg_click_position: null },
                ],
                pages: [],
            }),
            /Invalid Bing query row/,
        );
        assert.deepEqual(counts.rows[0], (await db.query(`
            select
                (select count(*)::int from public.bing_traffic_days where client_id = '${client}') as traffic,
                (select count(*)::int from public.bing_query_weeks where client_id = '${client}') as queries,
                (select count(*)::int from public.bing_page_weeks where client_id = '${client}') as pages
        `)).rows[0]);
        assert.equal((await db.query<{ clicks: number }>(
            `select clicks::int from public.bing_traffic_days where client_id = '${second}'`,
        )).rows[0].clicks, 4);

        const keptQuery = await db.query<{ clicks: number; fetched_at: Date; stale: boolean }>(
            `select clicks::int, fetched_at, stale from public.bing_query_weeks where query = 'alpha'`,
        );
        assert.equal(await replace(db, {
            fetchedAt: '2026-10-09T00:00:00Z',
            traffic: [{ data_date: '2026-10-09', clicks: 8, impressions: 80 }],
            queries: null,
            pages: null,
        }), true);
        const afterKeep = await db.query<{ clicks: number; fetched_at: Date; stale: boolean; queries_complete: boolean }>(`
            select q.clicks::int, q.fetched_at, q.stale, d.queries_complete
            from public.bing_query_weeks q
            join public.bing_traffic_days d on d.client_id = q.client_id and d.site_url = q.site_url
            where q.query = 'alpha'
        `);
        assert.equal(afterKeep.rows.length, 1);
        assert.equal(afterKeep.rows[0].clicks, 4);
        assert.equal(afterKeep.rows[0].stale, true);
        assert.equal(afterKeep.rows[0].queries_complete, false);
        assert.equal(afterKeep.rows[0].fetched_at.toISOString(), keptQuery.rows[0].fetched_at.toISOString());
        assert.equal((await db.query<{ n: number }>(
            `select count(*)::int as n from public.bing_traffic_days where client_id = '${client}'`,
        )).rows[0].n, 1);
        assert.equal((await db.query<{ clicks: number }>(
            `select clicks::int from public.bing_page_weeks where client_id = '${client}'`,
        )).rows[0].clicks, 4);

        assert.equal(await replace(db, {
            fetchedAt: '2026-10-07T00:00:00Z',
            traffic: [{ data_date: '2026-10-01', clicks: 99, impressions: 99 }],
            queries: [],
            pages: [],
        }), false);
        assert.equal((await db.query<{ clicks: number }>(
            `select clicks::int from public.bing_traffic_days where client_id = '${client}'`,
        )).rows[0].clicks, 8);
        assert.equal((await db.query<{ n: number }>(
            `select count(*)::int as n from public.bing_query_weeks where query = 'alpha'`,
        )).rows[0].n, 1);

        await assert.rejects(
            replace(db, { clientId: paused, siteUrl: site, traffic: [], queries: [], pages: [] }),
            /Bing site changed/,
        );
        await db.query(`update public.client_integrations set sync_status = 'disconnected' where client_id = '${second}' and service = 'bing'`);
        await assert.rejects(
            replace(db, { clientId: second, siteUrl: secondSite, traffic: [], queries: [], pages: [] }),
            /Bing site changed/,
        );
        assert.equal((await db.query<{ clicks: number }>(
            `select clicks::int from public.bing_traffic_days where client_id = '${second}'`,
        )).rows[0].clicks, 4);

        assert.deepEqual(await googleRow(db), before);
        assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.gsc_history_facts')).rows[0].n, 1);
    } finally {
        await db.close();
    }
});

test('dashboard totals keep Bing position on its own weeks and do not absorb Google', async () => {
    const { db } = await database();
    try {
        await db.exec('set role service_role');
        await db.query(
            `insert into public.client_integrations(organization_id, client_id, service, sync_status, credentials) values
                ($1, $2, 'bing', 'active', '{"site_url":"https://example.com/"}'),
                ($1, $3, 'bing', 'active', '{"site_url":"https://zero.example/"}'),
                ($1, $4, 'bing', 'active', '{"site_url":"https://paused.example/"}')`,
            [org, client, zero, paused],
        );
        const traffic = [1, 2, 3, 4, 5, 6, 7].map(dayNumber => ({
            data_date: `2026-10-0${dayNumber}`,
            clicks: 1,
            impressions: 10,
        }));
        await replace(db, {
            traffic: [...traffic, { data_date: '2026-09-20', clicks: 0, impressions: 4 }],
            queries: [
                { week_ending: '2026-10-04', query: 'alpha', clicks: 4, impressions: 10, avg_impression_position: 10, avg_click_position: 3 },
                { week_ending: '2026-10-04', query: 'beta', clicks: 1, impressions: 30, avg_impression_position: 20, avg_click_position: null },
                { week_ending: '2026-10-04', query: 'gamma', clicks: 3, impressions: 100, avg_impression_position: null, avg_click_position: null },
                { week_ending: '2026-10-04', query: 'hidden', clicks: 0, impressions: 10, avg_impression_position: 5, avg_click_position: 1 },
                { week_ending: '2026-09-26', query: 'old', clicks: 2, impressions: 8, avg_impression_position: 4, avg_click_position: 2 },
                { week_ending: '2026-10-08', query: 'outside', clicks: 9, impressions: 9, avg_impression_position: 1, avg_click_position: 1 },
            ],
            pages: [
                { week_ending: '2026-10-04', page: 'https://example.com/a', clicks: 4, impressions: 10, avg_impression_position: 8, avg_click_position: 2 },
            ],
        });
        await replace(db, {
            clientId: zero,
            siteUrl: zeroSite,
            traffic: [{ data_date: '2026-10-03', clicks: 0, impressions: 0 }],
            queries: [],
            pages: [],
        });
        await replace(db, {
            clientId: paused,
            siteUrl: pausedSite,
            traffic: [{ data_date: '2026-10-03', clicks: 50, impressions: 50 }],
            queries: [{ week_ending: '2026-10-04', query: 'paused', clicks: 50, impressions: 50, avg_impression_position: 1, avg_click_position: 1 }],
            pages: [],
        });

        const raw = await db.query<{ agency_dashboard_bing: unknown }>(
            'select public.agency_dashboard_bing($1,$2,$3,$4,$5,$6)',
            [org, '2026-10-01', '2026-10-07', '2026-09-20', '2026-09-26', 'day'],
        );
        const payload = json(raw.rows[0].agency_dashboard_bing) as {
            current: Array<Record<string, unknown>>;
            previous: Array<Record<string, unknown>>;
            series: Array<Record<string, unknown>>;
            positionSeries: Array<Record<string, unknown>>;
            queries: Array<{ clientId: string; stale: boolean; queries: Array<Record<string, unknown>> }>;
        };
        const names = keysDeep(payload);
        assert.equal(names.has('rank'), false);
        assert.equal(names.has('avgClickPosition'), false);
        assert.equal(names.has('ctr'), false);

        const current = payload.current.find(row => row.clientId === client)!;
        const quiet = payload.current.find(row => row.clientId === zero)!;
        assert.equal(payload.current.some(row => row.clientId === paused), false);
        assert.equal(current.clicks, 7);
        assert.equal(current.impressions, 70);
        assert.equal(current.days, 7);
        assert.equal(current.positionWeight, 750);
        assert.equal(current.positionImpressions, 50);
        assert.equal(quiet.clicks, 0);
        assert.equal(quiet.impressions, 0);
        assert.equal(quiet.days, 1);
        assert.equal(quiet.positionWeight, null);

        const previous = payload.previous.find(row => row.clientId === client)!;
        assert.equal(previous.clicks, 0);
        assert.equal(previous.impressions, 4);
        assert.equal(previous.positionWeight, 32);
        assert.equal(previous.positionImpressions, 8);

        const clickSeries = payload.series.filter(row => row.clientId === client);
        const positionSeries = payload.positionSeries.filter(row => row.clientId === client);
        assert.equal(clickSeries.length, 7);
        assert.deepEqual(positionSeries.map(row => day(row.weekEnding)), ['2026-10-04']);
        assert.equal(positionSeries[0].positionWeight, 750);

        const listed = payload.queries.find(row => row.clientId === client)!;
        assert.equal(listed.stale, false);
        assert.deepEqual(listed.queries.map(row => row.query), ['alpha', 'gamma', 'beta']);
        assert.equal(listed.queries.find(row => row.query === 'gamma')?.avgImpressionPosition, null);
        assert.equal(payload.queries.some(row => row.clientId === paused), false);

        await replace(db, {
            fetchedAt: '2026-10-10T00:00:00Z',
            traffic: [{ data_date: '2026-10-05', clicks: 3, impressions: 30 }],
            queries: null,
            pages: [],
        });
        const staleRaw = await db.query<{ agency_dashboard_bing: unknown }>(
            'select public.agency_dashboard_bing($1,$2,$3,$4,$5,$6)',
            [org, '2026-10-01', '2026-10-07', '2026-09-20', '2026-09-26', 'day'],
        );
        const stalePayload = json(staleRaw.rows[0].agency_dashboard_bing) as typeof payload;
        const staleList = stalePayload.queries.find(row => row.clientId === client)!;
        assert.equal(staleList.stale, true);
        assert.equal(staleList.queries.some(row => row.query === 'alpha'), true);
        assert.equal((await googleRow(db))[0].clicks, 999);
        assert.equal((await googleRow(db))[0].position, 4.25);
    } finally {
        await db.close();
    }
});

test('Bing sync jobs lease one site at a time and ignore a parked retry', async () => {
    const { db } = await database();
    try {
        await db.exec('set role service_role');
        assert.equal((await db.query<{ queued: boolean }>('select public.enqueue_bing_sync($1,$2) as queued', [org, client])).rows[0].queued, false);
        await db.query(
            `insert into public.client_integrations(organization_id, client_id, service, sync_status, credentials) values
                ($1, $2, 'bing', 'disconnected', '{"site_url":"https://example.com/"}'),
                ($1, $3, 'bing', 'pending_setup', '{"site_url":"https://zero.example/"}'),
                ($1, $4, 'bing', 'error', '{"site_url":"https://second.example/"}')`,
            [org, client, zero, second],
        );
        assert.equal((await db.query<{ queued: boolean }>('select public.enqueue_bing_sync($1,$2) as queued', [org, client])).rows[0].queued, false);
        assert.equal((await db.query<{ queued: boolean }>('select public.enqueue_bing_sync($1,$2) as queued', [org, zero])).rows[0].queued, false);
        assert.equal((await db.query<{ queued: boolean }>('select public.enqueue_bing_sync($1,$2) as queued', [org, second])).rows[0].queued, true);
        await db.query(`update public.client_integrations set sync_status = 'active' where client_id = '${client}' and service = 'bing'`);
        assert.equal((await db.query<{ queued: boolean }>('select public.enqueue_bing_sync($1,$2) as queued', [org, client])).rows[0].queued, true);
        assert.equal((await db.query<{ queued: boolean }>('select public.enqueue_bing_sync($1,$2) as queued', [org, client])).rows[0].queued, true);
        assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.bing_sync_jobs')).rows[0].n, 2);

        await db.query(`update public.bing_sync_jobs set updated_at = '2026-01-01T00:00:00Z' where client_id = '${client}'`);
        await db.query(`update public.bing_sync_jobs set updated_at = '2026-01-02T00:00:00Z' where client_id = '${second}'`);
        const first = (await db.query<{ id: string; client_id: string; status: string; attempts: number; lease_token: string }>(
            'select id::text, client_id::text, status, attempts, lease_token::text from public.claim_bing_sync()',
        )).rows[0];
        assert.equal(first.client_id, client);
        assert.equal(first.status, 'running');
        assert.equal(first.attempts, 1);
        assert.equal((await db.query('select * from public.claim_bing_sync($1)', [client])).rows.length, 0);
        assert.equal((await db.query<{ queued: boolean }>('select public.enqueue_bing_sync($1,$2) as queued', [org, client])).rows[0].queued, true);
        assert.equal((await db.query<{ status: string; attempts: number }>(
            `select status, attempts from public.bing_sync_jobs where id = '${first.id}'`,
        )).rows[0].status, 'running');

        await db.query(
            `update public.bing_sync_jobs set status = 'idle', available_at = now() + interval '30 days', lease_until = null where id = '${first.id}'`,
        );
        assert.equal((await db.query<{ queued: boolean }>('select public.enqueue_bing_sync($1,$2) as queued', [org, client])).rows[0].queued, true);
        assert.equal((await db.query<{ status: string }>(
            `select status from public.bing_sync_jobs where id = '${first.id}'`,
        )).rows[0].status, 'idle');
        await db.query(
            `update public.bing_sync_jobs set available_at = now() - interval '1 minute' where id = '${first.id}'`,
        );
        assert.equal((await db.query<{ queued: boolean }>('select public.enqueue_bing_sync($1,$2) as queued', [org, client])).rows[0].queued, true);
        assert.equal((await db.query<{ status: string }>(
            `select status from public.bing_sync_jobs where id = '${first.id}'`,
        )).rows[0].status, 'pending');

        const resumed = (await db.query<{ lease_token: string; attempts: number }>(
            'select lease_token::text, attempts from public.claim_bing_sync($1)',
            [client],
        )).rows[0];
        await db.query(`update public.bing_sync_jobs set lease_until = now() - interval '1 second' where client_id = '${client}'`);
        const expired = (await db.query<{ lease_token: string; attempts: number }>(
            `select lease_token::text, attempts from public.claim_bing_sync($1)`,
            [client],
        )).rows[0];
        assert.equal(expired.attempts, resumed.attempts + 1);
        assert.notEqual(expired.lease_token, resumed.lease_token);

        await db.query(
            `update public.client_integrations set credentials = '{"site_url":"https://moved.example/"}' where client_id = '${client}' and service = 'bing'`,
        );
        assert.equal((await db.query('select * from public.claim_bing_sync($1)', [client])).rows.length, 0);

        await db.exec('reset role');
        await db.exec('set role authenticated');
        await assert.rejects(db.query('select public.enqueue_bing_sync($1,$2)', [org, client]), /permission denied/);
        await assert.rejects(db.query('select * from public.claim_bing_sync()'), /permission denied/);
        await assert.rejects(db.query('select * from public.bing_sync_jobs'), /permission denied/);
        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query('select public.replace_bing_snapshot($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb)', [
            org, client, site, '2026-10-08T00:00:00Z', '[]', '[]', '[]',
        ]), /permission denied/);
    } finally {
        await db.close();
    }
});

test('members can read their org Bing rows and cannot write them', async () => {
    const { db, before } = await database();
    try {
        await db.exec('set role service_role');
        await db.query(
            `insert into public.client_integrations(organization_id, client_id, service, sync_status, credentials)
             values ($1, $2, 'bing', 'active', '{"site_url":"https://example.com/"}')`,
            [org, client],
        );
        await replace(db, {
            traffic: [{ data_date: '2026-10-03', clicks: 0, impressions: 2 }],
            queries: [{ week_ending: '2026-10-04', query: 'alpha', clicks: 0, impressions: 2, avg_impression_position: null, avg_click_position: null }],
            pages: [{ week_ending: '2026-10-04', page: 'https://example.com/a', clicks: 0, impressions: 2, avg_impression_position: null, avg_click_position: null }],
        });
        await db.exec('reset role');
        await db.exec(`select set_config('test.org', '${org}', false)`);
        await db.exec('set role authenticated');
        assert.equal((await db.query<{ clicks: number }>('select clicks::int from public.bing_traffic_days')).rows[0].clicks, 0);
        assert.equal((await db.query('select query from public.bing_query_weeks')).rows.length, 1);
        assert.equal((await db.query('select page from public.bing_page_weeks')).rows.length, 1);
        await assert.rejects(
            db.query(`insert into public.bing_traffic_days(organization_id, client_id, site_url, data_date, clicks, impressions, queries_complete, pages_complete, fetched_at)
                      values ('${org}', '${client}', 'https://example.com/', '2026-10-04', 1, 1, true, true, now())`),
            /permission denied/,
        );
        await db.exec('reset role');
        await db.exec(`select set_config('test.org', '${otherOrg}', false)`);
        await db.exec('set role authenticated');
        assert.equal((await db.query('select * from public.bing_traffic_days')).rows.length, 0);
        assert.equal((await db.query('select * from public.bing_query_weeks')).rows.length, 0);
        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query('select * from public.bing_traffic_days'), /permission denied/);
        await db.exec('reset role');
        assert.deepEqual(await googleRow(db), before);
    } finally {
        await db.close();
    }
});
