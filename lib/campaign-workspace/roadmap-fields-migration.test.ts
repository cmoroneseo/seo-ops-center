import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const base = readFileSync(new URL('../../migrations/116_campaign_initiatives.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/118_campaign_initiative_roadmap_fields.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const client = '33333333-3333-4333-8333-333333333333';

const EXAMPLE_TITLES = [
    'Technical SEO audit completed',
    'Google Business Profile optimized',
    'Pillar and cluster content expansion',
];

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
        create table public.clients(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id) on delete cascade,
            name text not null
        );
        insert into public.organizations values ('${org}');
        insert into public.clients values ('${client}', '${org}', 'Harbor Dental');
    `);
    await db.exec(base);
    await db.exec(migration);
    return db;
}

test('migration 118 is unapplied, mirrored, and does not import template rows or turn a flag on', () => {
    assert.equal(migration.includes('NOT APPLIED'), true);
    assert.equal(migration.includes('Not applied in this change'), true);
    assert.equal(/campaign_plans|tracked_keywords|public\.tasks|public\.deliverables/.test(migration), false);
    assert.equal(/insert into public\.campaign_initiatives/i.test(migration), false);
    assert.equal(/phase_progress|overall_progress|add column[^;]*progress/i.test(migration), false);
    assert.equal(migration.includes('NEXT_PUBLIC_'), false);
    for (const title of EXAMPLE_TITLES) assert.equal(migration.includes(title), false, title);
    assert.equal(schema.includes(migration.trim()), true);
    assert.match(envExample, /^NEXT_PUBLIC_CAMPAIGN_WORKSPACE=$/m);
    assert.match(envExample, /^NEXT_PUBLIC_KEYWORD_TRACKING=$/m);
    assert.equal(envExample.includes('NEXT_PUBLIC_CAMPAIGN_WORKSPACE=true'), false);
    assert.equal(envExample.includes('NEXT_PUBLIC_KEYWORD_TRACKING=true'), false);
});

test('phase, category, and target month are nullable closed sets and empty is not zero', async () => {
    const db = await database();
    try {
        const columns = await db.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
            `select column_name, data_type, is_nullable, column_default
             from information_schema.columns
             where table_schema = 'public' and table_name = 'campaign_initiatives'
               and (column_name in ('phase', 'category', 'target_month') or column_name like '%progress%')
             order by column_name`,
        );
        assert.deepEqual(columns.rows.map(row => row.column_name), ['category', 'phase', 'target_month']);
        for (const column of columns.rows) {
            assert.equal(column.is_nullable, 'YES');
            assert.equal(column.column_default, null);
        }
        assert.equal(columns.rows.find(row => row.column_name === 'target_month')?.data_type, 'smallint');

        const created = await db.query<{ phase: string | null; category: string | null; target_month: number | null }>(
            `insert into public.campaign_initiatives (organization_id, client_id, title, state)
             values ($1, $2, 'Coverage page rewrite', 'planned')
             returning phase, category, target_month`,
            [org, client],
        );
        assert.equal(created.rows[0].phase, null);
        assert.equal(created.rows[0].category, null);
        assert.equal(created.rows[0].target_month, null);

        const saved = await db.query<{ phase: string; category: string; target_month: number }>(
            `update public.campaign_initiatives
             set phase = 'growth', category = 'analytics_reporting', target_month = 2
             where client_id = $1
             returning phase, category, target_month`,
            [client],
        );
        assert.equal(saved.rows[0].phase, 'growth');
        assert.equal(saved.rows[0].category, 'analytics_reporting');
        assert.equal(saved.rows[0].target_month, 2);

        const cleared = await db.query<{ phase: string | null; category: string | null; target_month: string | null }>(
            `update public.campaign_initiatives
             set phase = null, category = null, target_month = null
             where client_id = $1
             returning phase, category, target_month`,
            [client],
        );
        assert.equal(cleared.rows[0].phase, null);
        assert.equal(cleared.rows[0].category, null);
        assert.equal(cleared.rows[0].target_month, null);

        for (const [column, value] of [
            ['phase', ''],
            ['phase', 'Phase 1 · Foundation'],
            ['phase', '0'],
            ['category', 'Technical'],
            ['category', 'SEO'],
        ] as const) {
            await assert.rejects(
                db.query(`update public.campaign_initiatives set ${column} = $1 where client_id = $2`, [value, client]),
                /check/i,
            );
        }
        await assert.rejects(
            db.query('update public.campaign_initiatives set target_month = 0 where client_id = $1', [client]),
            /check/i,
        );
        await assert.rejects(
            db.query('update public.campaign_initiatives set target_month = 13 where client_id = $1', [client]),
            /check/i,
        );
        await assert.rejects(
            db.query(`update public.campaign_initiatives set target_month = 'Month 3' where client_id = $1`, [client]),
            /smallint|integer|invalid/i,
        );

        const count = await db.query<{ n: number }>('select count(*)::int as n from public.campaign_initiatives');
        assert.equal(count.rows[0].n, 1);
    } finally {
        await db.close();
    }
});
