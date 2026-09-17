import test from 'node:test';
import assert from 'node:assert/strict';

import {
    canSendForReview,
    deliverableStatusFor,
    isAcceptingDecision,
    rollUpBatch,
    type DocDecision,
} from './batch-status.ts';

const doc = (over: Partial<DocDecision> = {}): DocDecision => ({
    id: Math.random().toString(36).slice(2),
    status: 'pending',
    ...over,
});

test('an empty batch is a draft, not a completed one', () => {
    const r = rollUpBatch([]);
    assert.equal(r.status, 'draft');
    assert.equal(r.complete, false);
    assert.equal(r.total, 0);
});

test('approving one document of three leaves the batch open', () => {
    const r = rollUpBatch([
        doc({ status: 'approved' }),
        doc({ status: 'pending' }),
        doc({ status: 'pending' }),
    ]);
    assert.equal(r.status, 'in_review');
    assert.equal(r.approved, 1);
    assert.equal(r.pending, 2);
    assert.equal(r.complete, false);
});

test('a batch completes only when every live document is accepted', () => {
    const r = rollUpBatch([
        doc({ status: 'approved' }),
        doc({ status: 'approved_with_edits' }),
    ]);
    assert.equal(r.status, 'completed');
    assert.equal(r.complete, true);
});

test('changes_requested holds the batch open even with everything else approved', () => {
    const r = rollUpBatch([
        doc({ status: 'approved' }),
        doc({ status: 'changes_requested' }),
    ]);
    assert.equal(r.status, 'in_review');
    assert.equal(r.complete, false);
    assert.equal(r.changesRequested, 1);
});

test('archived documents are excluded from the rollup', () => {
    const r = rollUpBatch([
        doc({ status: 'approved' }),
        doc({ status: 'pending', archivedAt: '2026-09-01T00:00:00Z' }),
    ]);
    assert.equal(r.total, 1);
    assert.equal(r.complete, true, 'an archived straggler must not block completion');
});

test('a batch of only archived documents is a draft, not complete', () => {
    const r = rollUpBatch([doc({ status: 'approved', archivedAt: '2026-09-01T00:00:00Z' })]);
    assert.equal(r.total, 0);
    assert.equal(r.status, 'draft');
    assert.equal(r.complete, false);
});

test('approved_with_edits counts as delivered', () => {
    assert.equal(isAcceptingDecision('approved'), true);
    assert.equal(isAcceptingDecision('approved_with_edits'), true);
    assert.equal(isAcceptingDecision('changes_requested'), false);
    assert.equal(isAcceptingDecision('pending'), false);
});

test('deliverable write-back drives commitment closure', () => {
    // 'Approved' is in DELIVERED_STATUSES (lib/supabase/fulfillment.ts) — writing it is
    // the entire mechanism by which an approved batch closes the month's commitment.
    assert.equal(deliverableStatusFor('approved'), 'Approved');
    assert.equal(deliverableStatusFor('approved_with_edits'), 'Approved');
    assert.equal(deliverableStatusFor('changes_requested'), 'Review');
    assert.equal(deliverableStatusFor('pending'), null, 'pending must not touch the deliverable');
});

test('a batch cannot be sent with no documents', () => {
    const r = canSendForReview([]);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(' '), /no documents/i);
});

test('a batch cannot be sent with an unpublished document', () => {
    const r = canSendForReview([
        { id: 'a', currentVersionId: 'v1', deliverableId: 'd1' },
        { id: 'b', currentVersionId: null, deliverableId: 'd2' },
    ]);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(' '), /no published version/i);
});

test('a batch cannot be sent with an unlinked deliverable', () => {
    const r = canSendForReview([{ id: 'a', currentVersionId: 'v1', deliverableId: null }]);
    assert.equal(r.ok, false);
    assert.match(r.reasons.join(' '), /would not close a commitment/i);
});

test('archived documents do not block sending', () => {
    const r = canSendForReview([
        { id: 'a', currentVersionId: 'v1', deliverableId: 'd1' },
        { id: 'b', currentVersionId: null, deliverableId: null, archivedAt: '2026-09-01T00:00:00Z' },
    ]);
    assert.equal(r.ok, true);
    assert.deepEqual(r.reasons, []);
});
