import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { database, call, post, hash, org, otherOrg, owner, viewer, client, otherClient, task, otherTask, now, later, expiry } from './test-database.ts';

const migration = readFileSync(new URL('../../migrations/144_approval_internal_review_links.sql', import.meta.url), 'utf8');
type Db = Awaited<ReturnType<typeof database>>;

async function setup() {
    const db = await database();
    await db.exec('alter table public.bot_api_keys add column revoked_at timestamptz');
    await db.exec(migration);
    return db;
}

async function draft(db: Db, title: string, tenant = org, account = client, work = task) {
    const result = await call(db, "select create_approval_request($1,$2,$3,$4,'gbp_post',$5,null,'[]',$6) result",
        [owner, tenant, account, work, title, JSON.stringify([post(title)])]);
    assert.equal(result.ok, true);
    return String(result.requestId);
}

function issue(db: Db, anchor: string | null, account: string | null, token: string, actor = owner, key: string | null = null, retry: string | null = null, days = 7) {
    return call(db, 'select issue_approval_internal_link($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
        [actor, key, anchor, account, hash(token), days, retry, org, now]);
}

function review(db: Db, token: string, at = later) {
    return call(db, 'select get_approval_internal_review($1,$2) result', [hash(token), at]);
}

async function ids(db: Db, requestId: string) {
    return (await db.query<{ itemId: string; versionId: string }>(`select id "itemId", current_version_id "versionId"
        from approval_items where request_id=$1`, [requestId])).rows[0];
}

function feedback(db: Db, token: string, target: Awaited<ReturnType<typeof ids>>, comment = 'Looks ready', retry = 'feedback-001') {
    return call(db, 'select submit_approval_internal_feedback($1,$2,$3,$4,$5,$6,$7,$8) result',
        [hash(token), target.itemId, target.versionId, 'Reviewer', 'approved', comment, retry, later]);
}

function send(db: Db, id: string, rpc: 'send_approval_request' | 'issue_gbp_approval_link' = 'send_approval_request') {
    return call(db, `select ${rpc}($1,$2,$3,$4,$5) result`, [owner, id, hash(id), expiry, later]);
}

const missing = { ok: false, code: 'not_found' };

test('144 mirrors schema, protects tables and RPCs, and enforces link and feedback constraints', async t => {
    const db = await setup();
    t.after(() => db.close());
    assert.ok(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').endsWith(migration));
    const { rows } = await db.query(`select relname, relrowsecurity from pg_class where relname in
        ('approval_internal_links', 'approval_internal_feedback') order by relname`);
    assert.deepEqual(rows, [
        { relname: 'approval_internal_feedback', relrowsecurity: true },
        { relname: 'approval_internal_links', relrowsecurity: true },
    ]);
    for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`);
        try {
            await assert.rejects(db.query('select * from approval_internal_links'), /permission denied/);
            await assert.rejects(db.query('select * from approval_internal_feedback'), /permission denied/);
            await assert.rejects(db.query('select get_approval_internal_review($1,$2)', [hash('x'), now]), /permission denied/);
            await assert.rejects(db.query('select submit_approval_internal_feedback(null,null,null,null,null,null,null,null)'), /permission denied/);
            await assert.rejects(db.query('select issue_approval_internal_link(null,null,null,null,null,null,null,null,null)'), /permission denied/);
        } finally {
            await db.exec('reset role');
        }
    }
    const id = await draft(db, 'Batch');
    assert.equal((await issue(db, id, null, 'private', viewer)).code, 'forbidden');
    assert.equal((await issue(db, id, null, 'private', owner, null, null, 31)).code, 'invalid_request');
    assert.equal((await issue(db, id, null, 'private')).ok, true);
    await assert.rejects(db.query("update approval_internal_links set token_hash='secret'"), /check constraint/);
    await assert.rejects(db.query("update approval_internal_links set scope='client'"), /check constraint/);
    await assert.rejects(db.query("update approval_internal_links set expires_at=created_at"), /check constraint/);
    const target = await ids(db, id);
    assert.equal((await feedback(db, 'private', target)).ok, true);
    await assert.rejects(db.query("update approval_internal_feedback set decision='rejected'"), /check constraint/);
    await db.exec('set role service_role');
    try {
        await assert.rejects(db.query("update approval_internal_feedback set comment='edit'"), /permission denied/);
        await assert.rejects(db.query('delete from approval_internal_feedback'), /permission denied/);
    } finally {
        await db.exec('reset role');
    }
});

test('144 review scopes follow current drafts and deny unusable links uniformly', async t => {
    const db = await setup();
    t.after(() => db.close());
    const a = await draft(db, 'First in scope');
    const b = await draft(db, 'Second in scope');
    const other = await draft(db, 'Other organization private', otherOrg, otherClient, otherTask);
    const siblingClient = randomUUID();
    const siblingTask = randomUUID();
    await db.query("insert into clients values ($1,$2,'Sibling client',null)", [siblingClient, org]);
    await db.query("insert into tasks(id,organization_id,client_id,title) values ($1,$2,$3,'Sibling task')", [siblingTask, org, siblingClient]);
    const sibling = await draft(db, 'Other client same organization', org, siblingClient, siblingTask);
    assert.deepEqual(await issue(db, other, null, 'foreign'), missing);
    await issue(db, a, null, 'request');
    await issue(db, a, client, 'client');
    await issue(db, b, null, 'expired', owner, null, null, 1);
    await issue(db, b, null, 'revoked');
    await db.exec('set role service_role');
    try {
        await db.query('update approval_internal_links set revoked_at=$1,revoked_by=$2 where token_hash=$3', [later, owner, hash('revoked')]);
    } finally {
        await db.exec('reset role');
    }
    const titles = async (token: string) => ((await review(db, token)).batches as { title: string }[]).map(batch => batch.title);
    assert.deepEqual(await titles('request'), ['First in scope']);
    assert.deepEqual((await titles('client')).sort(), ['First in scope', 'Second in scope']);
    assert.deepEqual(await review(db, 'unknown'), missing);
    assert.deepEqual(await review(db, 'expired'), missing);
    assert.deepEqual(await review(db, 'revoked'), missing);
    assert.deepEqual(await feedback(db, 'client', await ids(db, sibling)), missing);
    for (const unusable of ['unknown', 'expired', 'revoked']) {
        assert.deepEqual(await feedback(db, unusable, await ids(db, b)), missing);
    }
    const empty = await draft(db, 'Empty');
    await issue(db, empty, null, 'empty');
    await db.query('delete from approval_items where request_id=$1', [empty]);
    assert.deepEqual(await review(db, 'empty'), missing);
    assert.equal((await send(db, a)).ok, true);
    assert.deepEqual(await review(db, 'request'), missing);
    assert.deepEqual(await titles('client'), ['Second in scope']);
    await db.query('update approval_requests set archived_at=$1 where id=$2', [later, b]);
    assert.deepEqual(await review(db, 'client'), missing);
    assert.deepEqual(await feedback(db, 'client', await ids(db, b)), missing);
});

test('144 feedback is scoped, tied to the current version, and changes no client-facing state', async t => {
    const db = await setup();
    t.after(() => db.close());
    const id = await draft(db, 'Post');
    const outside = await draft(db, 'Separate batch');
    await issue(db, id, null, 'review');
    await issue(db, id, null, 'second-link');
    const target = await ids(db, id);
    const snapshot = async () => (await db.query(`select
        (select jsonb_agg(r order by id) from approval_requests r) requests,
        (select jsonb_agg(i order by id) from approval_items i) items,
        (select count(*) from approval_events) events,
        (select count(*) from approval_links) links,
        (select count(*) from approval_responses) responses,
        (select count(*) from approval_submissions) submissions,
        (select count(*) from notifications) notifications`)).rows;
    const before = await snapshot();
    assert.deepEqual(await feedback(db, 'review', await ids(db, outside)), missing);
    assert.equal((await feedback(db, 'review', target)).ok, true);
    assert.equal((await feedback(db, 'review', target)).idempotent, true);
    assert.equal((await feedback(db, 'review', target, 'Different')).code, 'idempotency_conflict');
    assert.deepEqual(await snapshot(), before);
    assert.equal((await db.query('select * from approval_internal_feedback')).rows.length, 1);
    const own = (await review(db, 'review')).batches;
    assert.match(JSON.stringify(own), /Looks ready/);
    assert.doesNotMatch(JSON.stringify(await review(db, 'second-link')), /Looks ready/);
    const updated = await call(db, "select post_approval_version($1,$2,$3,$4) result",
        [owner, id, JSON.stringify([{ itemId: target.itemId, payload: post('Updated').payload, source: 'manual', changeNote: 'Private change note' }]), later]);
    assert.equal(updated.ok, true);
    assert.equal((await feedback(db, 'review', target)).code, 'refresh_required');
    assert.doesNotMatch(JSON.stringify(await review(db, 'review')), /Looks ready|Private change note/);
});

test('144 leaves both send entry points able to mint the first client link', async t => {
    const db = await setup();
    t.after(() => db.close());
    for (const rpc of ['send_approval_request', 'issue_gbp_approval_link'] as const) {
        const id = await draft(db, rpc);
        await issue(db, id, null, rpc);
        assert.deepEqual((await db.query(`select stage, round, sent_at,
            (select count(*)::integer from approval_links where request_id=r.id) links,
            (select status from approval_items where request_id=r.id) status
            from approval_requests r where id=$1`, [id])).rows,
        [{ stage: 'draft', round: 1, sent_at: null, links: 0, status: 'pending' }]);
        assert.equal((await send(db, id, rpc)).ok, true);
        assert.deepEqual((await db.query('select token_hash from approval_links where request_id=$1', [id])).rows, [{ token_hash: hash(id) }]);
        assert.deepEqual(await review(db, rpc), missing);
    }
});

test('144 bot retries never create another link or recover the raw URL', async t => {
    const db = await setup();
    t.after(() => db.close());
    const key = randomUUID();
    await db.query('insert into bot_api_keys(id,organization_id) values($1,$2)', [key, org]);
    await draft(db, 'Bot review');
    const create = (token: string, days = 7) => call(db, 'select issue_approval_internal_link(null,$1,null,$2,$3,$4,$5,$6,$7) result',
        [key, client, hash(token), days, 'bot-retry-001', org, now]);
    assert.equal((await create('first')).ok, true);
    assert.deepEqual(await create('retry'), { ok: true, idempotent: true, expiresAt: '2026-11-21T17:00:00+00:00' });
    assert.equal((await create('conflict', 5)).code, 'idempotency_conflict');
    assert.deepEqual((await db.query('select token_hash,created_by_bot_key_id from approval_internal_links')).rows,
        [{ token_hash: hash('first'), created_by_bot_key_id: key }]);
});


test('144 rate limits reads and new feedback without writing client review hits', async t => {
    const db = await setup();
    t.after(() => db.close());
    const id = await draft(db, 'Rate limited');
    await issue(db, id, null, 'limited');
    const target = await ids(db, id);
    const submit = (index: number) => feedback(db, 'limited', target, 'Ready', `feedback-${index}`);
    for (let i = 0; i < 60; i++) assert.equal((await submit(i)).ok, true);
    assert.equal((await submit(60)).code, 'rate_limited');
    assert.equal((await submit(0)).idempotent, true);
    assert.deepEqual((await db.query('select * from approval_public_hits')).rows, []);

    assert.equal((await review(db, 'limited')).ok, true);
    const hit = (await db.query<{ token_hash: string }>('select token_hash from approval_public_hits')).rows[0];
    assert.notEqual(hit.token_hash, hash('limited'));
    await db.query(`insert into approval_public_hits(token_hash,action,created_at)
        select $1,'read',$2 from generate_series(1,119)`, [hit.token_hash, later]);
    assert.deepEqual(await review(db, 'limited'), missing);
    const stats = (await db.query('select view_count, last_viewed_at from approval_internal_links')).rows;
    assert.deepEqual(stats, [{ view_count: 1, last_viewed_at: new Date(later) }]);
});
