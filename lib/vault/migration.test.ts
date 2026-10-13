import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/086_client_vault_entries.sql', import.meta.url), 'utf8');
const org = '00000000-0000-0000-0000-000000000010';
const otherOrg = '00000000-0000-0000-0000-000000000011';
const admin = '00000000-0000-0000-0000-000000000001';
const member = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const portal = '00000000-0000-0000-0000-000000000004';
const outsider = '00000000-0000-0000-0000-000000000005';
const client = '00000000-0000-0000-0000-000000000020';
const otherClient = '00000000-0000-0000-0000-000000000021';

const decision = {
    entryType: 'decision',
    title: 'Canonical homepage stays',
    body: 'Keep the canonical homepage URL. Do not swap it during a redesign.',
    appliesTo: ['technical_seo'],
    effectiveOn: '2026-10-01',
    quote: 'Please keep the em dash — exactly.',
    sourceKind: 'meeting',
    sourceRef: 'notes/oct-1',
};

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role authenticated;
        create role anon;
        create role service_role;
        create schema auth;
        create function auth.uid() returns uuid language sql as $$
            select nullif(current_setting('test.actor', true), '')::uuid
        $$;
        create table organizations(id uuid primary key);
        create table users(id uuid primary key, full_name text);
        create table organization_members(organization_id uuid, user_id uuid, role text);
        create function public.get_user_org_ids() returns setof uuid language sql security definer as $$
            select organization_id from public.organization_members where user_id = auth.uid()
        $$;
        create function public.get_user_admin_org_ids() returns setof uuid language sql security definer as $$
            select organization_id from public.organization_members
            where user_id = auth.uid() and role in ('owner', 'admin')
        $$;
        create table clients(id uuid primary key, organization_id uuid, name text);
        create table client_activity_log(
            id uuid primary key default gen_random_uuid(),
            organization_id uuid,
            client_id uuid,
            event_type text,
            actor_id uuid,
            operation_id uuid,
            metadata jsonb
        );
        create table notifications(
            id uuid primary key default gen_random_uuid(),
            organization_id uuid,
            user_id uuid,
            type text,
            title text,
            body text,
            entity_type text,
            entity_id text,
            client_id uuid,
            is_read boolean default false,
            created_at timestamptz default now()
        );
        create table client_portal_contacts(
            id uuid primary key default gen_random_uuid(),
            organization_id uuid,
            client_id uuid,
            user_id uuid,
            email text,
            display_name text,
            revoked_at timestamptz
        );
        insert into organizations values ('${org}'), ('${otherOrg}');
        insert into users values
            ('${admin}', 'Ada Admin'),
            ('${member}', 'Morgan Member'),
            ('${viewer}', 'Vera Viewer'),
            ('${portal}', 'Pat Portal'),
            ('${outsider}', 'Otto Outsider');
        insert into organization_members values
            ('${org}', '${admin}', 'admin'),
            ('${org}', '${member}', 'member'),
            ('${org}', '${viewer}', 'viewer'),
            ('${org}', '${portal}', 'member'),
            ('${otherOrg}', '${outsider}', 'admin');
        insert into clients values
            ('${client}', '${org}', 'Sandbox Client A'),
            ('${otherClient}', '${otherOrg}', 'Other Client');
        insert into client_portal_contacts (organization_id, client_id, user_id, email, display_name)
        values ('${org}', '${client}', '${portal}', 'pat@client.test', 'Pat Portal');
        grant usage on schema public, auth to authenticated, anon;
        grant select, insert, update, delete on all tables in schema public to authenticated, anon;
    `);
    await db.exec(migration);
    await db.exec(`set role authenticated; set test.actor = '${admin}';`);
    return db;
}

async function asUser(db: PGlite, userId: string) {
    await db.exec(`set role authenticated; set test.actor = '${userId}';`);
}

test('the migration is mirrored in the full schema', () => {
    assert.ok(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').includes(migration));
});

test('admins create, supersede, archive, and pin with one active version and a full history', async () => {
    const db = await database();
    try {
        const created = (await db.query<{ id: string }>(
            'select create_client_vault_entry($1, $2) id',
            [client, decision],
        )).rows[0].id;
        const source = (await db.query<{ quote: string; source_kind: string }>(
            'select quote, source_kind from client_vault_sources',
        )).rows[0];
        assert.equal(source.quote, 'Please keep the em dash — exactly.');
        assert.equal(source.source_kind, 'meeting');

        const superseded = (await db.query<{ id: string }>(
            'select supersede_client_vault_entry($1, $2, $3) id',
            [client, created, { ...decision, title: 'Canonical homepage stays, with the trailing slash', body: 'Keep the trailing slash on the canonical homepage.' }],
        )).rows[0].id;
        await assert.rejects(
            db.query('select supersede_client_vault_entry($1, $2, $3)', [client, created, decision]),
            /concurrently/,
        );
        const active = (await db.query<{ n: number; id: string }>(
            "select count(*)::int n, (array_agg(id))[1] id from client_vault_entries where lineage_id = (select lineage_id from client_vault_entries where id = $1) and status = 'active'",
            [superseded],
        )).rows[0];
        assert.equal(active.n, 1);
        assert.equal(active.id, superseded);

        await db.query('select set_client_vault_pin_review($1, $2, $3)', [client, superseded, { pinned: true, reviewOn: '2026-12-01' }]);
        await assert.rejects(
            db.query("update client_vault_entries set title = 'rewritten'"),
            /immutable|permission denied/,
        );
        const pinned = (await db.query<{ pinned: boolean; review_on: string; title: string }>(
            'select pinned, review_on::text, title from client_vault_entries where id = $1',
            [superseded],
        )).rows[0];
        assert.equal(pinned.pinned, true);
        assert.equal(pinned.review_on, '2026-12-01');
        assert.equal(pinned.title, 'Canonical homepage stays, with the trailing slash');

        await db.query('select archive_client_vault_entry($1, $2)', [client, superseded]);
        const history = (await db.query<{ detail: { history: { version_no: number; status: string }[] } }>(
            'select get_client_vault_entry($1, $2) detail',
            [client, superseded],
        )).rows[0].detail;
        assert.deepEqual(history.history.map(item => item.status), ['archived', 'superseded']);
        assert.deepEqual(history.history.map(item => item.version_no), [2, 1]);
        assert.deepEqual(history.evidence, []);

        const events = (await db.query<{ event_type: string }>('select event_type from client_activity_log order by event_type')).rows.map(row => row.event_type);
        assert.deepEqual(events, ['vault.entry_archived', 'vault.entry_created', 'vault.entry_pin_review', 'vault.entry_superseded']);
    } finally {
        await db.close();
    }
});

test('a member proposal is accepted with both credits, or dismissed, and the member is notified', async () => {
    const db = await database();
    try {
        await asUser(db, member);
        const suggestion = (await db.query<{ id: string }>(
            'select propose_client_vault_entry($1, $2) id',
            [client, { ...decision, title: 'Proposed canonical rule', entryType: 'rule', ruleKind: 'technical', enforcement: 'warn', ruleDetails: { statement: 'Warn only.' } }],
        )).rows[0].id;
        await asUser(db, viewer);
        await assert.rejects(db.query('select propose_client_vault_entry($1, $2)', [client, decision]), /Viewers cannot/);
        await asUser(db, admin);
        const entryId = (await db.query<{ id: string }>(
            'select accept_client_vault_suggestion($1, $2) id',
            [client, suggestion],
        )).rows[0].id;
        const entry = (await db.query<{ author_id: string; proposed_by: string; enforcement: string; source_kind: string }>(
            `select entry.author_id, entry.proposed_by, entry.enforcement, source.source_kind
             from client_vault_entries entry
             join client_vault_sources source on source.entry_id = entry.id
             where entry.id = $1`,
            [entryId],
        )).rows[0];
        assert.equal(entry.author_id, admin);
        assert.equal(entry.proposed_by, member);
        assert.equal(entry.enforcement, 'warn');
        assert.equal(entry.source_kind, 'member_proposal');
        assert.equal((await db.query<{ quote: string }>('select quote from client_vault_sources where entry_id = $1', [entryId])).rows[0].quote, decision.quote);

        const note = (await db.query<{ type: string; user_id: string }>(
            "select type, user_id from notifications where type = 'vault_proposal_accepted'",
        )).rows[0];
        assert.equal(note.user_id, member);
        assert.equal((await db.query<{ event_type: string }>(
            "select event_type from client_activity_log where event_type = 'vault.suggestion_accepted'",
        )).rows.length, 1);

        await asUser(db, member);
        const second = (await db.query<{ id: string }>(
            'select propose_client_vault_entry($1, $2) id',
            [client, { ...decision, title: 'Another proposal' }],
        )).rows[0].id;
        await asUser(db, admin);
        await db.query('select dismiss_client_vault_suggestion($1, $2, $3)', [client, second, 'Already covered']);
        assert.equal((await db.query<{ n: number }>(
            "select count(*)::int n from notifications where type = 'vault_proposal_dismissed' and user_id = $1",
            [member],
        )).rows[0].n, 1);
        assert.equal((await db.query<{ event_type: string }>(
            "select event_type from client_activity_log where metadata->>'suggestionId' = $1",
            [second],
        )).rows.map(row => row.event_type).includes('vault.suggestion_dismissed'), true);
    } finally {
        await db.close();
    }
});

test('the proposer can withdraw their own suggestion and nobody else can', async () => {
    const db = await database();
    try {
        await asUser(db, member);
        const suggestion = (await db.query<{ id: string }>(
            'select propose_client_vault_entry($1, $2) id',
            [client, decision],
        )).rows[0].id;
        await asUser(db, admin);
        await assert.rejects(db.query('select withdraw_client_vault_suggestion($1, $2)', [client, suggestion]), /Only the proposer/);
        await asUser(db, member);
        await db.query('select withdraw_client_vault_suggestion($1, $2)', [client, suggestion]);
        assert.equal((await db.query<{ status: string }>('select status from client_vault_suggestions')).rows[0].status, 'withdrawn');
        assert.equal((await db.query<{ n: number }>(
            "select count(*)::int n from client_activity_log where event_type = 'vault.suggestion_withdrawn'",
        )).rows[0].n, 1);
    } finally {
        await db.close();
    }
});

test('viewers can read, portal contacts and other organizations cannot, and direct writes are revoked', async () => {
    const db = await database();
    try {
        const entryId = (await db.query<{ id: string }>('select create_client_vault_entry($1, $2) id', [client, decision])).rows[0].id;
        await asUser(db, viewer);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from client_vault_entries')).rows[0].n, 1);
        await assert.rejects(db.query('select archive_client_vault_entry($1, $2)', [client, entryId]), /owners and admins/);
        await assert.rejects(db.query('insert into client_vault_entries(organization_id, client_id, lineage_id, version_no, entry_type, title, body, effective_on) values ($1,$2,$3,1,$4,$5,$6,$7)', [org, client, entryId, 'decision', 'Nope', 'Body', '2026-01-01']), /permission denied/);
        await assert.rejects(db.query('delete from client_vault_entries'), /permission denied/);

        await asUser(db, portal);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from client_vault_entries')).rows[0].n, 0);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from client_vault_sources')).rows[0].n, 0);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from client_vault_suggestions')).rows[0].n, 0);
        await assert.rejects(db.query('select client_vault_counts($1)', [client]), /Portal contacts/);

        await asUser(db, outsider);
        assert.equal((await db.query<{ n: number }>('select count(*)::int n from client_vault_entries')).rows[0].n, 0);
        await assert.rejects(db.query('select get_client_vault_entry($1, $2)', [client, entryId]), /Forbidden|not found/);

        await db.exec('reset role; set role anon');
        await assert.rejects(db.query('select count(*) from client_vault_entries'), /permission denied/);
        await assert.rejects(db.query('select create_client_vault_entry($1, $2)', [client, decision]), /permission denied/);
    } finally {
        await db.close();
    }
});

test('rules keep block or warn without an enforcement procedure, and a second active version cannot be inserted', async () => {
    const db = await database();
    try {
        const entryId = (await db.query<{ id: string }>('select create_client_vault_entry($1, $2) id', [client, {
            entryType: 'rule',
            title: 'No doorway pages',
            body: 'Do not publish doorway pages for this client.',
            ruleKind: 'content',
            enforcement: 'block',
            ruleDetails: { statement: 'Block doorway pages.' },
            effectiveOn: '2026-10-01',
        }])).rows[0].id;
        assert.equal((await db.query<{ enforcement: string }>('select enforcement from client_vault_entries where id = $1', [entryId])).rows[0].enforcement, 'block');
        assert.equal((await db.query<{ name: string | null }>("select to_regprocedure('public.enforce_client_vault_rules()')::text as name")).rows[0].name, null);
        await db.exec('reset role');
        const lineage = (await db.query<{ lineage_id: string }>('select lineage_id from client_vault_entries where id = $1', [entryId])).rows[0].lineage_id;
        await assert.rejects(db.query(
            `insert into client_vault_entries (organization_id, client_id, lineage_id, version_no, supersedes_id, entry_type, status, title, body, effective_on, author_id)
             values ($1,$2,$3,2,$4,'decision','active','Second active','Body','2026-10-02',$5)`,
            [org, client, lineage, entryId, admin],
        ), /one_active|duplicate key|chain/);
    } finally {
        await db.close();
    }
});

test('a client from another organization cannot be written onto a vault row', async () => {
    const db = await database();
    try {
        await db.exec('reset role');
        await assert.rejects(db.query(
            `insert into client_vault_entries (organization_id, client_id, lineage_id, version_no, entry_type, title, body, effective_on, author_id)
             values ($1,$2,gen_random_uuid(),1,'decision','Wrong org','Body','2026-10-01',$3)`,
            [org, otherClient, admin],
        ), /does not belong/);
    } finally {
        await db.close();
    }
});

test('search stays under 200ms at 500 entries and filters by type', async () => {
    const db = await database();
    try {
        await db.exec('reset role');
        await db.query(
            `insert into client_vault_entries (id, organization_id, client_id, lineage_id, version_no, entry_type, status, title, body, applies_to, effective_on, author_id)
             select id, $1, $2, id, 1, case when n % 2 = 0 then 'decision' else 'precedent' end, 'active',
                    'Entry '||n, case when n = 17 then 'canonical phrase alpha' else 'ordinary note '||n end,
                    '{}', '2026-01-01', $3
             from (select gen_random_uuid() id, n from generate_series(1, 500) n) rows`,
            [org, client, admin],
        );
        await db.exec('analyze client_vault_entries');
        await asUser(db, admin);
        const started = Date.now();
        const found = (await db.query<{ rows: { title: string }[] }>(
            "select list_client_vault_entries($1, 'canonical phrase', null, 'active', null, null, null, 20) rows",
            [client],
        )).rows[0].rows;
        const elapsed = Date.now() - started;
        assert.ok(elapsed < 200, `search took ${elapsed}ms`);
        assert.equal(found.length, 1);
        assert.equal(found[0].title, 'Entry 17');
        const decisions = (await db.query<{ rows: unknown[] }>(
            "select list_client_vault_entries($1, null, 'decision', 'active', null, null, null, 100) rows",
            [client],
        )).rows[0].rows;
        assert.equal(decisions.length, 100);
        assert.ok(decisions.every(row => (row as { entry_type: string }).entry_type === 'decision'));
    } finally {
        await db.close();
    }
});
