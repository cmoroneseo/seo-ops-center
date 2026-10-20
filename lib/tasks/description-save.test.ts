import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DESCRIPTION_AUTOSAVE_MS,
    descriptionAutosaveStep,
    descriptionSaveLabel,
    idleDescriptionAutosave,
} from './description-save.ts';

const start = idleDescriptionAutosave('Kitchen notes');

test('typing waits out the debounce, then one flush saves the latest text', () => {
    const typed = descriptionAutosaveStep(start, { type: 'edit', text: 'Kitchen notes today', now: 1_000 });
    assert.equal(typed.save, null);
    assert.equal(typed.state.phase, 'pending');
    assert.equal(descriptionSaveLabel(typed.state.phase), 'Saving…');
    const early = descriptionAutosaveStep(typed.state, { type: 'tick', now: 1_000 + DESCRIPTION_AUTOSAVE_MS - 1 });
    assert.equal(early.save, null);

    const flushed = descriptionAutosaveStep(typed.state, { type: 'flush', now: 1_200 });
    assert.equal(flushed.save, 'Kitchen notes today');
    assert.equal(flushed.state.phase, 'saving');
    const saved = descriptionAutosaveStep(flushed.state, { type: 'succeed', text: 'Kitchen notes today' });
    assert.equal(saved.state.phase, 'saved');
    assert.equal(saved.state.savedText, 'Kitchen notes today');
    assert.equal(descriptionSaveLabel(saved.state.phase), 'Saved');
});

test('a failed save keeps the text and retry sends it again', () => {
    const pending = descriptionAutosaveStep(start, { type: 'edit', text: 'Lost if we only saved on blur', now: 0 });
    const writing = descriptionAutosaveStep(pending.state, { type: 'tick', now: DESCRIPTION_AUTOSAVE_MS });
    assert.equal(writing.save, 'Lost if we only saved on blur');
    const failed = descriptionAutosaveStep(writing.state, { type: 'fail', text: writing.save! });
    assert.equal(failed.state.phase, 'failed');
    assert.equal(failed.state.text, 'Lost if we only saved on blur');
    assert.equal(descriptionSaveLabel(failed.state.phase), 'Failed to save');
    const retry = descriptionAutosaveStep(failed.state, { type: 'retry' });
    assert.equal(retry.save, 'Lost if we only saved on blur');
    assert.equal(retry.state.phase, 'saving');
});

test('a newer edit during a save is written after the first one succeeds', () => {
    const edited = descriptionAutosaveStep(start, { type: 'edit', text: 'Kitchen notes today', now: 0 });
    const first = descriptionAutosaveStep(edited.state, { type: 'flush', now: 10 });
    assert.equal(first.save, 'Kitchen notes today');
    const more = descriptionAutosaveStep(first.state, { type: 'edit', text: 'Kitchen notes today, with the range', now: 50 });
    assert.equal(more.save, null);
    const next = descriptionAutosaveStep(more.state, { type: 'succeed', text: 'Kitchen notes today' });
    assert.equal(next.save, 'Kitchen notes today, with the range');
    assert.equal(next.state.savedText, 'Kitchen notes today');
});
