import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveQuickCreateSave } from './quick-create-save.ts';

test('a failed quick-create save preserves the draft and stays open for retry', () => {
    const draft = { title: 'Draft client review', clientId: 'client-1' };

    const result = resolveQuickCreateSave(draft, false);

    assert.deepEqual(result, {
        draft,
        shouldComplete: false,
        error: "Couldn't save this item. Check your connection and try again.",
    });
});

test('a successful quick-create save clears the draft and allows completion', () => {
    const result = resolveQuickCreateSave({ title: 'Saved event' }, true);

    assert.deepEqual(result, {
        draft: null,
        shouldComplete: true,
        error: null,
    });
});
