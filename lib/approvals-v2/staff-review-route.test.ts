import assert from 'node:assert/strict';
import test from 'node:test';
import { createStaffReview } from './staff-review-route';
import type { createAdminClient } from '@/lib/supabase/admin';

const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const versionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const context = { params: Promise.resolve({ id: requestId }) };
const approved = { itemId, versionId, decision: 'approved' };

function fixture({
  actor = 'staff', role = 'member', stage = 'draft', archived = false, current = versionId, photo = 'photo', errorCode = '',
  body = 'Draft text', ctaLabel = 'Call now', ctaUrl = '', photoPaths,
}: {
  actor?: string | null; role?: string; stage?: string; archived?: boolean; current?: string; photo?: string | null;
  errorCode?: string; body?: string; ctaLabel?: string; ctaUrl?: string; photoPaths?: string[];
} = {}) {
  const rows: Record<string, unknown> = {
    organization_members: [{ organization_id: 'org', role }],
    approval_requests: { stage, archived_at: archived ? 'today' : null, organization_id: 'org' },
    approval_items: { item_type: 'gbp_post', page_kind: null, current_version_id: current },
    approval_item_versions: { payload: { body, ctaLabel, ctaUrl }, photo_path: photo, photo_paths: photoPaths },
  };
  const writes: unknown[][] = [];
  const reads: unknown[][] = [];
  const handler = createStaffReview({
    agencyActor: async () => actor,
    createAdminClient: () => ({
      from: (table: string) => {
        const result = { data: rows[table], error: null };
        const chain = {
          select: () => chain,
          eq: (...args: unknown[]) => { reads.push([table, ...args]); return chain; },
          maybeSingle: async () => result,
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
        };
        return chain;
      },
      rpc: (...args: unknown[]) => {
        writes.push(args);
        return { error: null, data: errorCode ? { ok: false, code: errorCode } : { ok: true, review: { decision: 'approved' } } };
      },
    }) as unknown as ReturnType<typeof createAdminClient>,
  });
  return {
    writes, reads,
    request: (payload: unknown, authorization = '') => handler(new Request('https://local.test', {
      method: 'POST', body: JSON.stringify(payload), headers: { authorization },
    }), context),
  };
}

test('staff review requires an authenticated writer and denies bot keys', async () => {
  assert.equal((await fixture({ actor: null }).request(approved)).status, 401);
  assert.equal((await fixture().request(approved, 'Bearer seo_bot_fixture')).status, 403);
  const viewer = fixture({ role: 'viewer' });
  assert.equal((await viewer.request(approved)).status, 403);
  assert.equal(viewer.writes.length, 0);
});

test('staff review rejects invalid notes, tags, ids and decisions', async () => {
  const { request, writes } = fixture();
  for (const body of [null, [], { ...approved, itemId: 'wrong' }, { ...approved, decision: 'pending' },
    { ...approved, decision: 'changes_requested', note: ' \n ' }, { ...approved, note: 'x'.repeat(4001) },
    { ...approved, tags: ['unexpected'] }, { ...approved, stage: 'sent' }]) {
    assert.equal((await request(body)).status, 400);
  }
  assert.equal(writes.length, 0);
});

test('staff review rejects non-draft, archived and stale versions including a race at the RPC', async () => {
  for (const options of [{ stage: 'sent' }, { archived: true }, { current: itemId }, { errorCode: 'refresh_required' }]) {
    assert.equal((await fixture(options).request(approved)).status, 409);
  }
});

test('staff approval checks blockers on the scoped version while request changes remains available', async () => {
  const { request, reads, writes } = fixture({ photo: null, body: 'x'.repeat(1501), ctaLabel: 'Book now' });
  const blocked = await request(approved);
  assert.equal(blocked.status, 400);
  assert.match((await blocked.json()).error, /Add a photo.*1,500.*button URL/);
  assert.equal(writes.length, 0);
  assert.ok(reads.some(read => read.join('/') === `approval_item_versions/item_id/${itemId}`));
  assert.ok(reads.some(read => read.join('/') === 'approval_item_versions/organization_id/org'));
  const response = await request({ ...approved, decision: 'changes_requested', note: ' Fix photo. ', tags: ['photo'] });
  assert.equal(response.status, 200);
  assert.deepEqual(writes, [['record_approval_staff_review', {
    p_actor: 'staff', p_request_id: requestId, p_item_id: itemId, p_version_id: versionId,
    p_decision: 'changes_requested', p_note: 'Fix photo.', p_tags: ['photo'],
  }]]);
  assert.equal((await fixture().request(approved)).status, 200);
  assert.equal((await fixture({ photo: null, photoPaths: ['first', 'second'] }).request(approved)).status, 200);
  assert.equal((await fixture({ photoPaths: [] }).request(approved)).status, 400);
});
