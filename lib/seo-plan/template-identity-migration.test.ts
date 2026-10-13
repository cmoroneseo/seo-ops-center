import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { MARKETING_PLAN_STEPS, setupPlanItems, type ClientSetupInput } from '../client-setup.ts';

const migration064 = readFileSync(new URL('../../migrations/064_client_split_setup.sql', import.meta.url), 'utf8');
const migration065 = readFileSync(new URL('../../migrations/065_client_setup_permissions.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/087_seo_plan_template_identity.sql', import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000010';
const user = '00000000-0000-0000-0000-000000000001';
const client = '00000000-0000-0000-0000-000000000020';
const input: ClientSetupInput = {
    requestId: client,
    organizationId: org,
    name: 'Sandbox Client',
    website: '',
    accountManagerId: '',
    onboardingDate: '2020-01-01',
    launchDate: '',
    seoHours: 5,
    template: 'foundation',
    customItems: ['Fix critical redirects'],
    scope: { version: 1, mode: 'monthly', hoursMode: 'committed', contentPieces: 1, gbp: true, gbpUsesSeoHours: false, listings: true, onboardingBudget: 'separate' },
};

test('template identity stores the checklist once and does not rewrite existing rows', async () => {
    assert.doesNotMatch(migration, /update\s+public\.marketing_plan_items\s+set\s+template_key/i);
    assert.ok(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').includes(migration.trim()));
    const db = new PGlite();
    try {
        await db.exec(`create role authenticated; create role anon; create role service_role; alter default privileges grant execute on functions to anon; create schema auth;
            create function auth.uid() returns uuid language sql as $$select '${user}'::uuid$$;
            create table users(id uuid primary key, full_name text);
            create table organization_members(organization_id uuid, user_id uuid, role text);
            insert into users values ('${user}', 'Carlos'); insert into organization_members values ('${org}', '${user}', 'admin');
            create table clients(id uuid primary key, organization_id uuid, name text, domain text, account_manager_id uuid, account_manager_name text, launch_date date, seo_hours numeric, engagement_model text, status text, tier int, blogs_due_per_month numeric, campaign_end date, campaign_total_hours numeric);
            create table deliverable_commitments(id uuid default gen_random_uuid(), organization_id uuid, client_id uuid references clients(id), type text, title text, quantity_per_month numeric, cadence text, engagement_model text, starts_on date, is_active boolean, counts_toward_hours boolean, custom_fields jsonb);
            create table marketing_plans(id uuid default gen_random_uuid() primary key, organization_id uuid, client_id uuid references clients(id) unique, title text, steps jsonb);
            create table tasks(id uuid primary key, organization_id uuid, client_id uuid, title text, description text, priority text, status text, due_date date);
            create table marketing_plan_items(marketing_plan_id uuid references marketing_plans(id), organization_id uuid, client_id uuid references clients(id), step_key text, title text, description text, priority text, status text, due_date date, task_id uuid, sort_order int, is_custom boolean, roadmap_included boolean, roadmap_phase text check(roadmap_phase in ('onboarding','backlog')));
            grant usage on schema public, auth to authenticated; grant select, insert, update on all tables in schema public to authenticated;
        `);
        await db.exec(migration064);
        await db.exec(migration065);
        await db.exec(migration);
        await db.exec('set role authenticated');
        const query = 'select create_client_with_setup($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as id';
        const checklist = setupPlanItems(input, { v2: true });
        const args = [client, org, input.name, null, user, input.onboardingDate, null, 5, input.scope, MARKETING_PLAN_STEPS, checklist];
        await db.query(query, args);
        const rows = await db.query<{ title: string; template_key: string | null; source: string }>(
            'select title, template_key, source from marketing_plan_items order by sort_order',
        );
        assert.equal(rows.rows.length, 10);
        assert.equal(rows.rows.filter(row => row.title === 'Connect GA4 and Search Console').length, 1);
        assert.equal(rows.rows.some(row => row.title === 'Connect Google Search Console' || row.title === 'Connect Google Analytics 4'), false);
        assert.equal(rows.rows.filter(row => row.source === 'onboarding').length, 9);
        assert.equal(rows.rows.find(row => row.title === 'Fix critical redirects')?.source, 'custom');
        assert.equal(rows.rows.find(row => row.title === 'Fix critical redirects')?.template_key, null);
        const second = '00000000-0000-0000-0000-000000000021';
        await db.query(query, [second, ...args.slice(1)]);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from clients')).rows[0].n, 2);
        const duplicate = [checklist[0], checklist[0]];
        await assert.rejects(
            db.query(query, ['00000000-0000-0000-0000-000000000022', ...args.slice(1, 10), duplicate]),
            /marketing_plan_items_template_key_unique/,
        );
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from clients')).rows[0].n, 2);
        const invalid = [{ ...checklist[0], source: 'imported' }];
        await assert.rejects(
            db.query(query, ['00000000-0000-0000-0000-000000000023', ...args.slice(1, 10), invalid]),
            /Invalid plan item source/,
        );
        const plain = [{ title: 'One-off note', stepKey: 'setup', description: '', priority: 'medium', included: true, phase: 'onboarding', custom: true }];
        await db.query(query, ['00000000-0000-0000-0000-000000000024', ...args.slice(1, 10), plain]);
        const stored = await db.query<{ template_key: string | null; source: string }>(
            "select template_key, source from marketing_plan_items where title = 'One-off note'",
        );
        assert.equal(stored.rows[0].source, 'template');
        assert.equal(stored.rows[0].template_key, null);
        await db.exec('reset role; set role anon');
        await assert.rejects(db.query(query, args), /permission denied/);
    } finally {
        await db.close();
    }
});
