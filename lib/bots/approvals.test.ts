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
    terms: 'Ends Dec 31.',
};

test('a bot can describe an approval request and cannot ask for a link', () => {
    const parsed = parseBotApproval({
        idempotencyKey: 'holiday-posts-1',
        clientId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        taskId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        title: 'GBP holiday posts',
        items: [{ position: 1, payload, photoPath: 'https://allinone-const.com/photos/post.jpg' }],
        questions: [{ prompt: 'Does the request have to be in by Dec 31?', itemPosition: null }],
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
        items: [{ position: 1, payload }],
    });
    assert.equal(link.ok, false);
    if (link.ok) return;
    assert.equal(link.status, 403);
});


test('normalized bot commands pass stable retry identity to SQL', () => {
    const input = { idempotencyKey: 'bot-retry-001', clientName: 'Client', taskTitle: 'Task',
        title: 'Posts', items: [{ position: 1, payload }] };
    const first = parseBotApproval(input);
    const retry = parseBotApproval({ ...input, title: ' Posts ' });
    const changed = parseBotApproval({ ...input, title: 'Changed posts' });
    assert.ok(first.ok && retry.ok && changed.ok);
    assert.equal(first.command.requestHash, retry.command.requestHash);
    assert.notEqual(first.command.requestHash, changed.command.requestHash);
    const args = botApprovalRpcArgs(first.command, 'actor', 'org', 'client', 'task');
    assert.equal(args.p_idempotency_key, input.idempotencyKey);
    assert.equal(args.p_request_hash, first.command.requestHash);
    assert.equal(args.p_organization_id, 'org');
});
