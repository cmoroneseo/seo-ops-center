import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

import { normalizeTrackerQuery } from '../search-reporting/tracker';

const migration = readFileSync(new URL('../../migrations/115_keyword_tracking.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
const otherClient = '44444444-4444-4444-8444-444444444444';
const author = '55555555-5555-4555-8555-555555555555';

const tables = [
    'tracking_targets',
    'tracked_keywords',
    'client_brand_terms',
    'tracking_notes',
] as const;

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create function public.get_user_org_ids() returns setof uuid
        language sql stable security definer as $$
          select nullif(current_setting('test.org', true), '')::uuid
        $$;
        create table public.organizations(id uuid primary key);
        create table public.users(id uuid primary key);
        create table public.clients(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id) on delete cascade,
            name text not null
        );
        insert into public.organizations values ('${org}'), ('${other}');
        insert into public.users values ('${author}');
        insert into public.clients values
            ('${client}', '${org}', 'Org A'),
            ('${otherClient}', '${other}', 'Org B');
    `);
    await db.exec(migration);
    return db;
}

async function asOrg(db: PGlite, organizationId: string) {
    await db.exec('reset role');
    await db.exec(`select set_config('test.org', '${organizationId}', false)`);
    await db.exec('set role authenticated');
}

test('migration 115 is unapplied, mirrored, and does not turn the flag on', () => {
    assert.equal(migration.includes('NOT APPLIED'), true);
    assert.equal(migration.includes('Not applied in this change'), true);
    assert.equal(migration.includes('TODO(PR 1.3)'), true);
    assert.equal(/after insert on public\.clients/i.test(migration), false);
    assert.equal(/semrush/i.test(migration), false);
    assert.equal(schema.includes(migration.trim()), true);
    assert.match(envExample, /^NEXT_PUBLIC_KEYWORD_TRACKING=$/m);
    assert.equal(envExample.includes('NEXT_PUBLIC_KEYWORD_TRACKING=true'), false);
});

test('an organization cannot read another organization, and nothing is seeded', async () => {
    const db = await database();
    try {
        await db.exec(migration);
        const empty = await db.query<{ n: number }>(
            `select (
                (select count(*) from public.tracking_targets)
                + (select count(*) from public.tracked_keywords)
                + (select count(*) from public.client_brand_terms)
                + (select count(*) from public.tracking_notes)
            )::int as n`,
        );
        assert.equal(empty.rows[0].n, 0);
        const clientTriggers = await db.query<{ tgname: string }>(
            `select tg.tgname
             from pg_trigger tg
             join pg_class cls on cls.oid = tg.tgrelid
             join pg_namespace nsp on nsp.oid = cls.relnamespace
             where nsp.nspname = 'public' and cls.relname = 'clients' and not tg.tgisinternal`,
        );
        assert.deepEqual(clientTriggers.rows, []);

        const target = await db.query<{ id: string }>(
            `insert into public.tracking_targets (organization_id, client_id, label, engine)
             values ($1, $2, 'GSC (all locations/devices)', 'gsc')
             returning id`,
            [org, client],
        );
        const targetId = target.rows[0].id;
        await db.query(
            `insert into public.tracked_keywords (organization_id, client_id, target_id, keyword, source)
             values ($1, $2, $3, 'seo agency', 'paste')`,
            [org, client, targetId],
        );
        await db.query(
            `insert into public.client_brand_terms (organization_id, client_id, term, kind)
             values ($1, $2, 'Marketing Empire', 'brand')`,
            [org, client],
        );
        await db.query(
            `insert into public.tracking_notes (organization_id, client_id, target_id, kind, body, created_by)
             values ($1, $2, $3, 'keywords_changed', 'Tracked seo agency.', $4)`,
            [org, client, targetId, author],
        );

        await asOrg(db, org);
        for (const table of tables) {
            const own = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
            assert.equal(own.rows[0].n, 1, table);
        }

        await asOrg(db, other);
        for (const table of tables) {
            const hidden = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
            assert.equal(hidden.rows[0].n, 0, table);
        }
        const planted = await db.query<{ id: string }>(
            `update public.tracking_targets set label = 'stolen' where organization_id = $1 returning id`,
            [org],
        );
        assert.equal(planted.rows.length, 0);
        await assert.rejects(
            db.query(
                `insert into public.tracking_targets (organization_id, client_id, label, engine)
                 values ($1, $2, 'GSC (all locations/devices)', 'gsc')`,
                [org, client],
            ),
            /row-level security/,
        );

        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query('select * from public.tracking_targets'), /permission denied/);
        await assert.rejects(db.query('select * from public.tracked_keywords'), /permission denied/);
        await assert.rejects(db.query('select * from public.client_brand_terms'), /permission denied/);
        await assert.rejects(db.query('select * from public.tracking_notes'), /permission denied/);
    } finally {
        await db.close();
    }
});

test('targets keep their dimensions, keywords dedupe on the tracker key, and a client delete cascades', async () => {
    const db = await database();
    try {
        const samples = ['  SEO   Agency  ', 'SEO\tAgency', 'Marketing\nEmpire', 'already-normal'];
        for (const sample of samples) {
            const sqlKey = await db.query<{ key: string }>(
                'select public.normalize_tracker_query($1) as key',
                [sample],
            );
            assert.equal(sqlKey.rows[0].key, normalizeTrackerQuery(sample));
        }

        await asOrg(db, org);
        const gsc = await db.query<{ id: string }>(
            `insert into public.tracking_targets (organization_id, client_id, label, engine)
             values ($1, $2, 'GSC (all locations/devices)', 'gsc')
             returning id`,
            [org, client],
        );
        const gscId = gsc.rows[0].id;
        await assert.rejects(
            db.query(
                `insert into public.tracking_targets (organization_id, client_id, label, engine, device)
                 values ($1, $2, 'GSC mobile', 'gsc', 'mobile')`,
                [org, client],
            ),
            /check|violates/,
        );
        await assert.rejects(
            db.query(
                `insert into public.tracking_targets (organization_id, client_id, label, engine)
                 values ($1, $2, 'Second GSC', 'gsc')`,
                [org, client],
            ),
            /duplicate key|unique/i,
        );
        await assert.rejects(
            db.query(`delete from public.tracking_targets where id = $1`, [gscId]),
            /permission denied/,
        );
        await assert.rejects(
            db.query(
                `update public.tracking_targets set device = 'mobile' where id = $1`,
                [gscId],
            ),
            /dimensions are fixed/,
        );

        const city = await db.query<{ id: string }>(
            `insert into public.tracking_targets
                (organization_id, client_id, label, engine, device, location_name, language_code)
             values ($1, $2, 'Riverside mobile', 'google', 'mobile', 'Riverside', 'en')
             returning id`,
            [org, client],
        );
        const cityId = city.rows[0].id;
        await db.query(`update public.tracking_targets set retired_at = now() where id = $1`, [cityId]);
        await db.query(
            `insert into public.tracking_targets
                (organization_id, client_id, label, engine, device, location_name, language_code)
             values ($1, $2, 'Moreno Valley mobile', 'google', 'mobile', 'Moreno Valley', 'en')`,
            [org, client],
        );

        await db.query(
            `insert into public.tracked_keywords (organization_id, client_id, target_id, keyword, tags, source)
             values ($1, $2, $3, '  SEO   Agency  ', '{brand,core}', 'gsc_promote')`,
            [org, client, gscId],
        );
        const stored = await db.query<{ normalized_key: string; is_branded_override: boolean | null }>(
            `select normalized_key, is_branded_override from public.tracked_keywords where target_id = $1`,
            [gscId],
        );
        assert.equal(stored.rows[0].normalized_key, 'seo agency');
        assert.equal(stored.rows[0].is_branded_override, null);
        await assert.rejects(
            db.query(
                `insert into public.tracked_keywords (organization_id, client_id, target_id, keyword, source)
                 values ($1, $2, $3, 'seo\tagency', 'paste')`,
                [org, client, gscId],
            ),
            /duplicate key|unique/i,
        );
        await assert.rejects(
            db.query(
                `insert into public.tracked_keywords (organization_id, client_id, target_id, keyword, source)
                 values ($1, $2, $3, 'semrush keyword', 'semrush')`,
                [org, client, gscId],
            ),
            /check|violates/,
        );
        await assert.rejects(
            db.query(
                `insert into public.tracked_keywords (organization_id, client_id, target_id, keyword, source)
                 values ($1, $2, $3, 'wrong client', 'research')`,
                [org, otherClient, gscId],
            ),
            /does not belong|foreign key|violates/,
        );

        await db.query(
            `insert into public.client_brand_terms (organization_id, client_id, term, kind)
             values ($1, $2, 'Marketing Empire', 'brand')`,
            [org, client],
        );
        await assert.rejects(
            db.query(
                `insert into public.client_brand_terms (organization_id, client_id, term, kind)
                 values ($1, $2, 'marketing   empire', 'product')`,
                [org, client],
            ),
            /duplicate key|unique/i,
        );
        await assert.rejects(
            db.query(
                `insert into public.client_brand_terms (organization_id, client_id, term, kind)
                 values ($1, $2, 'rival', 'competitor')`,
                [org, client],
            ),
            /check|violates/,
        );

        await db.query(
            `insert into public.tracking_notes (organization_id, client_id, kind, body)
             values ($1, $2, 'manual', 'Reviewed the list.')`,
            [org, client],
        );
        await assert.rejects(
            db.query(
                `insert into public.tracking_notes (organization_id, client_id, target_id, kind, body)
                 values ($1, $2, $3, 'method_changed', 'Moved the geo.')`,
                [other, otherClient, cityId],
            ),
            /row-level security|does not belong|foreign key|violates/,
        );

        await db.exec('reset role');
        await db.query('delete from public.clients where id = $1', [client]);
        const left = await db.query<{ n: number }>(
            `select (
                (select count(*) from public.tracking_targets)
                + (select count(*) from public.tracked_keywords)
                + (select count(*) from public.client_brand_terms)
                + (select count(*) from public.tracking_notes)
            )::int as n`,
        );
        assert.equal(left.rows[0].n, 0);
    } finally {
        await db.close();
    }
});
