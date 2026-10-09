import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const versions = readFileSync(new URL('../../migrations/077_report_versions_and_reviews.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/080_report_sends.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333';
const client = '44444444-4444-4444-8444-444444444444';
const report = '66666666-6666-4666-8666-666666666666';
const otherReport = '77777777-7777-4777-8777-777777777777';
const contact = '88888888-8888-4888-8888-888888888888';
const hash = 'a'.repeat(64);

test('the migration adds no send rows', () => {
    assert.equal(/insert\s+into\s+public\.report_sends/i.test(migration), false);
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
        create table public.organizations(id uuid primary key, name text);
        create table public.users(id uuid primary key, full_name text, email text);
        create table public.clients(id uuid primary key, organization_id uuid not null, name text, account_manager_id uuid, created_at timestamptz not null default now());
        create table public.reports(
            id uuid primary key,
            organization_id uuid not null,
            client_id uuid,
            report_month text not null,
            title text not null,
            status text not null default 'draft',
            updated_at timestamptz
        );
        create table public.client_portal_contacts(
            id uuid primary key,
            organization_id uuid not null,
            client_id uuid not null,
            email text,
            revoked_at timestamptz
        );
        create table public.client_portal_report_shares(
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            client_id uuid not null,
            report_id uuid not null,
            snapshot jsonb,
            unshared_at timestamptz
        );
        create unique index client_portal_report_shares_live_idx
            on public.client_portal_report_shares (report_id) where unshared_at is null;
        create table public.client_portal_email_queue (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            client_id uuid not null,
            contact_id uuid not null,
            event_kind text not null,
            event_id uuid not null,
            next_path text not null,
            attempts integer not null default 0,
            available_at timestamptz not null default now(),
            claimed_at timestamptz,
            sent_at timestamptz,
            canceled_at timestamptz,
            failed_at timestamptz,
            created_at timestamptz not null default now(),
            constraint client_portal_email_queue_event_kind_check check (event_kind in ('plan', 'report', 'reply', 'update', 'request')),
            unique (event_kind, event_id, contact_id)
        );
        create function public.queue_client_portal_email() returns trigger language plpgsql as $$ begin return new; end $$;
        create trigger client_portal_report_email after insert on public.client_portal_report_shares
            for each row execute function public.queue_client_portal_email();
        create function public.claim_client_portal_emails(p_limit integer default 20)
        returns setof public.client_portal_email_queue language plpgsql as $$ begin return; end $$;
        insert into public.organizations values ('${org}', 'Agency'), ('${other}', 'Other');
        insert into public.users values ('${user}', 'Abel', 'abel@example.com');
        insert into public.clients values ('${client}', '${org}', 'Scott Cole Plumbing', '${user}');
        insert into public.reports values ('${report}', '${org}', '${client}', '2026-09', 'September', 'draft', now());
        insert into public.reports values ('${otherReport}', '${org}', '${client}', '2026-10', 'October', 'draft', now());
        insert into public.client_portal_contacts values ('${contact}', '${org}', '${client}', 'scott@example.com', null);
    `);
    await db.exec(versions);
    await db.exec(migration);
    return db;
}

test('sends are one per version, org-scoped, and a frozen publish does not queue the generic report email', async () => {
    const db = await database();
    await db.exec(`insert into public.report_versions (organization_id, client_id, report_id, version_no, content_hash, snapshot, reason, created_by)
        values ('${org}', '${client}', '${report}', 1, '${hash}', '{"schemaVersion":1}'::jsonb, 'approval', '${user}')`);
    await db.exec(`insert into public.report_reviews (organization_id, client_id, report_id, requires_owner_approval)
        values ('${org}', '${client}', '${report}', false)`);
    await db.exec(`update public.report_reviews set state = 'ready_for_review' where report_id = '${report}'`);
    const version = (await db.query<{ id: string }>(`select id from public.report_versions where report_id = '${report}'`)).rows[0].id;
    const review = (await db.query<{ id: string }>(`select id from public.report_reviews where report_id = '${report}'`)).rows[0].id;
    await db.exec(`update public.report_reviews set state = 'approved', requires_owner_approval = false, am_approved_by = '${user}', current_version_id = '${version}' where report_id = '${report}'`);

    await db.exec(`insert into public.report_sends (organization_id, client_id, report_id, version_id, review_id, contact_id, scheduled_for, status)
        values ('${org}', '${client}', '${report}', '${version}', '${review}', '${contact}', '2026-11-06T17:00:00Z', 'queued')`);
    await assert.rejects(
        db.exec(`insert into public.report_sends (organization_id, client_id, report_id, version_id, review_id, contact_id, scheduled_for, status)
            values ('${org}', '${client}', '${report}', '${version}', '${review}', '${contact}', '2026-11-06T17:00:00Z', 'queued')`),
        /unique|duplicate/i,
    );
    await assert.rejects(
        db.exec(`insert into public.report_sends (organization_id, client_id, report_id, version_id, review_id, contact_id, scheduled_for, status)
            values ('${other}', '${client}', '${report}', '${version}', '${review}', '${contact}', '2026-11-06T17:00:00Z', 'queued')`),
        /belong/i,
    );

    await db.exec(`select set_config('test.org', '${org}', false)`);
    await db.exec('set role authenticated');
    const own = (await db.query<{ n: number }>('select count(*)::int as n from public.report_sends')).rows[0];
    assert.equal(own.n, 1);
    await db.exec(`select set_config('test.org', '${other}', false)`);
    const foreign = (await db.query<{ n: number }>('select count(*)::int as n from public.report_sends')).rows[0];
    assert.equal(foreign.n, 0);
    await assert.rejects(
        db.exec(`insert into public.report_sends (organization_id, client_id, report_id, version_id, review_id, contact_id, scheduled_for, status)
            values ('${org}', '${client}', '${report}', '${version}', '${review}', '${contact}', '2026-11-06T17:00:00Z', 'queued')`),
        /permission denied/i,
    );
    await db.exec('reset role');

    const share = (await db.query<{ id: string }>(`select public.publish_frozen_report_share('${org}', '${client}', '${report}', '{"id":"${report}"}'::jsonb) as id`)).rows[0];
    assert.ok(share.id);
    const queued = (await db.query<{ n: number }>(`select count(*)::int as n from public.client_portal_email_queue where event_kind = 'report'`)).rows[0];
    assert.equal(queued.n, 0);
    await db.exec(`insert into public.client_portal_report_shares (organization_id, client_id, report_id, snapshot)
        values ('${org}', '${client}', '${otherReport}', '{"id":"${otherReport}"}'::jsonb)`);
    const generic = (await db.query<{ n: number }>(`select count(*)::int as n from public.client_portal_email_queue where event_kind = 'report'`)).rows[0];
    assert.equal(generic.n, 1);

    await db.exec(`insert into public.client_portal_email_queue (organization_id, client_id, contact_id, event_kind, event_id, next_path)
        values ('${org}', '${client}', '${contact}', 'report_send', '${share.id}', '/portal/reports/${report}')`);
    const genericClaim = (await db.query<{ event_kind: string }>('select event_kind from claim_client_portal_emails(20)')).rows;
    assert.deepEqual(genericClaim.map(row => row.event_kind), ['report']);
    const sendClaim = (await db.query<{ event_kind: string }>("select event_kind from claim_client_portal_emails(20, 'report_send')")).rows;
    assert.deepEqual(sendClaim.map(row => row.event_kind), ['report_send']);

    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.report_sends'), /permission denied/i);
});
