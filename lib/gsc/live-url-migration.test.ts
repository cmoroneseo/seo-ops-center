import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/108_gsc_live_url_results.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';

async function database() {
    const db = new PGlite();
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
            name text not null
        );
        create table public.client_integrations(
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            client_id uuid not null,
            service text not null,
            sync_status text not null default 'active',
            credentials jsonb not null default '{}'::jsonb
        );
        insert into public.organizations values ('${org}'), ('${other}');
        insert into public.clients values ('${client}', '${org}', 'Scott Cole');
        insert into public.client_integrations(organization_id, client_id, service, sync_status, credentials)
        values ('${org}', '${client}', 'gsc', 'active', '{"site_url":"sc-domain:example.com"}');
        grant select on public.clients, public.client_integrations to service_role;
    `);
    await db.exec(migration);
    return db;
}

test('migration 108 is idempotent, org-scoped, and service-role only on write', async () => {
    assert.equal(schema.includes('gsc_live_url_days'), true);
    assert.equal(schema.includes('replace_gsc_live_url'), true);
    const db = await database();
    try {
        await db.exec(migration);
        const tables = await db.query<{ table_name: string }>(
            `select table_name from information_schema.tables
             where table_schema = 'public' and table_name like 'gsc_live_url_%'
             order by table_name`,
        );
        assert.deepEqual(tables.rows.map(row => row.table_name), [
            'gsc_live_url_checks',
            'gsc_live_url_days',
            'gsc_live_url_queries',
        ]);
        const policies = await db.query<{ polname: string; tablename: string }>(
            `select pol.polname, cls.relname as tablename
             from pg_policy pol
             join pg_class cls on cls.oid = pol.polrelid
             where cls.relname like 'gsc_live_url_%'
             order by cls.relname`,
        );
        assert.equal(policies.rows.length, 3);

        await db.exec('set role service_role');
        await db.query(
            `select public.replace_gsc_live_url($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
            [
                org,
                client,
                'sc-domain:example.com',
                'example.com/chino',
                '2026-10-08',
                '2026-10-05',
                '2026-10-10',
                '2026-10-08',
                '2026-10-10',
                '2026-10-10T18:00:00Z',
                JSON.stringify([{ data_date: '2026-10-08', clicks: 4, impressions: 20, position: 3.5 }]),
                JSON.stringify([{ query: 'chino plumber', clicks: 3, impressions: 10, position: 2 }]),
            ],
        );
        await db.query(
            `select public.replace_gsc_live_url($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)`,
            [
                org,
                client,
                'sc-domain:example.com',
                'example.com/chino',
                '2026-10-08',
                '2026-10-05',
                '2026-10-10',
                '2026-10-08',
                '2026-10-10',
                '2026-10-10T19:00:00Z',
                JSON.stringify([]),
                JSON.stringify([]),
            ],
        );
        const replaced = await db.query<{ has_rows: boolean; days: number; queries: number }>(
            `select c.has_rows,
                    (select count(*)::int from public.gsc_live_url_days) as days,
                    (select count(*)::int from public.gsc_live_url_queries) as queries
             from public.gsc_live_url_checks c`,
        );
        assert.equal(replaced.rows[0].has_rows, false);
        assert.equal(replaced.rows[0].days, 0);
        assert.equal(replaced.rows[0].queries, 0);

        await db.exec('reset role');
        await db.exec(`select set_config('test.org', '${org}', false)`);
        await db.exec('set role authenticated');
        assert.equal((await db.query(`select * from public.gsc_live_url_checks`)).rows.length, 1);
        await assert.rejects(
            db.query(`insert into public.gsc_live_url_days(organization_id, client_id, property, url_key, data_date, clicks, impressions, position, fetched_at)
                      values ('${org}', '${client}', 'sc-domain:example.com', 'example.com/chino', '2026-10-08', 1, 1, 1, now())`),
            /permission denied/,
        );
        await assert.rejects(
            db.query(`select public.replace_gsc_live_url('${org}','${client}','sc-domain:example.com','example.com/chino','2026-10-08','2026-10-08','2026-10-10','2026-10-08','2026-10-10',now(),'[]'::jsonb,'[]'::jsonb)`),
            /permission denied/,
        );

        await db.exec('reset role');
        await db.exec(`select set_config('test.org', '${other}', false)`);
        await db.exec('set role authenticated');
        assert.equal((await db.query(`select * from public.gsc_live_url_checks`)).rows.length, 0);
        assert.equal((await db.query(`select * from public.gsc_live_url_days`)).rows.length, 0);

        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query(`select * from public.gsc_live_url_checks`), /permission denied/);
    } finally {
        await db.close();
    }
});
