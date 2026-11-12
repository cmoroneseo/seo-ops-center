import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const base = readFileSync(new URL('../../migrations/125_seo_change_log.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/129_seo_change_group_tests.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const client = '33333333-3333-4333-8333-333333333333';

test('migration 129 is unapplied, mirrored, and inserts nothing', () => {
    assert.equal(migration.includes('NOT APPLIED'), true);
    assert.equal(migration.includes('Not applied in this change'), true);
    assert.equal(schema.includes(migration.trim()), true);
    assert.equal(/insert into public\.seo_changes/i.test(migration), false);
    assert.equal(/ecoworkz/i.test(migration), false);
    assert.equal(migration.includes("'split'"), false);
});

test('a group row stores a treatment, and a single row stays empty', async () => {
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
        insert into public.clients values ('${client}', '${org}', 'Example');
    `);
    await db.exec(base);
    await db.exec(migration);
    await db.exec(`
        insert into public.seo_changes (
            organization_id, client_id, change_type, title, live_at, approved_by_name, kpi
        ) values (
            '${org}', '${client}', 'h1', 'One page', '2026-11-10T22:04:00Z', 'Carlos', 'clicks'
        );
    `);
    const single = await db.query<{ test_kind: string; treatment: string }>(
        'select test_kind, treatment from public.seo_changes',
    );
    assert.equal(single.rows[0].test_kind, 'single');
    assert.equal(single.rows[0].treatment, '');

    await db.exec(`
        insert into public.seo_changes (
            organization_id, client_id, change_type, title, live_at, approved_by_name, kpi,
            test_kind, treatment
        ) values (
            '${org}', '${client}', 'other', 'Title and meta description format',
            '2026-09-15T16:00:00Z', 'Carlos', 'clicks', 'group', 'title_meta'
        );
    `);
    const groups = await db.query<{ n: number }>(
        "select count(*)::int as n from public.seo_changes where test_kind = 'group' and treatment = 'title_meta'",
    );
    assert.equal(groups.rows[0].n, 1);

    await assert.rejects(
        db.exec(`
            insert into public.seo_changes (
                organization_id, client_id, change_type, title, live_at, approved_by_name, kpi,
                test_kind, treatment
            ) values (
                '${org}', '${client}', 'h1', 'Split', '2026-09-15T16:00:00Z', 'Carlos', 'clicks', 'split', ''
            );
        `),
    );
    await assert.rejects(
        db.exec(`
            insert into public.seo_changes (
                organization_id, client_id, change_type, title, live_at, approved_by_name, kpi,
                test_kind, treatment
            ) values (
                '${org}', '${client}', 'h1', 'Group without a treatment',
                '2026-09-15T16:00:00Z', 'Carlos', 'clicks', 'group', ''
            );
        `),
    );
});
