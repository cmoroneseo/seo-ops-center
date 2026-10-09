import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const versions = readFileSync(new URL('../../migrations/077_report_versions_and_reviews.sql', import.meta.url), 'utf8');
const cascade = readFileSync(new URL('../../migrations/079_report_version_cascade.sql', import.meta.url), 'utf8');
const hash = 'ab'.repeat(32);

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
        create table public.clients(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id) on delete cascade
        );
        create table public.reports(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id) on delete cascade,
            client_id uuid references public.clients(id) on delete cascade,
            report_month text not null,
            title text not null,
            status text not null default 'draft'
        );
        create table public.client_portal_contacts(
            id uuid primary key,
            organization_id uuid not null,
            client_id uuid not null
        );
        insert into public.organizations values
            ('11111111-1111-4111-8111-111111111111'),
            ('22222222-2222-4222-8222-222222222222');
        insert into public.users values ('33333333-3333-4333-8333-333333333333');
        insert into public.clients values
            ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111'),
            ('55555555-5555-4555-8555-555555555555', '22222222-2222-4222-8222-222222222222');
        insert into public.reports values
            ('66666666-6666-4666-8666-666666666666', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', '2026-09', 'September', 'draft'),
            ('77777777-7777-4777-8777-777777777777', '22222222-2222-4222-8222-222222222222', '55555555-5555-4555-8555-555555555555', '2026-09', 'September', 'draft'),
            ('88888888-8888-4888-8888-888888888888', '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', '2026-08', 'August', 'draft');
    `);
    await db.exec(versions);
    await db.exec(cascade);
    return db;
}

async function version(db: PGlite, org: string, client: string, report: string, versionNo: number) {
    await db.exec(`
        insert into public.report_versions (organization_id, client_id, report_id, version_no, content_hash, snapshot, reason)
        values ('${org}', '${client}', '${report}', ${versionNo}, '${hash}', '{"schemaVersion":1}'::jsonb, 'approval');
        insert into public.report_reviews (organization_id, client_id, report_id)
        values ('${org}', '${client}', '${report}');
    `);
}

test('a client or organization delete removes versions, and a direct delete still fails', async () => {
    const db = await database();
    const org = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    const client = '44444444-4444-4444-8444-444444444444';
    const otherClient = '55555555-5555-4555-8555-555555555555';
    const report = '66666666-6666-4666-8666-666666666666';
    const otherReport = '77777777-7777-4777-8777-777777777777';
    const august = '88888888-8888-4888-8888-888888888888';
    await version(db, org, client, report, 1);
    await version(db, other, otherClient, otherReport, 1);
    await version(db, org, client, august, 1);

    await assert.rejects(
        db.exec(`update public.report_versions set reason = 'correction' where report_id = '${report}'`),
        /immutable/,
    );
    await assert.rejects(
        db.exec(`delete from public.report_versions where report_id = '${report}'`),
        /immutable/,
    );
    await db.exec(`
        create function public.try_direct_version_delete() returns void language plpgsql as $$
        begin
            delete from public.report_versions where report_id = '${august}';
        end $$;
    `);
    await assert.rejects(db.exec('select public.try_direct_version_delete()'), /immutable/);
    await assert.rejects(db.exec(`delete from public.reports where id = '${august}'`), /restrict|foreign key|violates/i);

    await db.exec(`delete from public.clients where id = '${client}'`);
    const gone = await db.query<{ versions: number; reviews: number; reports: number }>(`
        select
            (select count(*) from public.report_versions where client_id = '${client}')::int as versions,
            (select count(*) from public.report_reviews where client_id = '${client}')::int as reviews,
            (select count(*) from public.reports where client_id = '${client}')::int as reports
    `);
    assert.deepEqual(gone.rows[0], { versions: 0, reviews: 0, reports: 0 });
    const otherStill = await db.query<{ n: number }>(`select count(*)::int as n from public.report_versions where organization_id = '${other}'`);
    assert.equal(otherStill.rows[0].n, 1);

    await db.exec(`delete from public.organizations where id = '${other}'`);
    const orgGone = await db.query<{ n: number }>('select count(*)::int as n from public.report_versions');
    assert.equal(orgGone.rows[0].n, 0);
    const clientsGone = await db.query<{ n: number }>(`select count(*)::int as n from public.clients where organization_id = '${other}'`);
    assert.equal(clientsGone.rows[0].n, 0);
});
