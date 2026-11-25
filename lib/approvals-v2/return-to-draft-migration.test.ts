import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import { assignee, call, client, database, expiry, hash, later, member, now, org, otherOrg, owner, post, task, viewer } from './test-database';

const migration = readFileSync(new URL('../../migrations/148_approval_return_to_draft.sql', import.meta.url), 'utf8');
const sendRpc = 'select send_approval_request($1,$2,$3,$4,$5) result';
const issueRpc = 'select issue_gbp_approval_link($1,$2,$3,$4,$5) result';
const oldHash = hash('first client link');
type Db = Awaited<ReturnType<typeof database>>;

async function setup(t: TestContext) {
  const db = await database();
  t.after(() => db.close());
  await db.exec('alter table public.users add column full_name text; alter table public.bot_api_keys add column revoked_at timestamptz');
  for (const filename of ['144_approval_internal_review_links.sql', '145_gbp_approval_multi_photo.sql',
    '146_gbp_comment_only_notifications.sql', '147_approval_staff_reviews.sql']) {
    await db.exec(readFileSync(new URL(`../../migrations/${filename}`, import.meta.url), 'utf8'));
  }
  await db.exec(migration);
  return db;
}

async function draft(db: Db) {
  const created = await call(db, "select create_approval_request($1,$2,$3,$4,'gbp_post','Review',null,'[]',$5) result",
    [owner, org, client, task, JSON.stringify([post('Review')])]);
  assert.equal(created.ok, true);
  return String(created.requestId);
}

function returnToDraft(db: Db, requestId: string, actor = member, at: string | null = later) {
  return call(db, 'select return_approval_to_draft($1,$2,$3) result', [actor, requestId, at]);
}

test('148 is mirrored in the schema and restricts the return and send RPCs to service_role', async t => {
  assert.ok(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8').includes(migration));
  const db = await setup(t);
  const grants = await db.query(`select role,
    has_function_privilege(role, 'public.return_approval_to_draft(uuid,uuid,timestamptz)', 'EXECUTE') can_return,
    has_function_privilege(role, 'public.send_approval_request(uuid,uuid,text,timestamptz,timestamptz)', 'EXECUTE') can_send
    from (values ('anon'), ('authenticated'), ('service_role')) roles(role) order by role`);
  assert.deepEqual(grants.rows, [
    { role: 'anon', can_return: false, can_send: false },
    { role: 'authenticated', can_return: false, can_send: false },
    { role: 'service_role', can_return: true, can_send: true },
  ]);

  const id = await draft(db);
  assert.equal((await returnToDraft(db, task)).code, 'not_found');
  assert.equal((await returnToDraft(db, id)).code, 'not_sent');
  assert.equal((await call(db, sendRpc, [owner, id, oldHash, expiry, now])).ok, true);
  await db.query('update organization_members set organization_id=$1 where user_id=$2', [otherOrg, assignee]);
  await db.query("insert into approval_bot_actors (user_id, label) values ($1, 'Review bot')", [owner]);
  for (const actor of [viewer, assignee, owner]) {
    assert.equal((await returnToDraft(db, id, actor)).code, 'forbidden');
  }
  assert.equal((await returnToDraft(db, id, member, null)).code, 'invalid_request');
  assert.equal((await call(db, 'select archive_approval_request($1,$2,$3) result', [member, id, later])).ok, true);
  assert.equal((await returnToDraft(db, id)).code, 'archived');
});

test('148 returns a sent request to draft and both send paths rotate the link with its history intact', async t => {
  const db = await setup(t);
  const id = await draft(db);
  const internalHash = hash('internal review');
  const item = async () => (await db.query<{ id: string; current_version_id: string; previous_released_version_id: string | null }>(
    'select id, current_version_id, previous_released_version_id from approval_items where request_id=$1', [id])).rows[0];
  const original = await item();
  assert.equal((await call(db, 'select record_approval_staff_review($1,$2,$3,$4,$5,null,$6) result',
    [owner, id, original.id, original.current_version_id, 'approved', []])).ok, true);
  assert.equal((await call(db, 'select issue_approval_internal_link($1,null,$2,null,$3,7,null,$4,$5) result',
    [owner, id, internalHash, org, now])).ok, true);
  assert.equal((await call(db, "select submit_approval_internal_feedback($1,$2,$3,'Staff reviewer',null,'Internal note','internal-key',$4,1) result",
    [internalHash, original.id, original.current_version_id, now])).ok, true);
  const firstSend = await call(db, sendRpc, [owner, id, oldHash, expiry, now]);
  assert.deepEqual(firstSend, { ok: true, linkId: firstSend.linkId, rotated: false });
  assert.equal((await call(db, 'select post_approval_version($1,$2,$3,$4) result',
    [owner, id, JSON.stringify([{ ...post('Revised'), itemId: original.id, changeNote: 'Updated copy' }]), now])).ok, true);
  const revised = await item();
  assert.equal(revised.previous_released_version_id, original.current_version_id);
  assert.equal((await call(db, "select reserve_gbp_approval_upload($1,'image/png',256,$2) result", [oldHash, now])).ok, true);
  const submitted = await call(db, 'select submit_gbp_approval($1,$2,null,$3) result', [oldHash, JSON.stringify({
    idempotencyKey: 'client-review', requestHash: hash('review'), respondentName: 'Client reviewer',
    displayedVersionIds: [revised.current_version_id], answers: [],
    decisions: [{ itemId: revised.id, versionId: revised.current_version_id, decision: 'approved' }],
  }), now]);
  assert.equal(submitted.ok, true);

  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(i) order by i.id) from approval_items i) items,
    (select jsonb_agg(to_jsonb(v) order by v.id) from approval_item_versions v) versions,
    (select jsonb_agg(to_jsonb(s)) from approval_submissions s) submissions,
    (select jsonb_agg(to_jsonb(r)) from approval_responses r) responses,
    (select jsonb_agg(to_jsonb(u)) from approval_upload_reservations u) reservations,
    (select jsonb_agg(to_jsonb(l)) from approval_internal_links l) internal_links,
    (select jsonb_agg(to_jsonb(f)) from approval_internal_feedback f) internal_feedback,
    (select jsonb_agg(to_jsonb(s)) from approval_staff_reviews s) staff_reviews,
    (select jsonb_agg(to_jsonb(n) order by n.id) from notifications n) notifications`)).rows;
  const before = await snapshot();
  const publicView = (tokenHash: string) => call(db, 'select get_approval_by_token($1,$2) result', [tokenHash, later]);
  const link = async () => (await db.query('select id, token_hash, expires_at, revoked_at, extended_at, created_by from approval_links')).rows[0];
  const request = async () => (await db.query('select stage, round, sent_at, sent_by, updated_at from approval_requests where id=$1', [id])).rows[0];

  let previousHash = oldHash;
  for (const [rpc, newHash] of [[sendRpc, hash('resent client link')], [issueRpc, hash('issued client link')]]) {
    assert.deepEqual(await returnToDraft(db, id), { ok: true });
    assert.deepEqual(await request(), { stage: 'draft', round: 2, sent_at: null, sent_by: null, updated_at: new Date(later) });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await db.query("select actor_id, detail, created_at from approval_events where request_id=$1 and kind='link_revoked'", [id])).rows,
      Array.from({ length: rpc === sendRpc ? 1 : 2 }, () => ({ actor_id: member, detail: {}, created_at: new Date(later) })));
    assert.equal((await link()).revoked_at?.toISOString(), later);
    assert.equal((await publicView(previousHash)).state, 'revoked');
    assert.equal((await call(db, 'select extend_gbp_approval_link($1,$2,$3,$4) result', [owner, id, expiry, later])).code, 'revoked');
    assert.equal((await call(db, issueRpc, [member, id, newHash, expiry, later])).code, 'forbidden');
    assert.equal((await link()).revoked_at?.toISOString(), later);

    assert.deepEqual(await call(db, rpc, [owner, id, newHash, expiry, later]), { ok: true, linkId: firstSend.linkId, rotated: true });
    assert.deepEqual(await request(), { stage: 'sent', round: 2, sent_at: new Date(later), sent_by: owner, updated_at: new Date(later) });
    assert.deepEqual(await link(), { id: firstSend.linkId, token_hash: newHash, expires_at: new Date(expiry), revoked_at: null,
      extended_at: new Date(later), created_by: owner });
    assert.deepEqual(await snapshot(), before);
    assert.equal((await publicView(previousHash)).code, 'not_found');
    assert.equal((await publicView(newHash)).state, 'active');
    previousHash = newHash;
  }
});

test('148 keeps an earlier revocation and rejects client operations on a draft', async t => {
  const db = await setup(t);
  const id = await draft(db);
  assert.equal((await call(db, sendRpc, [owner, id, oldHash, expiry, now])).ok, true);
  assert.equal((await call(db, 'select revoke_gbp_approval_link($1,$2,$3) result', [owner, id, now])).ok, true);
  const revocations = () => db.query("select * from approval_events where kind='link_revoked'");
  const before = (await revocations()).rows;
  assert.equal(before.length, 1);
  assert.deepEqual(await returnToDraft(db, id), { ok: true });
  assert.deepEqual((await db.query('select revoked_at from approval_links')).rows, [{ revoked_at: new Date(now) }]);
  assert.deepEqual((await revocations()).rows, before);

  // Even an inconsistent row with a live link cannot expose draft data or be extended.
  await db.query('update approval_links set revoked_at=null where request_id=$1', [id]);
  assert.equal((await call(db, 'select get_approval_by_token($1,$2) result', [oldHash, later])).state, 'revoked');
  assert.equal((await call(db, 'select extend_gbp_approval_link($1,$2,$3,$4) result', [owner, id, expiry, later])).code, 'revoked');
  assert.equal((await call(db, sendRpc, [owner, id, hash('another client link'), expiry, later])).code, 'link_exists');
});
