import assert from 'node:assert/strict';
import test from 'node:test';
import { createImageUpload } from './image-upload';
import { createCommentAction } from './comment-routes';
import { createSubmit } from '../gbp-approvals/submit-route';
import { normalizePageBody } from './page-body';
import { highlightAnchor } from './carry';
import type { createAdminClient } from '../supabase/admin';
type Admin = ReturnType<typeof createAdminClient>;
const itemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const requestId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const reservationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const token = 'a-token-with-more-than-twenty-characters';
const post = (body: unknown, bot = false) => new Request('https://local.test', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(bot ? { authorization: 'Bearer seo_bot_fixture' } : {}) }, body: JSON.stringify(body) });
function query(data: unknown, filters: [
  string,
  unknown
][] = []) {
  const result = { data, error: null };
  const chain = {
    select: () => chain,
    eq: (key: string, value: unknown) => {
      filters.push([key, value]);
      return chain;
    },
    in: () => chain,
    gt: () => chain,
    maybeSingle: async () => result,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  };
  return chain;
}
test('public image reservation is token/released-version scoped and validates size/type before storage', async () => {
  let called = false;
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      called = true;
      assert.equal(name, 'reserve_approval_image_upload');
      assert.equal(args.p_item_id, itemId);
      assert.equal(args.p_version_id, versionId);
      assert.match(String(args.p_token_hash), /^[a-f0-9]{64}$/);
      return { data: { ok: false, code: 'out_of_scope' }, error: null };
    }
  } as unknown as Admin;
  const handler = createImageUpload(false, { createAdminClient: () => admin });
  const context = { params: Promise.resolve({ token }) };
  assert.equal((await handler(post({ itemId, versionId, contentType: 'image/svg+xml', byteSize: 100 }), context)).status, 400);
  assert.equal(called, false);
  const denied = await handler(post({ itemId, versionId, contentType: 'image/png', byteSize: 100 }), context);
  assert.equal(denied.status, 400);
  assert.equal(denied.headers.get('Cache-Control'), 'no-store');
  assert.equal(denied.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(called, true);
});
test('complete cannot download another request reservation or a draft version', async () => {
  const filters: [
    string,
    unknown
  ][] = [];
  const admin = {
    rpc: async () => ({ data: { ok: true, version: { id: versionId } }, error: null }),
    from: (table: string) => query(table === 'approval_links' ? { id: itemId, request_id: requestId } : null, filters),
    storage: { from: () => {
        throw new Error('Must not access storage');
      } }
  } as unknown as Admin;
  const response = await createImageUpload(true, { createAdminClient: () => admin })(post({ itemId }), { params: Promise.resolve({ token, reservationId }) });
  assert.equal(response.status, 404);
  for (const pair of [['request_id', requestId], ['link_id', itemId], ['version_id', versionId], ['purpose', 'image_replacement'], ['status', 'reserved']])
    assert.ok(filters.some(filter => JSON.stringify(filter) === JSON.stringify(pair)));
});
test('staff comment routes reject bots and anonymous callers before database access', async () => {
  const handler = createCommentAction({ agencyActor: async () => null, createAdminClient: () => {
      throw new Error('Must not access database');
    } });
  const context = { params: Promise.resolve({ id: requestId, commentId: itemId }) };
  assert.equal((await handler(post({ action: 'accept' }, true), context)).status, 403);
  assert.equal((await handler(post({ action: 'accept' }), context)).status, 401);
});
test('submit forwards genuine highlight anchors and rejects spoofed quotes and SEO anchors', async () => {
  const normalized = normalizePageBody({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello 😀 world' }] }] });
  const anchor = highlightAnchor(normalized.body.content[0], normalized.outline[0].blocks[0].hash, 6, 7);
  let submits = 0;
  const admin = {
    from: (table: string) => query(table === 'approval_links' ? { id: itemId, request_id: requestId, expires_at: '2099-01-01' } : table === 'approval_items' ? { released_version_id: versionId } : { payload: { body: normalized.body }, outline: normalized.outline }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, 'submit_approval');
      assert.equal((args.p_payload as {
        comments: {
          quote: string;
        }[];
      }).comments[0].quote, '😀');
      submits++;
      return { data: { ok: true }, error: null };
    }
  } as unknown as Admin;
  const handler = createSubmit({ createAdminClient: () => admin, clientIpHash: () => null });
  const context = { params: Promise.resolve({ token }) };
  const body = { itemType: 'page', respondentName: 'Casey', displayedVersionIds: [versionId], decisions: [{ itemId, versionId, decision: 'approved' }], comments: [{ ...anchor, itemId, versionId, body: 'A comment' }] };
  assert.equal((await handler(post(body), context)).status, 200);
  assert.equal((await handler(post({ ...body, comments: [{ ...body.comments[0], quote: 'x' }] }), context)).status, 400);
  assert.equal((await handler(post({ ...body, comments: [{ ...body.comments[0], anchorKind: 'field', fieldKey: 'metaTitle' }] }), context)).status, 400);
  assert.equal(submits, 1);
});
