import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/077_report_versions_and_reviews.sql', import.meta.url), 'utf8');
const store = readFileSync(new URL('./version-store.ts', import.meta.url), 'utf8');
const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333';
const client = '44444444-4444-4444-8444-444444444444';
const report = '66666666-6666-4666-8666-666666666666';
const hash = 'a'.repeat(64);

test('the migration adds no rows and approval does not queue client email', () => {
    assert.equal(/insert\s+into\s+public\.report_versions/i.test(migration), false);
    assert.equal(/update\s+public\.reports/i.test(migration), false);
    assert.equal(store.includes('client_portal_email_queue'), false);
    assert.equal(store.includes('resend'), false);
    assert.equal(store.includes("from('client_portal_report_shares').insert"), false);
});

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create function public.get_user_org_ids() returns setof uuid language sql stable as $$
            select nullif(current_setting('test.org', true), '')::uuid
        $$;
        create table public.organizations(id uuid primary key);
        create table public.users(id uuid primary key);
        create table public.clients(id uuid primary key, organization_id uuid not null, created_at timestamptz not null default now());
        create table public.reports(
            id uuid primary key,
            organization_id uuid not null,
            client_id uuid,
            report_month text not null,
            title text not null,
            status text not null default 'draft'
        );
        create table public.client_portal_contacts(id uuid primary key, organization_id uuid not null, client_id uuid not null, revoked_at timestamptz);
        insert into public.organizations values ('${org}'), ('${other}');
        insert into public.users values ('${user}');
        insert into public.clients values ('${client}', '${org}');
        insert into public.reports values ('${report}', '${org}', '${client}', '2026-09', 'September', 'draft');
    `);
    await db.exec(migration);
    return db;
}

test('versions are immutable, reviews follow the state machine, and reads stay inside the organization', async () => {
    const db = await database();
    await assert.rejects(
        db.exec(`insert into public.report_versions (organization_id, client_id, report_id, version_no, content_hash, snapshot, reason)
            values ('${org}', '${client}', '${report}', 1, '${hash}', '[]'::jsonb, 'approval')`),
        /object|check/i,
    );
    await db.exec(`insert into public.report_versions (organization_id, client_id, report_id, version_no, content_hash, snapshot, reason, created_by)
        values ('${org}', '${client}', '${report}', 1, '${hash}', '{"schemaVersion":1}'::jsonb, 'approval', '${user}')`);
    await assert.rejects(
        db.exec(`update public.report_versions set reason = 'correction' where report_id = '${report}'`),
        /immutable/,
    );
    await assert.rejects(
        db.exec(`delete from public.report_versions where report_id = '${report}'`),
        /immutable/,
    );
    await assert.rejects(
        db.exec(`insert into public.report_reviews (organization_id, client_id, report_id, state) values ('${org}', '${client}', '${report}', 'approved')`),
        /starts as a draft/,
    );

    await db.exec(`insert into public.report_reviews (organization_id, client_id, report_id, requires_owner_approval)
        values ('${org}', '${client}', '${report}', true)`);
    await assert.rejects(
        db.exec(`update public.report_reviews set state = 'sent' where report_id = '${report}'`),
        /not allowed/,
    );
    await db.exec(`update public.report_reviews set state = 'ready_for_review' where report_id = '${report}'`);
    const version = (await db.query<{ id: string }>(`select id from public.report_versions where report_id = '${report}'`)).rows[0].id;
    await assert.rejects(
        db.exec(`update public.report_reviews set state = 'approved', am_approved_by = '${user}', current_version_id = '${version}' where report_id = '${report}'`),
        /organization owner/,
    );
    await db.exec(`update public.report_reviews set state = 'approved', requires_owner_approval = false, am_approved_by = '${user}', current_version_id = '${version}' where report_id = '${report}'`);
    await assert.rejects(
        db.exec(`update public.report_reviews set state = 'scheduled' where report_id = '${report}'`),
        /recipient/,
    );

    await db.exec(`select set_config('test.org', '${org}', false)`);
    await db.exec('set role authenticated');
    const own = (await db.query<{ n: number }>('select count(*)::int as n from public.report_versions')).rows[0];
    assert.equal(own.n, 1);
    await db.exec(`select set_config('test.org', '${other}', false)`);
    const foreign = (await db.query<{ n: number }>('select count(*)::int as n from public.report_versions')).rows[0];
    assert.equal(foreign.n, 0);
    await assert.rejects(
        db.exec(`insert into public.report_versions (organization_id, client_id, report_id, version_no, content_hash, snapshot, reason)
            values ('${org}', '${client}', '${report}', 2, '${hash}', '{"schemaVersion":1}'::jsonb, 'approval')`),
        /permission denied/i,
    );
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.report_reviews'), /permission denied/i);
});
