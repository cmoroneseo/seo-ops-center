import test from 'node:test';
import assert from 'node:assert/strict';

import {
    batchRemovalConfirm, batchRemovalLabel, batchRemovalMode,
    docRemovalConfirm, docRemovalMode,
} from './removal.ts';

test('a batch that was never sent can be deleted outright', () => {
    const mode = batchRemovalMode({ sentAt: null, status: 'draft' });
    assert.equal(mode, 'delete');
    assert.equal(batchRemovalLabel(mode), 'Delete');
    assert.match(batchRemovalConfirm(mode, 'October Content'), /never sent/i);
});

test('a batch that reached a client is archived, never deleted', () => {
    // The approval is evidence of what the client agreed to. Destroying it to tidy a
    // list is the wrong trade.
    const mode = batchRemovalMode({ sentAt: '2026-09-16T00:00:00Z', status: 'in_review' });
    assert.equal(mode, 'archive');
    assert.equal(batchRemovalLabel(mode), 'Archive');
    assert.match(batchRemovalConfirm(mode, 'October Content'), /kept as a record/i);
});

test('a completed batch is archived even though the work is finished', () => {
    assert.equal(batchRemovalMode({ sentAt: '2026-09-01T00:00:00Z', status: 'completed' }), 'archive');
});

test('the archive warning says the live link stops working', () => {
    // Otherwise someone archives a batch and a client hits a dead link with no warning.
    assert.match(batchRemovalConfirm('archive', 'X'), /link stops working/i);
});

test('an undecided document can be removed; a decided one is archived', () => {
    assert.equal(docRemovalMode({ status: 'pending' }), 'delete');
    assert.equal(docRemovalMode({ status: 'approved' }), 'archive');
    assert.equal(docRemovalMode({ status: 'approved_with_edits' }), 'archive');
    assert.equal(docRemovalMode({ status: 'changes_requested' }), 'archive',
        'a request for changes is a decision too');
});

test('both confirmations name the thing being removed', () => {
    assert.match(batchRemovalConfirm('delete', 'October Content'), /October Content/);
    assert.match(docRemovalConfirm('archive', 'Blog #2'), /Blog #2/);
});
