import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/081_weekly_digest.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const client = '44444444-4444-4444-8444-444444444444';
const otherClient = '55555555-5555-4555-8555-555555555555';
const contact = '88888888-8888-4888-8888-888888888888';
const eventA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const eventB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const eventC = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('the migration does not insert mail and schema.sql mirrors it', () => {
    assert.equal(/insert\s+into/i.test(migration), false);
    assert.equal(/grant\s+[^;]*\bto\s+anon\b/i.test(migration), false);
    assert.equal(/grant\s+[^;]*\bto\s+authenticated\b/i.test(migration), false);
    const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.equal(schema.includes(migration.trim()), true);
});

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create table public.client_portal_settings (
            client_id uuid primary key,
            organization_id uuid not null,
            analytics_shared boolean not null default false
        );
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
            constraint client_portal_email_queue_event_kind_check check (event_kind in ('plan', 'report', 'reply', 'update', 'request', 'report_send')),
            unique (event_kind, event_id, contact_id)
        );
        insert into public.client_portal_settings (client_id, organization_id, analytics_shared)
            values ('${client}', '${org}', true);
    `);
    await db.exec(migration);
    return db;
}

test('weekly digest defaults off, keeps analytics, and extends the queue kind without dropping the others', async () => {
    const db = await database();
    const existing = (await db.query<{ analytics_shared: boolean; weekly_digest: boolean }>(
        `select analytics_shared, weekly_digest from public.client_portal_settings where client_id = '${client}'`,
    )).rows[0];
    assert.equal(existing.analytics_shared, true);
    assert.equal(existing.weekly_digest, false);

    await db.exec(`insert into public.client_portal_settings (client_id, organization_id) values ('${otherClient}', '${org}')`);
    const created = (await db.query<{ weekly_digest: boolean }>(
        `select weekly_digest from public.client_portal_settings where client_id = '${otherClient}'`,
    )).rows[0];
    assert.equal(created.weekly_digest, false);
    await assert.rejects(
        db.exec(`update public.client_portal_settings set weekly_digest = null where client_id = '${otherClient}'`),
        /not-null|null value/i,
    );

    for (const kind of ['plan', 'report', 'reply', 'update', 'request', 'report_send', 'weekly_digest']) {
        const id = kind === 'weekly_digest' ? eventC : kind === 'report_send' ? eventB : eventA;
        await db.exec(`insert into public.client_portal_email_queue (organization_id, client_id, contact_id, event_kind, event_id, next_path)
            values ('${org}', '${client}', '${contact}', '${kind}', '${id}', '/portal')`);
    }
    await assert.rejects(
        db.exec(`insert into public.client_portal_email_queue (organization_id, client_id, contact_id, event_kind, event_id, next_path)
            values ('${org}', '${client}', '${contact}', 'nope', '${eventA}', '/portal')`),
        /check|weekly_digest|event_kind/i,
    );

    const generic = (await db.query<{ event_kind: string }>('select event_kind from claim_client_portal_emails(20) order by event_kind')).rows;
    assert.deepEqual(generic.map(row => row.event_kind), ['plan', 'reply', 'report', 'request', 'update']);
    const digest = (await db.query<{ event_kind: string }>("select event_kind from claim_client_portal_emails(20, 'weekly_digest')")).rows;
    assert.deepEqual(digest.map(row => row.event_kind), ['weekly_digest']);
    const reportSend = (await db.query<{ event_kind: string }>("select event_kind from claim_client_portal_emails(20, 'report_send')")).rows;
    assert.deepEqual(reportSend.map(row => row.event_kind), ['report_send']);
});
