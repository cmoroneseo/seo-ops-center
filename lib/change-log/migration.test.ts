import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/125_seo_change_log.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const client = '33333333-3333-4333-8333-333333333333';
const otherClient = '44444444-4444-4444-8444-444444444444';

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
        insert into public.clients values
            ('${client}', '${org}', 'Ecoworkz'),
            ('${otherClient}', '${other}', 'Other');
    `);
    await db.exec(migration);
    return db;
}

async function asOrg(db: PGlite, organizationId: string) {
    await db.exec('reset role');
    await db.exec(`select set_config('test.org', '${organizationId}', false)`);
    await db.exec('set role authenticated');
}

test('migration 125 is unapplied, mirrored, and inserts nothing', () => {
    assert.equal(migration.includes('NOT APPLIED'), true);
    assert.equal(migration.includes('Not applied in this change'), true);
    assert.equal(schema.includes(migration.trim()), true);
    assert.equal(/insert into public\.seo_changes/i.test(migration), false);
    assert.equal(/ecoworkz/i.test(migration), false);
    assert.equal(/semrush/i.test(migration), false);
    assert.equal(/ahrefs/i.test(migration), false);
});

test('a member can log a change in their org and cannot read another org', async () => {
    const db = await database();
    await asOrg(db, org);
    await db.exec(`
        insert into public.seo_changes (
            organization_id, client_id, change_type, title, before_text, after_text,
            live_at, approved_by_name, backup_reference, revert_instructions, kpi
        ) values (
            '${org}', '${client}', 'h1', 'Homepage H1', 'before', 'after',
            '2026-11-10T22:04:00Z', 'Carlos', 'Elementor template 11115', 'Set the widget back.', 'clicks'
        );
    `);
    const id = (await db.query<{ id: string }>('select id from public.seo_changes')).rows[0].id;
    await db.exec(`
        insert into public.seo_change_pages (change_id, organization_id, client_id, url, url_key, label, cms_page_id, cms_widget_id)
        values ('${id}', '${org}', '${client}', 'https://www.ecoworkz.net/', 'ecoworkz.net/', 'Homepage', '7901', '47eaa58');
        insert into public.seo_change_queries (change_id, organization_id, client_id, query, normalized_query)
        values ('${id}', '${org}', '${client}', 'corona landscaping', 'corona landscaping');
        insert into public.seo_change_baselines (change_id, organization_id, client_id, captured_at, status, gsc_connected, ga4_connected, payload, note)
        values ('${id}', '${org}', '${client}', now(), 'missing', false, false, '{}'::jsonb, 'No stored days');
    `);
    const mine = await db.query<{ n: number }>('select count(*)::int as n from public.seo_changes');
    assert.equal(mine.rows[0].n, 1);

    await asOrg(db, other);
    const hidden = await db.query<{ n: number }>(`
        select (
            (select count(*) from public.seo_changes)
            + (select count(*) from public.seo_change_pages)
            + (select count(*) from public.seo_change_queries)
            + (select count(*) from public.seo_change_baselines)
        )::int as n
    `);
    assert.equal(hidden.rows[0].n, 0);
    await assert.rejects(
        db.exec(`insert into public.seo_changes (organization_id, client_id, change_type, title, live_at, approved_by_name, kpi)
            values ('${org}', '${client}', 'h1', 'Nope', now(), 'Carlos', 'clicks')`),
    );
});

test('a bad type and a mismatched client are rejected', async () => {
    const db = await database();
    await asOrg(db, org);
    await assert.rejects(
        db.exec(`insert into public.seo_changes (organization_id, client_id, change_type, title, live_at, approved_by_name, kpi)
            values ('${org}', '${client}', 'semrush', 'Nope', now(), 'Carlos', 'clicks')`),
    );
    await db.exec(`insert into public.seo_changes (organization_id, client_id, change_type, title, live_at, approved_by_name, kpi)
        values ('${org}', '${client}', 'title', 'Title', now(), 'Carlos', 'ctr')`);
    const id = (await db.query<{ id: string }>('select id from public.seo_changes')).rows[0].id;
    await assert.rejects(
        db.exec(`insert into public.seo_change_pages (change_id, organization_id, client_id, url, url_key)
            values ('${id}', '${other}', '${otherClient}', 'https://example.com/', 'example.com/')`),
    );
});
