import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { database, call, post, org, otherOrg, owner, member, viewer, client, task, now, later, expiry, hash } from './test-database';

const internalLinksMigration = readFileSync(new URL('../../migrations/144_approval_internal_review_links.sql', import.meta.url), 'utf8');
const multiPhotoMigration = readFileSync(new URL('../../migrations/145_gbp_approval_multi_photo.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../migrations/147_approval_staff_reviews.sql', import.meta.url), 'utf8');

test('147 records isolated staff decisions and enforces grants, draft status, roles and current versions', async t => {
  const db = await database();
  t.after(() => db.close());
  await db.exec("alter table public.users add column full_name text; update public.users set full_name = 'Review Owner'; alter table public.bot_api_keys add column revoked_at timestamptz");
  await db.exec(internalLinksMigration);
  await db.exec(multiPhotoMigration);
  await db.exec(migration);
  const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
  assert.ok(schema.endsWith(multiPhotoMigration + '\n' + migration));

  const grants = await db.query(`select relrowsecurity, roles.role,
    has_table_privilege(roles.role, 'public.approval_staff_reviews', 'SELECT') can_read,
    has_table_privilege(roles.role, 'public.approval_staff_reviews', 'INSERT') can_insert,
    has_table_privilege(roles.role, 'public.approval_staff_reviews', 'UPDATE') can_update,
    has_table_privilege(roles.role, 'public.approval_staff_reviews', 'DELETE') can_delete,
    has_function_privilege(roles.role, 'public.record_approval_staff_review(uuid,uuid,uuid,uuid,text,text,text[])', 'EXECUTE') can_review
    from pg_class cross join (values ('anon'), ('authenticated'), ('service_role')) roles(role)
    where oid = 'public.approval_staff_reviews'::regclass order by roles.role`);
  assert.deepEqual(grants.rows, ['anon', 'authenticated', 'service_role'].map(role => ({
    role, relrowsecurity: true, can_read: role === 'service_role', can_insert: false, can_update: false, can_delete: false, can_review: role === 'service_role',
  })));
  const first = post('First');
  const photoPaths = [first.photoPath, 'https://example.test/photo-2.jpg', 'https://example.test/photo-3.jpg'];
  const created = await call(db, "select create_approval_request($1,$2,$3,$4,'gbp_post','Staff review',null,'[]',$5) result",
    [owner, org, client, task, JSON.stringify([{ ...first, photoPaths }, { ...post('Second'), position: 2 }])]);
  assert.equal(created.ok, true);
  const requestId = String(created.requestId);
  const internalLink = await call(db, 'select issue_approval_internal_link($1,null,$2,null,$3,7,null,$4,$5) result',
    [owner, requestId, hash('internal only'), org, now]);
  assert.equal(internalLink.ok, true);
  const [item, sibling] = (await db.query<{ id: string; current_version_id: string }>(
    'select id, current_version_id from approval_items where request_id=$1 order by position', [requestId])).rows;
  const review = (decision: string, note: string | null = null, options: { actor?: string; version?: string; tags?: (string | null)[] } = {}) => call(db,
    'select record_approval_staff_review($1,$2,$3,$4,$5,$6,$7) result',
    [options.actor ?? owner, requestId, item.id, options.version ?? item.current_version_id, decision, note, options.tags ?? []]);

  const unchanged = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(r)) from approval_requests r) requests,
    (select jsonb_agg(to_jsonb(i) order by i.id) from approval_items i) items,
    (select jsonb_agg(to_jsonb(v) order by v.id) from approval_item_versions v) versions,
    (select jsonb_agg(to_jsonb(l)) from approval_links l) links,
    (select jsonb_agg(to_jsonb(l)) from approval_internal_links l) internal_links,
    (select jsonb_agg(to_jsonb(n)) from notifications n) notifications,
    (select jsonb_agg(to_jsonb(r)) from approval_responses r) responses,
    (select jsonb_agg(to_jsonb(e) order by e.id) from approval_events e) events`)).rows;
  const before = await unchanged();
  await db.query('update organization_members set organization_id=$1 where organization_id=$2 and user_id=$3', [otherOrg, org, member]);
  assert.equal((await review('approved', null, { actor: member })).code, 'forbidden');
  assert.equal((await review('approved', null, { actor: viewer })).code, 'forbidden');
  assert.equal((await review('approved', null, { version: sibling.current_version_id })).code, 'refresh_required');
  assert.equal((await review('changes_requested', ' \t\n ')).code, 'invalid_request');
  assert.equal((await review('changes_requested', 'x'.repeat(4001))).code, 'invalid_request');
  assert.equal((await review('approved', null, { tags: [null] })).code, 'invalid_request');
  assert.equal((await review('approved', null, { tags: ['invalid'] })).code, 'invalid_request');

  const approved = await review('approved');
  assert.equal(approved.ok, true);
  assert.deepEqual(await review('approved'), approved);
  const change = await review('changes_requested', '  Check the headline.\n', { tags: ['photo', 'copy', 'copy'] });
  assert.equal(change.ok, true);
  assert.deepEqual(change.review, {
    decision: 'changes_requested', note: 'Check the headline.', tags: ['copy', 'photo'],
    reviewer_id: owner, reviewer_name: 'Review Owner', created_at: (change.review as { created_at: string }).created_at,
    version_id: item.current_version_id,
  });
  assert.equal((await db.query('select * from approval_staff_reviews')).rows.length, 2);
  assert.deepEqual(await unchanged(), before);

  const edit = await call(db, 'select post_approval_version($1,$2,$3,$4) result',
    [owner, requestId, JSON.stringify([{ ...post('Revised'), itemId: item.id, expectedVersionId: item.current_version_id,
      photoPaths: [photoPaths[0], 'https://example.test/replaced.jpg', photoPaths[2]] }]), now]);
  assert.equal(edit.ok, true);
  assert.equal((await review('approved')).code, 'refresh_required');
  const current = (await db.query<{ current_version_id: string }>('select current_version_id from approval_items where id=$1', [item.id])).rows[0].current_version_id;
  assert.equal((await db.query('select * from approval_staff_reviews where version_id=$1', [current])).rows.length, 0);
  const archived = await call(db, 'select archive_approval_request($1,$2,$3) result', [owner, requestId, later]);
  assert.equal(archived.ok, true);
  assert.equal((await review('approved', null, { version: current })).code, 'not_draft');
  assert.equal((await call(db, 'select unarchive_approval_request($1,$2,$3) result', [owner, requestId, later])).ok, true);
  assert.equal((await call(db, 'select send_approval_request($1,$2,$3,$4,$5) result', [owner, requestId, hash(requestId), expiry, later])).ok, true);
  assert.equal((await review('approved', null, { version: current })).code, 'not_draft');
});
