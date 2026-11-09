import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/119_campaign_content_plan.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';

const CONTENT_COLUMNS = [
    'plan_month',
    'published_on',
    'status',
    'content_type',
    'title',
    'keyword',
    'search_volume',
    'keyword_difficulty',
    'due_on',
    'draft_url',
    'live_url',
    'matching_product',
    'internal_url',
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
        insert into public.organizations values ('${org}'), ('${other}');
        insert into public.clients values ('${client}', '${org}', 'Harbor Dental');
    `);
    await db.exec(migration);
    return db;
}

async function asOrg(db: PGlite, organizationId: string) {
    await db.exec('reset role');
    await db.exec(`select set_config('test.org', '${organizationId}', false)`);
    await db.exec('set role authenticated');
}

test('migration 119 is unapplied, mirrored, and does not seed or turn a flag on', () => {
    assert.equal(migration.includes('NOT APPLIED'), true);
    assert.equal(migration.includes('Not applied in this change'), true);
    assert.equal(/campaign_plans|campaign_initiatives|marketing_plan|public\.tasks|tracked_keywords/.test(migration), false);
    assert.equal(/insert into public\.campaign_content_plan/i.test(migration), false);
    assert.equal(/kitchen remodel/i.test(migration), false);
    assert.equal(/ahrefs|semrush/i.test(migration), false);
    assert.equal(/phase_progress|overall_progress|on track/i.test(migration), false);
    assert.equal(migration.includes('NEXT_PUBLIC_'), false);
    assert.equal(schema.includes(migration.trim()), true);
    assert.match(envExample, /^NEXT_PUBLIC_CAMPAIGN_WORKSPACE=$/m);
    assert.match(envExample, /^NEXT_PUBLIC_KEYWORD_TRACKING=$/m);
    assert.equal(envExample.includes('NEXT_PUBLIC_CAMPAIGN_WORKSPACE=true'), false);
    assert.equal(envExample.includes('NEXT_PUBLIC_KEYWORD_TRACKING=true'), false);
    assert.equal(vercel.includes('CAMPAIGN_WORKSPACE'), false);
    assert.equal(vercel.includes('KEYWORD_TRACKING'), false);
});

test('content plan columns are nullable except title and work month, and published is not a verified win', async () => {
    const db = await database();
    try {
        const empty = await db.query<{ n: number }>('select count(*)::int as n from public.campaign_content_plan');
        assert.equal(empty.rows[0].n, 0);

        const columns = await db.query<{ column_name: string; is_nullable: string; column_default: string | null }>(
            `select column_name, is_nullable, column_default
             from information_schema.columns
             where table_schema = 'public' and table_name = 'campaign_content_plan'
               and column_name = any($1)
             order by column_name`,
            [CONTENT_COLUMNS],
        );
        assert.deepEqual(columns.rows.map(column => column.column_name), [...CONTENT_COLUMNS].sort());
        for (const column of columns.rows) {
            if (column.column_name === 'title' || column.column_name === 'plan_month') {
                assert.equal(column.is_nullable, 'NO', column.column_name);
            } else {
                assert.equal(column.is_nullable, 'YES', column.column_name);
            }
            assert.equal(column.column_default, null, column.column_name);
        }
        const extras = await db.query<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = 'campaign_content_plan'
               and column_name in ('target_month', 'initiative_id', 'pillar_id', 'task_id', 'progress')`,
        );
        assert.deepEqual(extras.rows, []);

        const created = await db.query<{
            status: string | null;
            content_type: string | null;
            search_volume: number | null;
            keyword_difficulty: number | null;
            draft_url: string | null;
            live_url: string | null;
            internal_url: string | null;
            published_on: string | null;
            due_on: string | null;
        }>(
            `insert into public.campaign_content_plan (organization_id, client_id, plan_month, title, status)
             values ($1, $2, '2026-10', 'Emergency service page', 'published')
             returning status, content_type, search_volume, keyword_difficulty, draft_url, live_url, internal_url, published_on, due_on`,
            [org, client],
        );
        assert.equal(created.rows[0].status, 'published');
        assert.equal(created.rows[0].content_type, null);
        assert.equal(created.rows[0].search_volume, null);
        assert.equal(created.rows[0].keyword_difficulty, null);
        assert.equal(created.rows[0].draft_url, null);
        assert.equal(created.rows[0].live_url, null);
        assert.equal(created.rows[0].internal_url, null);
        assert.equal(created.rows[0].published_on, null);
        assert.equal(created.rows[0].due_on, null);

        await assert.rejects(
            db.query(
                `insert into public.campaign_content_plan (organization_id, client_id, plan_month, title, status)
                 values ($1, $2, 'October 2026', 'Bad month', 'idea')`,
                [org, client],
            ),
            /check/i,
        );
        await assert.rejects(
            db.query(
                `insert into public.campaign_content_plan (organization_id, client_id, plan_month, title, status, content_type)
                 values ($1, $2, '2026-10', 'Bad labels', 'Published', 'Blog Post')`,
                [org, client],
            ),
            /check/i,
        );

        const dated = await db.query<{ published_on: string; due_on: string }>(
            `update public.campaign_content_plan
             set published_on = '2026-11-02', due_on = '2026-10-20', keyword = 'emergency dentist',
                 search_volume = 0, keyword_difficulty = 0, content_type = 'service_page',
                 draft_url = 'https://docs.example/draft', live_url = 'http://harbor.example/services',
                 internal_url = 'https://harbor.example/related', matching_product = 'Emergency visit'
             where client_id = $1
             returning published_on::text, due_on::text`,
            [client],
        );
        assert.equal(dated.rows[0].published_on, '2026-11-02');
        assert.equal(dated.rows[0].due_on, '2026-10-20');

        for (const [column, value] of [
            ['status', 'Published'],
            ['status', 'Idea'],
            ['status', 'completed_verified'],
            ['content_type', 'Blog Post'],
            ['content_type', 'Pillar Page'],
            ['draft_url', 'javascript:alert(1)'],
            ['live_url', '/services'],
            ['keyword_difficulty', '101'],
            ['search_volume', '-1'],
        ] as const) {
            await assert.rejects(
                db.query(`update public.campaign_content_plan set ${column} = $1 where client_id = $2`, [value, client]),
                /check|invalid/i,
            );
        }
        for (const month of ['3', 'October 2026', '2026-13', '2026-11']) {
            await assert.rejects(
                db.query(`update public.campaign_content_plan set plan_month = $1 where client_id = $2`, [month, client]),
                /work month/i,
            );
        }
        await assert.rejects(
            db.query(
                `insert into public.campaign_content_plan (organization_id, client_id, plan_month, title)
                 values ($1, $2, '2026-10', 'Wrong org')`,
                [other, client],
            ),
            /does not belong/i,
        );

        const count = await db.query<{ n: number; example: number }>(
            `select count(*)::int as n,
                    count(*) filter (where title ilike '%kitchen remodel%')::int as example
             from public.campaign_content_plan`,
        );
        assert.equal(count.rows[0].n, 1);
        assert.equal(count.rows[0].example, 0);

        await asOrg(db, other);
        assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.campaign_content_plan')).rows[0].n, 0);
        await db.exec('reset role');
        await db.exec('set role anon');
        await assert.rejects(db.query('select * from public.campaign_content_plan'), /permission denied/);
    } finally {
        await db.close();
    }
});
