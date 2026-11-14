import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../../migrations/131_gbp_approval_requests.sql', import.meta.url), 'utf8');

const org = '11111111-1111-4111-8111-111111111111';
const otherOrg = '22222222-2222-4222-8222-222222222222';
const owner = '360c97ac-54fc-41fb-b660-0566d63c2e1b';
const assignee = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const viewer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const member = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const client = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherClient = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const task = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const otherTask = '99999999-9999-4999-8999-999999999999';
const now = '2026-11-14T17:00:00.000Z';
const later = '2026-11-20T17:00:00.000Z';
const expiry = '2026-11-28T17:00:00.000Z';

function hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function post(title: string, scheduled = '2026-11-16') {
    return {
        position: 1,
        photoPath: 'https://allinone-const.com/photos/post.jpg',
        payload: {
            schemaVersion: 1,
            postType: 'offer',
            title,
            body: 'Happy Thanksgiving from everyone at ALL-IN-1 Construction in Banning, CA. Once the leftovers are gone, tap below to request your free walkthrough.',
            offerStart: scheduled,
            offerEnd: '2026-12-31',
            scheduledDate: scheduled,
            ctaUrl: 'https://allinone-const.com/contact/',
            ctaLabel: 'View offer',
            terms: 'Offer runs Nov 16 to Dec 31.',
        },
    };
}

async function database() {
    const db = new PGlite();
    await db.exec(`
        create role anon nologin;
        create role authenticated nologin;
        create role service_role nologin bypassrls;
        create schema auth;
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        create function public.get_user_org_ids() returns setof uuid language sql stable as $$
            select nullif(current_setting('test.org', true), '')::uuid
        $$;
        create schema storage;
        create table storage.buckets (
            id text primary key,
            name text,
            public boolean,
            file_size_limit bigint,
            allowed_mime_types text[]
        );
        create table storage.objects (
            id uuid primary key default gen_random_uuid(),
            bucket_id text,
            name text
        );
        alter table storage.objects enable row level security;
        create table public.organizations(id uuid primary key);
        create table public.clients(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id),
            name text not null
        );
        create table public.tasks(
            id uuid primary key,
            organization_id uuid not null references public.organizations(id),
            client_id uuid not null references public.clients(id),
            title text not null,
            status text not null default 'todo',
            due_date timestamptz,
            assignee_ids uuid[] not null default '{}',
            status_history jsonb not null default '[]'::jsonb
        );
        create table public.organization_members(
            organization_id uuid,
            user_id uuid,
            role text
        );
        create table public.notifications (
            id uuid primary key default gen_random_uuid(),
            organization_id uuid not null,
            user_id uuid not null,
            type text not null,
            title text not null,
            body text,
            entity_type text,
            entity_id text,
            client_id uuid,
            is_read boolean not null default false,
            created_at timestamptz not null default now(),
            constraint notifications_type_check check (type in ('task_assigned')),
            constraint notifications_entity_type_check check (entity_type in ('task'))
        );
        insert into public.organizations values ('${org}'), ('${otherOrg}');
        insert into public.clients values
            ('${client}', '${org}', 'ALL-IN-1 Construction'),
            ('${otherClient}', '${otherOrg}', 'Other Client');
        insert into public.tasks (id, organization_id, client_id, title, due_date, assignee_ids) values
            ('${task}', '${org}', '${client}', 'GBP holiday posts', '2026-11-15T08:00:00Z', '{${assignee}}'),
            ('${otherTask}', '${otherOrg}', '${otherClient}', 'Other task', null, '{}');
        insert into public.organization_members values
            ('${org}', '${owner}', 'owner'),
            ('${otherOrg}', '${owner}', 'owner'),
            ('${org}', '${assignee}', 'member'),
            ('${org}', '${member}', 'member'),
            ('${org}', '${viewer}', 'viewer');
        grant usage on schema public to anon, authenticated, service_role;
    `);
    await db.exec(migration);
    return db;
}

async function asRole(db: PGlite, role: string) {
    await db.exec(`set role ${role}`);
}

async function reset(db: PGlite) {
    await db.exec('reset role');
}

async function call(db: PGlite, sql: string, params: unknown[] = []) {
    await asRole(db, 'service_role');
    try {
        const result = await db.query<{ result: Record<string, unknown> }>(sql, params);
        const value = result.rows[0]?.result;
        return typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value;
    } finally {
        await reset(db);
    }
}

test('migration 131 applies, stays private, and rejects anon and viewers', async () => {
    const db = await database();
    await db.exec(migration);
    const bucket = await db.query<{ public: boolean }>(
        `select public from storage.buckets where id = 'gbp-approval-uploads'`,
    );
    assert.equal(bucket.rows[0]?.public, false);
    const policies = await db.query<{ polname: string }>(
        `select pol.polname
         from pg_policy pol
         join pg_class cls on cls.oid = pol.polrelid
         join pg_namespace ns on ns.oid = cls.relnamespace
         where ns.nspname = 'storage'`,
    );
    assert.equal(policies.rows.length, 0);
    const anonPolicies = await db.query<{ polname: string; roles: string }>(
        `select pol.polname, pol.polroles::text as roles
         from pg_policy pol
         join pg_class cls on cls.oid = pol.polrelid
         where cls.relname like 'approval_%'`,
    );
    assert.equal(anonPolicies.rows.every(row => !row.roles.includes('anon')), true);
    assert.equal(anonPolicies.rows.length > 0, true);

    await asRole(db, 'anon');
    await assert.rejects(db.query('select * from public.approval_requests'));
    await reset(db);

    const created = await call(
        db,
        `select public.create_gbp_approval_request($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb) as result`,
        [member, org, client, task, 'GBP holiday posts', '2026-11-15T08:00:00Z', '[]', JSON.stringify([post('Kitchen')])],
    );
    assert.equal(created.ok, true);

    await db.exec(`select set_config('test.org', '${org}', false)`);
    await db.exec(`select set_config('request.jwt.claim.sub', '${viewer}', false)`);
    await asRole(db, 'authenticated');
    const visible = await db.query<{ title: string }>(`select title from public.approval_requests`);
    assert.equal(visible.rows.length, 1);
    await assert.rejects(
        db.query(
            `insert into public.approval_requests (organization_id, client_id, task_id, title)
             values ('${org}', '${client}', '${task}', 'nope')`,
        ),
    );
    await reset(db);
    await db.exec(`select set_config('test.org', '${otherOrg}', false)`);
    await asRole(db, 'authenticated');
    const hidden = await db.query(`select id from public.approval_requests`);
    assert.equal(hidden.rows.length, 0);
    await reset(db);
});

test('a token cannot read another request, and expiry and revoke close the link', async () => {
    const db = await database();
    const first = await call(
        db,
        `select public.create_gbp_approval_request($1,$2,$3,$4,$5,null,'[]'::jsonb,$6::jsonb) as result`,
        [owner, org, client, task, 'First request', JSON.stringify([post('First title')])],
    );
    const second = await call(
        db,
        `select public.create_gbp_approval_request($1,$2,$3,$4,$5,null,'[]'::jsonb,$6::jsonb) as result`,
        [owner, otherOrg, otherClient, otherTask, 'Second request secret', JSON.stringify([post('Second title')])],
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    const tokenA = 'token-a-raw-value-not-stored';
    const tokenB = 'token-b-raw-value-not-stored';
    assert.equal((await call(
        db,
        `select public.issue_gbp_approval_link($1,$2,$3,$4,$5::timestamptz) as result`,
        [owner, first.requestId, hash(tokenA), expiry, now],
    )).ok, true);
    await call(
        db,
        `select public.issue_gbp_approval_link($1,$2,$3,$4,$5::timestamptz) as result`,
        [owner, second.requestId, hash(tokenB), expiry, now],
    );

    const view = await call(
        db,
        `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
        [hash(tokenA), now],
    );
    assert.equal(view.state, 'active');
    assert.equal(view.title, 'First request');
    assert.equal(JSON.stringify(view).includes('Second request secret'), false);
    assert.equal(JSON.stringify(view).includes(otherOrg), false);
    assert.equal(JSON.stringify(view).includes('token_hash'), false);
    assert.equal(JSON.stringify(view).includes(tokenA), false);

    const viewerAttempt = await call(
        db,
        `select public.issue_gbp_approval_link($1,$2,$3,$4,$5::timestamptz) as result`,
        [viewer, first.requestId, hash('another-token'), expiry, now],
    );
    assert.equal(viewerAttempt.code, 'forbidden');

    const expired = await call(
        db,
        `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
        [hash(tokenA), '2026-12-20T00:00:00Z'],
    );
    assert.equal(expired.state, 'expired');
    assert.equal(JSON.stringify(expired).includes('First title'), false);
    assert.equal((await call(
        db,
        `select public.submit_gbp_approval($1,$2::jsonb,null,$3::timestamptz) as result`,
        [hash(tokenA), JSON.stringify({ idempotencyKey: 'expired-01', requestHash: hash('x'), respondentName: 'Ada', displayedVersionIds: [], decisions: [] }), '2026-12-20T00:00:00Z'],
    )).code, 'expired');

    const extended = await call(
        db,
        `select public.extend_gbp_approval_link($1,$2,$3::timestamptz,$4::timestamptz) as result`,
        [member, first.requestId, '2027-01-01T00:00:00Z', '2026-12-20T00:00:00Z'],
    );
    assert.equal(extended.ok, true);
    const reopened = await call(
        db,
        `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
        [hash(tokenA), '2026-12-20T00:00:00Z'],
    );
    assert.equal(reopened.state, 'active');

    assert.equal((await call(
        db,
        `select public.revoke_gbp_approval_link($1,$2,$3::timestamptz) as result`,
        [owner, first.requestId, later],
    )).ok, true);
    assert.equal((await call(
        db,
        `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
        [hash(tokenA), later],
    )).state, 'revoked');
    assert.equal((await call(
        db,
        `select public.extend_gbp_approval_link($1,$2,$3::timestamptz,$4::timestamptz) as result`,
        [owner, first.requestId, expiry, later],
    )).code, 'revoked');
});

test('submit is scoped, stale-safe, locked, idempotent, and resets visible edits', async () => {
    const db = await database();
    const created = await call(
        db,
        `select public.create_gbp_approval_request($1,$2,$3,$4,$5,$6::timestamptz,$7::jsonb,$8::jsonb) as result`,
        [
            owner, org, client, task, 'GBP holiday posts', '2026-11-15T08:00:00Z',
            JSON.stringify([{ prompt: 'Does the customer have to request the walkthrough by Dec 31?' }]),
            JSON.stringify([post('Kitchen walkthrough'), { ...post('Remodel walkthrough', '2026-12-14'), position: 2, photoPath: null }]),
        ],
    );
    assert.equal(created.ok, true);
    const other = await call(
        db,
        `select public.create_gbp_approval_request($1,$2,$3,$4,$5,null,'[]'::jsonb,$6::jsonb) as result`,
        [owner, otherOrg, otherClient, otherTask, 'Secret other request', JSON.stringify([post('Secret post')])],
    );
    const token = 'client-token-raw';
    await call(
        db,
        `select public.issue_gbp_approval_link($1,$2,$3,$4,$5::timestamptz) as result`,
        [owner, created.requestId, hash(token), expiry, now],
    );
    await call(
        db,
        `select public.issue_gbp_approval_link($1,$2,$3,$4,$5::timestamptz) as result`,
        [owner, other.requestId, hash('other-token'), expiry, now],
    );
    const loaded = await call(
        db,
        `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
        [hash(token), now],
    );
    const items = loaded.items as Array<{ id: string; version: { id: string; payload: { scheduledDate: string } } }>;
    const versionIds = items.map(item => item.version.id);
    const otherView = await call(
        db,
        `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
        [hash('other-token'), now],
    );
    const foreignItem = (otherView.items as Array<{ id: string; version: { id: string } }>)[0];

    const badScope = await call(
        db,
        `select public.submit_gbp_approval($1,$2::jsonb,$3,$4::timestamptz) as result`,
        [hash(token), JSON.stringify({
            idempotencyKey: 'scope-0001',
            requestHash: hash('scope'),
            respondentName: 'Casey',
            displayedVersionIds: versionIds,
            decisions: [{ itemId: foreignItem.id, versionId: foreignItem.version.id, decision: 'approved' }],
            answers: [],
            verifiedReservationIds: [],
        }), hash('203.0.113.8'), now],
    );
    assert.equal(badScope.code, 'out_of_scope');
    const untouched = await db.query<{ status: string }>(
        `select status from public.approval_items where id = $1`,
        [foreignItem.id],
    );
    assert.equal(untouched.rows[0]?.status, 'pending');
    const noSubmission = await db.query<{ count: string }>(
        `select count(*)::text as count from public.approval_submissions where request_id = $1`,
        [created.requestId],
    );
    assert.equal(noSubmission.rows[0]?.count, '0');

    const photoNeeded = await call(
        db,
        `select public.submit_gbp_approval($1,$2::jsonb,$3,$4::timestamptz) as result`,
        [hash(token), JSON.stringify({
            idempotencyKey: 'approve-all',
            requestHash: hash('approve-all'),
            respondentName: 'Casey Lee',
            respondentEmail: 'casey@example.com',
            displayedVersionIds: versionIds,
            decisions: items.map(item => ({ itemId: item.id, versionId: item.version.id, decision: 'approved' })),
            answers: [{ questionId: (loaded.questions as Array<{ id: string }>)[0].id, answer: 'Request by Dec 31.' }],
            verifiedReservationIds: [],
        }), hash('203.0.113.8'), now],
    );
    assert.equal(photoNeeded.ok, true);
    assert.equal((photoNeeded.summary as { pending: number }).pending, 0);
    assert.equal(photoNeeded.taskAdvanced, true);
    const taskRow = await db.query<{ status: string; due_date: string }>(
        `select status, due_date::text as due_date from public.tasks where id = $1`,
        [task],
    );
    assert.equal(taskRow.rows[0]?.status, 'in_progress');
    assert.equal(taskRow.rows[0]?.due_date.startsWith('2026-11-15'), true);
    const notes = await db.query<{ user_id: string }>(
        `select user_id::text as user_id from public.notifications where type = 'gbp_approval_response' order by user_id`,
    );
    assert.deepEqual(notes.rows.map(row => row.user_id).sort(), [assignee, owner].sort());

    const replay = await call(
        db,
        `select public.submit_gbp_approval($1,$2::jsonb,$3,$4::timestamptz) as result`,
        [hash(token), JSON.stringify({
            idempotencyKey: 'approve-all',
            requestHash: hash('approve-all'),
            respondentName: 'Casey Lee',
            displayedVersionIds: versionIds,
            decisions: items.map(item => ({ itemId: item.id, versionId: item.version.id, decision: 'approved' })),
            answers: [],
            verifiedReservationIds: [],
        }), hash('203.0.113.8'), later],
    );
    assert.equal(replay.idempotent, true);
    const noteCount = await db.query<{ count: string }>(
        `select count(*)::text as count from public.notifications where type = 'gbp_approval_response'`,
    );
    assert.equal(noteCount.rows[0]?.count, '2');

    const conflict = await call(
        db,
        `select public.submit_gbp_approval($1,$2::jsonb,null,$3::timestamptz) as result`,
        [hash(token), JSON.stringify({
            idempotencyKey: 'approve-all',
            requestHash: hash('different'),
            respondentName: 'Casey Lee',
            displayedVersionIds: versionIds,
            decisions: [],
            answers: [],
        }), later],
    );
    assert.equal(conflict.code, 'idempotency_conflict');

    const itemId = items[0].id;
    const changedPayload = {
        ...post('Kitchen walkthrough').payload,
        body: 'Happy Thanksgiving from everyone at ALL-IN-1 Construction in Banning, CA. Tap below to request your free walkthrough.',
    };
    const posted = await call(
        db,
        `select public.post_gbp_approval_version($1,$2,$3::jsonb,$4::timestamptz) as result`,
        [member, created.requestId, JSON.stringify([{
            itemId,
            payload: changedPayload,
            photoPath: 'https://allinone-const.com/photos/post.jpg',
            changeNote: 'Removed the leftovers line, as you suggested.',
            source: 'manual',
        }]), later],
    );
    assert.equal(posted.ok, true);
    assert.equal(posted.changed, true);
    const reset = await db.query<{ status: string; locked: string | null; scheduled: string; round: number }>(
        `select item.status, item.decision_locked_at::text as locked, version.payload->>'scheduledDate' as scheduled, request.round
         from public.approval_items item
         join public.approval_item_versions version on version.id = item.current_version_id
         join public.approval_requests request on request.id = item.request_id
         where item.id = $1`,
        [itemId],
    );
    assert.equal(reset.rows[0]?.status, 'pending');
    assert.equal(reset.rows[0]?.locked, null);
    assert.equal(reset.rows[0]?.scheduled, '2026-11-16');
    assert.equal(reset.rows[0]?.round, 2);

    const stale = await call(
        db,
        `select public.submit_gbp_approval($1,$2::jsonb,null,$3::timestamptz) as result`,
        [hash(token), JSON.stringify({
            idempotencyKey: 'stale-0001',
            requestHash: hash('stale'),
            respondentName: 'Casey Lee',
            displayedVersionIds: versionIds,
            decisions: [{ itemId, versionId: versionIds[0], decision: 'approved' }],
            answers: [],
            verifiedReservationIds: [],
        }), later],
    );
    assert.equal(stale.code, 'refresh_required');
    const stillPending = await db.query<{ status: string; submissions: string }>(
        `select item.status, (select count(*) from public.approval_submissions where request_id = item.request_id)::text as submissions
         from public.approval_items item where item.id = $1`,
        [itemId],
    );
    assert.equal(stillPending.rows[0]?.status, 'pending');
    assert.equal(stillPending.rows[0]?.submissions, '1');

    const same = await call(
        db,
        `select public.post_gbp_approval_version($1,$2,$3::jsonb,$4::timestamptz) as result`,
        [owner, created.requestId, JSON.stringify([{
            itemId: items[1].id,
            payload: post('Remodel walkthrough', '2026-12-14').payload,
            photoPath: null,
            changeNote: 'No visible change',
            source: 'manual',
        }]), later],
    );
    assert.equal(same.changed, false);
    const locked = await db.query<{ status: string; reason: string }>(
        `select status, decision_lock_reason as reason from public.approval_items where id = $1`,
        [items[1].id],
    );
    assert.equal(locked.rows[0]?.status, 'approved');
    assert.equal(locked.rows[0]?.reason, 'agency_version');

    const latest = await call(
        db,
        `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
        [hash(token), later],
    );
    const latestIds = (latest.items as Array<{ version: { id: string } }>).map(item => item.version.id);
    const relock = await call(
        db,
        `select public.submit_gbp_approval($1,$2::jsonb,null,$3::timestamptz) as result`,
        [hash(token), JSON.stringify({
            idempotencyKey: 'relock-001',
            requestHash: hash('relock'),
            respondentName: 'Casey Lee',
            displayedVersionIds: latestIds,
            decisions: [{ itemId: items[1].id, versionId: latestIds[1], decision: 'changes_requested', comment: 'Please change it' }],
            answers: [],
            verifiedReservationIds: [],
        }), later],
    );
    assert.equal(relock.code, 'decision_locked');
    const stillApproved = await db.query<{ status: string }>(
        `select status from public.approval_items where id = $1`,
        [items[1].id],
    );
    assert.equal(stillApproved.rows[0]?.status, 'approved');
});

test('upload keys are bound to the request and old hashes are purged', async () => {
    const db = await database();
    const created = await call(
        db,
        `select public.create_gbp_approval_request($1,$2,$3,$4,$5,null,'[]'::jsonb,$6::jsonb) as result`,
        [owner, org, client, task, 'Photos', JSON.stringify([post('Kitchen')])],
    );
    const token = 'upload-token';
    await call(
        db,
        `select public.issue_gbp_approval_link($1,$2,$3,$4,$5::timestamptz) as result`,
        [owner, created.requestId, hash(token), expiry, now],
    );
    const reserved = await call(
        db,
        `select public.reserve_gbp_approval_upload($1,$2,$3,$4::timestamptz) as result`,
        [hash(token), 'image/jpeg', 1200, now],
    );
    assert.equal(reserved.ok, true);
    assert.equal(reserved.objectKey, `gbp-approvals/${created.requestId}/${reserved.reservationId}`);
    await assert.rejects(db.query(
        `insert into public.approval_upload_reservations
           (id, organization_id, request_id, link_id, object_key, content_type, byte_size, expires_at)
         select gen_random_uuid(), organization_id, request_id, link_id,
                'gbp-approvals/' || request_id::text || '/' || gen_random_uuid()::text,
                'image/png', 10, now() + interval '1 hour'
         from public.approval_links where request_id = $1`,
        [created.requestId],
    ));

    const other = await call(
        db,
        `select public.create_gbp_approval_request($1,$2,$3,$4,$5,null,'[]'::jsonb,$6::jsonb) as result`,
        [owner, otherOrg, otherClient, otherTask, 'Other', JSON.stringify([post('Other')])],
    );
    await call(
        db,
        `select public.issue_gbp_approval_link($1,$2,$3,$4,$5::timestamptz) as result`,
        [owner, other.requestId, hash('other-upload'), expiry, now],
    );
    const loaded = await call(
        db,
        `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
        [hash(token), now],
    );
    const item = (loaded.items as Array<{ id: string; version: { id: string } }>)[0];
    const stolen = await call(
        db,
        `select public.submit_gbp_approval($1,$2::jsonb,null,$3::timestamptz) as result`,
        [hash('other-upload'), JSON.stringify({
            idempotencyKey: 'steal-upload',
            requestHash: hash('steal'),
            respondentName: 'Casey',
            displayedVersionIds: [(await call(
                db,
                `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
                [hash('other-upload'), now],
            )).items as Array<{ version: { id: string } }>].flat().map(row => row.version.id),
            decisions: [{
                itemId: ((await call(
                    db,
                    `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
                    [hash('other-upload'), now],
                )).items as Array<{ id: string }>)[0].id,
                versionId: ((await call(
                    db,
                    `select public.get_gbp_approval_by_token($1,$2::timestamptz) as result`,
                    [hash('other-upload'), now],
                )).items as Array<{ version: { id: string } }>)[0].version.id,
                decision: 'changes_requested',
                comment: 'Use this photo',
                reservationId: reserved.reservationId,
            }],
            verifiedReservationIds: [reserved.reservationId],
            answers: [],
        }), now],
    );
    assert.equal(stolen.code, 'out_of_scope');
    assert.equal(item.version.id.length > 0, true);

    await db.query(
        `update public.approval_submissions set created_at = $1::timestamptz where request_hash = $2`,
        ['2025-01-01T00:00:00Z', hash('approve-all')],
    );
    const purged = await call(
        db,
        `select public.purge_gbp_approval_retention($1::timestamptz) as result`,
        ['2026-11-14T17:00:00Z'],
    );
    assert.equal(typeof purged.orphansDeleted, 'number');
    const names = await db.query<{ name: string | null; ip: string | null }>(
        `select respondent_name as name, ip_hash as ip from public.approval_submissions`,
    );
    assert.equal(names.rows.every(row => row.name === null || row.name.length > 0), true);
});
