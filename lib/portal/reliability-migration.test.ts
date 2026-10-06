import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/070_client_portal_reliability.sql', import.meta.url), 'utf8');
const ids = { org: '11111111-1111-4111-8111-111111111111', client: '22222222-2222-4222-8222-222222222222',
    staff: '33333333-3333-4333-8333-333333333333', contact: '44444444-4444-4444-8444-444444444444',
    user: '55555555-5555-4555-8555-555555555555', plan: '66666666-6666-4666-8666-666666666666',
    other: '77777777-7777-4777-8777-777777777777' };

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create table organizations (id uuid primary key);
        create table users (id uuid primary key);
        create table clients (id uuid primary key);
        create table deliverables (id uuid primary key);
        create table reports (id uuid primary key);
        create table organization_members (organization_id uuid, user_id uuid, role text);
        create function get_user_org_ids() returns setof uuid language sql security definer as 'select organization_id from organization_members where user_id = nullif(current_setting(''request.user'', true), '''')::uuid';
        create table marketing_plans (id uuid primary key, organization_id uuid, client_id uuid);
        create table client_portal_contacts (id uuid primary key, organization_id uuid, client_id uuid, user_id uuid, display_name text, revoked_at timestamptz);
        create table client_portal_plan_shares (id uuid primary key default gen_random_uuid(), organization_id uuid, client_id uuid, marketing_plan_id uuid,
            shared_by uuid, shared_at timestamptz default now(), approval_requested_at timestamptz default now(), unshared_at timestamptz);
        create unique index client_portal_plan_shares_live_idx on client_portal_plan_shares(marketing_plan_id) where unshared_at is null;
        create table client_portal_plan_decisions (id uuid primary key default gen_random_uuid(), organization_id uuid, client_id uuid, marketing_plan_id uuid,
            contact_id uuid, actor_label text, decision text check(decision in ('approved','changes_requested')), note text, decided_at timestamptz default now());
        create table client_portal_report_shares (id uuid primary key default gen_random_uuid(), organization_id uuid, client_id uuid, report_id uuid, shared_by uuid, unshared_at timestamptz);
        create table client_portal_waiting_items (id uuid primary key default gen_random_uuid(), organization_id uuid, client_id uuid, title text, resolved_at timestamptz);
        create table client_portal_feedback (id uuid primary key default gen_random_uuid(), organization_id uuid, client_id uuid, contact_id uuid, author_label text,
            staff_user_id uuid, subject_type text, subject_id uuid, body text, created_at timestamptz default now());
        insert into organizations values ('${ids.org}'), ('${ids.other}');
        insert into clients values ('${ids.client}'); insert into users values ('${ids.staff}'),('${ids.user}');
        insert into organization_members values ('${ids.org}','${ids.staff}','member');
        insert into marketing_plans values ('${ids.plan}','${ids.org}','${ids.client}');
        insert into client_portal_contacts values ('${ids.contact}','${ids.org}','${ids.client}','${ids.user}','Client',null);
    `);
    await db.exec(migration);
    await db.exec(readFileSync(new URL('../../migrations/071_client_portal_server_reads.sql', import.meta.url), 'utf8'));
    return db;
}

test('publication preserves revisions, binds approvals, and atomically queues notifications', async () => {
    const db = await database();
    try {
        const publish = (title: string) => db.query<{ id: string }>('select publish_client_portal_plan($1,$2,$3,$4,$5::jsonb) id', [ids.org, ids.client, ids.plan, ids.staff, JSON.stringify({ title, items: [] })]);
        const first = (await publish('First approved scope')).rows[0].id;
        assert.equal((await db.query<{ ok: boolean }>('select record_client_portal_decision($1,$2,$3,\'approved\',null) ok', [ids.contact, ids.user, first])).rows[0].ok, true);
        const second = (await publish('Changed scope')).rows[0].id;
        assert.notEqual(second, first);
        assert.equal((await db.query<{ ok: boolean }>('select record_client_portal_decision($1,$2,$3,\'approved\',null) ok', [ids.contact, ids.user, first])).rows[0].ok, false);
        assert.equal((await db.query<{ ok: boolean }>('select record_client_portal_decision($1,$2,$3,\'changes_requested\',\'Please revise\') ok', [ids.contact, ids.user, second])).rows[0].ok, true);
        const rows = (await db.query<{ snapshot: { title: string }; version: number; unshared_at: string | null }>('select snapshot,version,unshared_at from client_portal_plan_shares order by version')).rows;
        assert.deepEqual(rows.map(row => row.snapshot.title), ['First approved scope', 'Changed scope']);
        assert.ok(rows[0].unshared_at); assert.equal(rows[1].unshared_at, null);
        assert.equal((await db.query<{ count: number }>('select count(*)::int count from client_portal_feedback')).rows[0].count, 1);
        assert.equal((await db.query<{ count: number }>('select count(*)::int count from client_portal_email_queue')).rows[0].count, 2);
        const claimed = (await db.query<{ id: string; attempts: number }>('select * from claim_client_portal_emails(1)')).rows;
        assert.equal(claimed.length, 1); assert.equal(claimed[0].attempts, 1);
        const next = (await db.query<{ id: string }>('select * from claim_client_portal_emails(10)')).rows;
        assert.equal(next.length, 1); assert.notEqual(next[0].id, claimed[0].id);
        await db.query('update client_portal_contacts set revoked_at=now() where id=$1', [ids.contact]);
        assert.equal((await db.query<{ ok: boolean }>('select record_client_portal_decision($1,$2,$3,\'approved\',null) ok', [ids.contact, ids.user, second])).rows[0].ok, false);
    } finally { await db.close(); }
});

test('tenant checks and database privileges reject client mutations and cross-organization publication', async () => {
    const db = await database();
    try {
        await assert.rejects(db.query('select publish_client_portal_plan($1,$2,$3,$4,$5::jsonb)', [ids.other, ids.client, ids.plan, ids.staff, '{}']), /Unknown plan/);
        await assert.rejects(db.query('select publish_client_portal_plan($1,$2,$3,$4,$5::jsonb)', [ids.org, ids.client, ids.plan, ids.user, '{}']), /Forbidden/);
        await db.exec('set role authenticated');
        await assert.rejects(db.query('select publish_client_portal_plan($1,$2,$3,$4,$5::jsonb)', [ids.org, ids.client, ids.plan, ids.staff, '{}']), /permission denied/);
        await assert.rejects(db.query("insert into client_portal_settings(client_id,organization_id) values ($1,$2)", [ids.client, ids.org]), /permission denied/);
        await assert.rejects(db.query('select * from client_portal_updates'), /permission denied/);
        await assert.rejects(db.query('select * from client_portal_email_queue'), /permission denied/);
    } finally { await db.close(); }
});

test('schema mirrors the reliability migration', () => {
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.ok(schema.includes(migration));
    assert.ok(schema.includes(readFileSync(new URL('../../migrations/071_client_portal_server_reads.sql', import.meta.url), 'utf8')));
});

test('an expired final email lease is marked failed rather than left pending forever', async () => {
    const db = await database();
    try {
        await db.query('select publish_client_portal_plan($1,$2,$3,$4,$5::jsonb)', [ids.org, ids.client, ids.plan, ids.staff, '{}']);
        await db.exec("update client_portal_email_queue set attempts=6,claimed_at=now()-interval '16 minutes'");
        assert.equal((await db.query('select * from claim_client_portal_emails(10)')).rows.length, 0);
        const rows = (await db.query<{ failed_at: string | null; claimed_at: string | null }>('select failed_at,claimed_at from client_portal_email_queue')).rows;
        assert.ok(rows[0].failed_at); assert.equal(rows[0].claimed_at, null);
    } finally { await db.close(); }
});
