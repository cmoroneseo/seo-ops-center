import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalGroup, linkState, parseListQuery, typeLabel } from './list';
const now = Date.parse('2026-11-14T00:00:00Z');
test('request groups use draft first, then any changes, then all approved', () => {
  assert.equal(approvalGroup('draft', [{
    status: 'approved'
  }]), 'ready_to_send');
  assert.equal(approvalGroup('sent', []), 'waiting');
  assert.equal(approvalGroup('sent', [{
    status: 'approved'
  }, {
    status: 'changes_requested'
  }]), 'changes_requested');
  assert.equal(approvalGroup('sent', [{
    status: 'approved'
  }]), 'approved');
  assert.equal(approvalGroup('sent', [{
    status: 'pending'
  }]), 'waiting');
});
test('link states include exact three-day boundary, expiration and revocation precedence', () => {
  assert.equal(linkState(null, now), 'none');
  for (const [days, state] of [[0, 'expired'], [-1, 'expired'], [3, 'expiring'], [4, 'active']] as const) assert.equal(linkState({
    expires_at: new Date(now + days * 86400000).toISOString(),
    revoked_at: null
  }, now), state);
  assert.equal(linkState({
    expires_at: '2020-01-01',
    revoked_at: '2020-01-01'
  }, now), 'revoked');
});
test('list query validates enums, UUIDs and cursor structure', () => {
  assert.equal(parseListQuery(new URLSearchParams()).archived, 'false');
  assert.equal(parseListQuery(new URLSearchParams('owner=me&type=city&archived=true')).type, 'city');
  for (const query of ['client=no', 'owner=no', 'status=draft', 'type=offer', 'archived=1', 'sort=bad', 'cursor=bad']) assert.throws(() => parseListQuery(new URLSearchParams(query)));
  const cursor = Buffer.from(JSON.stringify({
    key: '2026-01-01',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  })).toString('base64url');
  assert.equal(parseListQuery(new URLSearchParams({
    cursor
  })).cursor, cursor);
});
test('mixed page kinds use Pages; single kinds and GBP have exact copy', () => {
  assert.equal(typeLabel({
    itemType: 'page',
    pageKinds: ['blog', 'city']
  }), 'Pages');
  assert.equal(typeLabel({
    itemType: 'page',
    pageKinds: ['service']
  }), 'Service page');
  assert.equal(typeLabel({
    itemType: 'gbp_post',
    pageKinds: []
  }), 'GBP posts');
});
test('filters intersect, counts precede status/cursor, badge ignores filters, and keysets have no duplicates', async () => {
  const {
    summarizeRows
  } = await import('./list');
  const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const client = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const rows = Array.from({
    length: 65
  }, (_, index) => ({
    id: `${String(index).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
    title: `Kitchen ${index}`,
    client: {
      id: client,
      name: 'Guardian'
    },
    itemType: 'page',
    pageKinds: ['city'],
    itemCount: 1,
    group: (index < 60 ? 'ready_to_send' : 'waiting') as 'ready_to_send' | 'waiting',
    linkState: 'none' as const,
    linkExpiresAt: null,
    createdAt: '2026-11-14',
    updatedAt: '2026-11-14',
    owner: {
      id: actor,
      name: 'Owner'
    },
    createdVia: index === 0 ? 'bot' : 'app',
    botName: null,
    archivedAt: index === 64 ? '2026-11-14' : null
  }));
  const result = (q: string) => summarizeRows(rows, parseListQuery(new URLSearchParams(q)), actor);
  assert.equal(result('owner=me&type=city&q=guardian').counts.ready_to_send, 60);
  assert.equal(result('owner=bot').rows.length, 1);
  assert.equal(result('type=blog').rows.length, 0);
  assert.equal(result('type=blog').badgeCount, 60);
  assert.equal(result('archived=true').counts.waiting, 5);
  assert.equal(result('status=waiting').rows.length, 4);
  assert.equal(result('status=waiting').counts.ready_to_send, 60);
  const first = result('sort=oldest');
  assert.equal(first.rows.length, 50);
  const second = result(`sort=oldest&cursor=${first.nextCursor}`);
  assert.equal(second.rows.length, 14);
  assert.equal(new Set([...first.rows, ...second.rows].map(row => row.id)).size, 64);
});
test('plain-text page preview preserves inline words, block boundaries and hard breaks', async () => {
  const {
    approvalPlainText
  } = await import('./text');
  assert.equal(approvalPlainText({
    type: 'doc',
    content: [{
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Hello '
      }, {
        type: 'text',
        text: 'world'
      }]
    }, {
      type: 'paragraph',
      content: [{
        type: 'text',
        text: 'Next'
      }, {
        type: 'hardBreak'
      }, {
        type: 'text',
        text: 'line'
      }]
    }]
  }), 'Hello world\nNext\nline');
});
test('Approved tile uses the released decision date within 30 days, while the group retains older approvals', async () => {
  const {
    summarizeRows
  } = await import('./list');
  const row = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Approved',
    client: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Client'
    },
    itemType: 'gbp_post',
    pageKinds: [],
    itemCount: 1,
    group: 'approved' as const,
    linkState: 'none' as const,
    linkExpiresAt: null,
    createdAt: '2020-01-01',
    updatedAt: '2020-01-01',
    owner: null,
    createdVia: 'app',
    botName: null,
    archivedAt: null
  };
  const result = summarizeRows([{
    ...row,
    approvedAt: new Date(Date.now() - 29 * 86400000).toISOString()
  }, {
    ...row,
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    approvedAt: new Date(Date.now() - 31 * 86400000).toISOString()
  }], parseListQuery(new URLSearchParams()), 'actor');
  assert.equal(result.counts.approved, 2);
  assert.equal(result.summaryCounts.approved, 1);
});
