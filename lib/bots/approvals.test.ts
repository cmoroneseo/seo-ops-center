import assert from 'node:assert/strict';
import test from 'node:test';
import { GBP_POST_SCHEMA_VERSION } from '../gbp-approvals/registry.ts';
import { parseBotApproval, botApprovalRpcArgs } from './approvals.ts';
const payload = {
  schemaVersion: GBP_POST_SCHEMA_VERSION,
  postType: 'offer',
  title: 'Free Kitchen Walkthrough + Written Quote in 48 Hours',
  body: 'Once the leftovers are gone, tap below.',
  offerStart: '2026-11-23',
  offerEnd: '2026-12-31',
  scheduledDate: '2026-11-23',
  ctaUrl: 'https://allinone-const.com/contact/',
  ctaLabel: 'View offer',
  terms: 'Ends Dec 31.'
};
test('a bot can describe an approval request and cannot ask for a link', () => {
  const parsed = parseBotApproval({
    idempotencyKey: 'holiday-posts-1',
    clientId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    taskId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    title: 'GBP holiday posts',
    items: [{
      position: 1,
      payload,
      photoPath: 'https://allinone-const.com/photos/post.jpg'
    }],
    questions: [{
      prompt: 'Does the request have to be in by Dec 31?',
      itemPosition: null
    }]
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.command.items[0]?.payload.scheduledDate, '2026-11-23');
  assert.equal('token' in parsed.command, false);
  const link = parseBotApproval({
    idempotencyKey: 'holiday-posts-1',
    clientId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    taskId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    title: 'GBP holiday posts',
    token: 'raw-token',
    items: [{
      position: 1,
      payload
    }]
  });
  assert.equal(link.ok, false);
  if (link.ok) return;
  assert.equal(link.status, 403);
});
test('normalized bot commands pass stable retry identity to SQL', () => {
  const input = {
    idempotencyKey: 'bot-retry-001',
    clientName: 'Client',
    taskTitle: 'Task',
    title: 'Posts',
    items: [{
      position: 1,
      payload
    }]
  };
  const first = parseBotApproval(input);
  const retry = parseBotApproval({
    ...input,
    title: ' Posts '
  });
  const changed = parseBotApproval({
    ...input,
    title: 'Changed posts'
  });
  assert.ok(first.ok && retry.ok && changed.ok);
  assert.equal(first.command.requestHash, retry.command.requestHash);
  assert.notEqual(first.command.requestHash, changed.command.requestHash);
  const args = botApprovalRpcArgs(first.command, 'actor', 'org', 'client', 'task');
  assert.equal(args.p_idempotency_key, input.idempotencyKey);
  assert.equal(args.p_request_hash, first.command.requestHash);
  assert.equal(args.p_organization_id, 'org');
});
test('v2 GBP normalization pins the v1 request hash, including explicit default itemType', () => {
  const fixture = {
    idempotencyKey: 'bot-retry-001',
    clientName: 'Client',
    taskTitle: 'Task',
    title: 'Posts',
    items: [{
      position: 1,
      payload
    }]
  };
  const implicit = parseBotApproval(fixture);
  const explicit = parseBotApproval({
    ...fixture,
    itemType: 'gbp_post'
  });
  assert.ok(implicit.ok && explicit.ok);
  assert.equal(implicit.command.requestHash, '7d43e3b60b29a9ef1ed4e3667441cc89b952a0d254f6cbd3758db19510d88590');
  assert.equal(explicit.command.requestHash, implicit.command.requestHash);
  assert.equal('itemType' in explicit.command, false);
});
test('v2 rejects all release controls and rejects incomplete page payloads', () => {
  for (const key of ['send', 'stage', 'status', 'sentAt', 'released', 'releasedAt', 'releasedVersionId']) {
    const parsed = parseBotApproval({
      [key]: false
    });
    assert.ok(!parsed.ok);
    assert.equal(parsed.status, 400);
    assert.equal(parsed.code, 'forbidden');
  }
  const page = parseBotApproval({
    itemType: 'page'
  });
  assert.ok(!page.ok);
  assert.equal(page.status, 400);
  assert.equal(page.code, 'invalid_request');
  const unknown = parseBotApproval({
    itemType: 'video'
  });
  assert.ok(!unknown.ok);
  assert.equal(unknown.status, 400);
});

test('the bot sends ordered HTTPS galleries and includes their order in the retry hash', () => {
  const photos = ['https://drive.google.com/thumbnail?id=first', 'https://example.com/second.jpg'];
  const command = (photoPaths: unknown) => parseBotApproval({
    clientName: 'Client', taskTitle: 'Task', title: 'Posts', idempotencyKey: 'gallery-retry-1',
    items: [{ position: 1, photoPaths, payload: { ...payload, postType: 'update', offerStart: null, offerEnd: null } }],
  });
  const first = command(photos);
  const reordered = command([...photos].reverse());
  assert.ok(first.ok && reordered.ok);
  assert.notEqual(first.command.requestHash, reordered.command.requestHash);
  const { p_items: [item] } = botApprovalRpcArgs(first.command, 'actor', 'org', 'client', 'task');
  assert.deepEqual(item.photoPaths, photos);
  assert.equal(item.photoPath, photos[0]);
  assert.equal(item.payload.offerEnd, null);
  for (const invalid of [Array(11).fill(photos[0]), [photos[0], 'javascript:alert(1)'], [photos[0], 'gbp-approvals/private/key']]) {
    assert.equal(command(invalid).ok, false);
  }
});
