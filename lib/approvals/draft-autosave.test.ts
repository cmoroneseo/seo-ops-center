import test from 'node:test';
import assert from 'node:assert/strict';

import {
    beginDraftSave,
    draftStatusLabel,
    hasUnsavedWork,
    IDLE_AUTOSAVE,
    queueDraftChange,
    resolveDraftSave,
} from './draft-autosave.ts';

const docA = { type: 'doc', content: [{ type: 'paragraph' }] };
const docB = { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] };

test('an edit becomes pending work', () => {
    const state = queueDraftChange(IDLE_AUTOSAVE, docA, { locked: false });
    assert.equal(state.pending, docA);
    assert.equal(hasUnsavedWork(state), true);
});

test('a locked document queues nothing', () => {
    // Locked means open for client review. The server refuses the write anyway, so
    // queueing it would only produce a confusing error.
    const state = queueDraftChange(IDLE_AUTOSAVE, docA, { locked: true });
    assert.deepEqual(state, IDLE_AUTOSAVE);
    assert.equal(hasUnsavedWork(state), false);
});

test('a successful save clears the pending work', () => {
    const queued = queueDraftChange(IDLE_AUTOSAVE, docA, { locked: false });
    const saved = resolveDraftSave(beginDraftSave(queued), true, docA);
    assert.equal(saved.pending, null);
    assert.equal(saved.status, 'saved');
    assert.equal(hasUnsavedWork(saved), false);
});

test('a failed save KEEPS the pending work so it can retry', () => {
    // The point of the module: a network blip must never turn into lost writing.
    const queued = queueDraftChange(IDLE_AUTOSAVE, docA, { locked: false });
    const failed = resolveDraftSave(beginDraftSave(queued), false);
    assert.equal(failed.pending, docA);
    assert.equal(failed.status, 'error');
    assert.equal(hasUnsavedWork(failed), true);
});

test('typing during an in-flight save is not lost and is not reported as saved', () => {
    let state = queueDraftChange(IDLE_AUTOSAVE, docA, { locked: false });
    state = beginDraftSave(state);
    state = queueDraftChange(state, docB, { locked: false }); // typed again mid-flight
    state = resolveDraftSave(state, true, docA);              // the OLD payload landed

    assert.equal(state.pending, docB, 'the newer keystrokes must survive');
    assert.notEqual(state.status, 'saved', 'must not claim saved while work is pending');
    assert.equal(hasUnsavedWork(state), true);
});

test('a retry after failure succeeds and clears', () => {
    let state = queueDraftChange(IDLE_AUTOSAVE, docA, { locked: false });
    state = resolveDraftSave(beginDraftSave(state), false);
    state = resolveDraftSave(beginDraftSave(state), true, docA);
    assert.equal(state.pending, null);
    assert.equal(state.status, 'saved');
});

test('beginDraftSave on an empty queue is a no-op', () => {
    assert.deepEqual(beginDraftSave(IDLE_AUTOSAVE), IDLE_AUTOSAVE);
});

test('the indicator tells the writer the truth at each step', () => {
    assert.equal(draftStatusLabel(IDLE_AUTOSAVE), null);

    const queued = queueDraftChange(IDLE_AUTOSAVE, docA, { locked: false });
    assert.equal(draftStatusLabel(queued), 'Unsaved changes');
    assert.equal(draftStatusLabel(beginDraftSave(queued)), 'Saving…');
    assert.equal(draftStatusLabel(resolveDraftSave(beginDraftSave(queued), true, docA)), 'Saved');
    assert.match(draftStatusLabel(resolveDraftSave(beginDraftSave(queued), false))!, /Couldn't save/);
});
