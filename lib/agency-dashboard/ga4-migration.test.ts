import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { attachGa4Dashboard, parseGa4Aggregate } from './ga4.ts';
import { NOT_ENOUGH_HISTORY } from './portfolio.ts';

const migration = readFileSync(new URL('../../migrations/098_agency_dashboard_ga4.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const active = '33333333-3333-4333-8333-333333333333';
const empty = '44444444-4444-4444-8444-444444444444';
const zeroed = '55555555-5555-4555-8555-555555555555';
const paused = '66666666-6666-4666-8666-666666666666';
const plain = '77777777-7777-4777-8777-777777777777';
const otherClient = '88888888-8888-4888-8888-888888888888';

test('migration 098 is a service-role function only and is mirrored into schema.sql', () => {
    assert.equal(migration.includes('Not applied in this change.'), true);
    assert.equal(migration.includes('security invoker'), true);
    assert.equal(/security definer/i.test(migration), false);
    assert.equal(/coalesce\s*\(\s*organic_sessions\s*,\s*0\s*\)/i.test(migration), false);
    assert.equal(/default\s+0/i.test(migration), false);
    assert.match(migration, /credentials->>'property_id' ~ '\^properties\/\[0-9\]\+\$'/);
    assert.match(migration, /revoke all on function public\.agency_dashboard_ga4\(uuid, date, date, date, date, text\) from public, anon, authenticated/);
    assert.match(migration, /grant execute on function public\.agency_dashboard_ga4\(uuid, date, date, date, date, text\) to service_role/);
    assert.equal(/to authenticated/i.test(migration), false);
    assert.equal(schema.includes('create or replace function public.agency_dashboard_ga4'), true);
});

test('ga4 totals keep nulls, keep a measured zero, and skip unmapped clients', async () => {
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
            create table public.ga4_history_days(
                id uuid primary key,
                organization_id uuid not null,
                client_id uuid not null,
                property text not null,
                day date not null
            );
            create table public.ga4_daily(
                day_id uuid primary key references public.ga4_history_days(id),
                organic_sessions double precision,
                sessions double precision,
                engaged_sessions double precision,
                key_events double precision
            );
        `);
        await db.exec(migration);
        await db.exec(`
            insert into public.clients(id, organization_id, name, status) values
                ('${active}', '${org}', 'Active', 'active'),
                ('${empty}', '${org}', 'Empty', 'active'),
                ('${zeroed}', '${org}', 'Zero', 'active'),
                ('${paused}', '${org}', 'Paused', 'paused'),
                ('${plain}', '${org}', 'Plain', 'active'),
                ('${otherClient}', '${other}', 'Other', 'active');
        `);
        await db.query(
            `insert into public.client_integrations(client_id, organization_id, service, sync_status, credentials) values
                ($1, $2, 'ga4', 'active', '{"property_id":"properties/1"}'),
                ($3, $2, 'ga4', 'active', '{"property_id":"properties/2"}'),
                ($4, $2, 'ga4', 'active', '{"property_id":"properties/3"}'),
                ($5, $2, 'ga4', 'active', '{"property_id":"properties/4"}'),
                ($7, $6, 'ga4', 'active', '{"property_id":"properties/9"}')`,
            [active, org, empty, zeroed, paused, other, otherClient],
        );

        async function day(id: string, client: string, property: string, date: string, organization = org) {
            await db.query(
                `insert into public.ga4_history_days(id, organization_id, client_id, property, day) values ($1,$2,$3,$4,$5)`,
                [id, organization, client, property, date],
            );
        }
        async function metrics(dayId: string, organic: number | null, sessions: number | null, engaged: number | null, keyEvents: number | null) {
            await db.query(
                `insert into public.ga4_daily(day_id, organic_sessions, sessions, engaged_sessions, key_events) values ($1,$2,$3,$4,$5)`,
                [dayId, organic, sessions, engaged, keyEvents],
            );
        }

        await day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', active, 'properties/1', '2026-10-07');
        await day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', active, 'properties/1', '2026-10-06');
        await day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', active, 'properties/1', '2026-10-05');
        await day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', active, 'properties/1', '2026-10-04');
        await day('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', active, 'properties/999', '2026-10-07');
        await metrics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 10, 20, 8, 2);
        await metrics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', null, 4, 1, null);
        await metrics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 5, 10, 5, 1);
        await metrics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 5, 10, 5, 1);
        await metrics('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 999, 999, 999, 999);

        await day('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', empty, 'properties/2', '2026-10-07');
        await metrics('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', null, null, null, null);

        await day('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', zeroed, 'properties/3', '2026-10-07');
        await metrics('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 0, 0, 0, 0);

        await day('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', paused, 'properties/4', '2026-10-07');
        await metrics('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 999, 999, 999, 999);
        await day('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', otherClient, 'properties/9', '2026-10-07', other);
        await metrics('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 999, 999, 999, 999);

        const raw = await db.query<{ agency_dashboard_ga4: unknown }>(
            'select public.agency_dashboard_ga4($1,$2,$3,$4,$5,$6)',
            [org, '2026-10-06', '2026-10-07', '2026-10-04', '2026-10-05', 'day'],
        );
        const payload = typeof raw.rows[0].agency_dashboard_ga4 === 'string'
            ? JSON.parse(raw.rows[0].agency_dashboard_ga4)
            : raw.rows[0].agency_dashboard_ga4;
        const parsed = parseGa4Aggregate(payload);
        const ids = parsed.clients.map(row => row.clientId).sort();
        assert.deepEqual(ids, [active, empty, zeroed].sort());

        const measured = parsed.clients.find(row => row.clientId === active)!;
        assert.equal(measured.current?.organicSessions, 10);
        assert.equal(measured.current?.sessions, 24);
        assert.equal(measured.current?.engagedSessions, 9);
        assert.equal(measured.current?.keyEvents, 2);
        assert.equal(measured.current?.days, 2);
        assert.equal(measured.previous?.organicSessions, 10);
        assert.equal(measured.series.find(point => point.bucket === '2026-10-06')?.organicSessions, null);
        assert.equal(measured.series.find(point => point.bucket === '2026-10-06')?.keyEvents, null);
        assert.equal(measured.series.find(point => point.bucket === '2026-10-07')?.organicSessions, 10);

        const blanks = parsed.clients.find(row => row.clientId === empty)!;
        assert.equal(blanks.current?.organicSessions, null);
        assert.equal(blanks.current?.sessions, null);
        assert.equal(blanks.current?.days, 1);

        const zeros = parsed.clients.find(row => row.clientId === zeroed)!;
        assert.equal(zeros.current?.organicSessions, 0);
        assert.equal(zeros.current?.sessions, 0);
        assert.equal(zeros.current?.keyEvents, 0);

        const full = attachGa4Dashboard({
            buckets: ['2026-10-06', '2026-10-07'],
            cards: [
                { clientId: active, name: 'Active' },
                { clientId: empty, name: 'Empty' },
                { clientId: zeroed, name: 'Zero' },
                { clientId: plain, name: 'Plain' },
            ],
        }, {
            links: [
                { clientId: active, property: 'properties/1' },
                { clientId: empty, property: 'properties/2' },
                { clientId: zeroed, property: 'properties/3' },
            ],
            aggregate: parsed,
            expectedPreviousDays: 2,
        });
        assert.equal(full.cards[0].ga4?.metrics.organicSessions.change, 0);
        assert.equal(full.cards[0].ga4?.metrics.engagementRate.value, 9 / 24);
        assert.equal(full.cards[1].ga4?.metrics.organicSessions.value, null);
        assert.equal(full.cards[2].ga4?.metrics.organicSessions.value, 0);
        assert.equal(full.cards[2].ga4?.metrics.engagementRate.value, null);
        assert.equal(full.cards[3].ga4?.mapped, false);

        const short = attachGa4Dashboard({
            buckets: ['2026-10-06', '2026-10-07'],
            cards: [{ clientId: active, name: 'Active' }],
        }, {
            links: [{ clientId: active, property: 'properties/1' }],
            aggregate: parsed,
            expectedPreviousDays: 7,
        });
        assert.equal(short.cards[0].ga4?.metrics.organicSessions.change, null);
        assert.equal(short.cards[0].ga4?.changeNote, NOT_ENOUGH_HISTORY);

        await assert.rejects(
            db.query('select public.agency_dashboard_ga4($1,$2,$3,$4,$5,$6)', [org, '2026-10-06', '2026-10-07', '2026-10-04', '2026-10-05', 'year']),
            /Invalid dashboard bucket/,
        );
        await db.exec('set role authenticated');
        await assert.rejects(
            db.query('select public.agency_dashboard_ga4($1,$2,$3,$4,$5,$6)', [org, '2026-10-06', '2026-10-07', '2026-10-04', '2026-10-05', 'day']),
            /permission denied/,
        );
        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(
            db.query('select public.agency_dashboard_ga4($1,$2,$3,$4,$5,$6)', [org, '2026-10-06', '2026-10-07', '2026-10-04', '2026-10-05', 'day']),
            /permission denied/,
        );
    } finally {
        await db.close();
    }
});
