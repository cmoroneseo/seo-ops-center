import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteTimeLogAcrossSystems } from './time-log-deletion.ts';

test('a failed Basecamp removal preserves the local time log', async () => {
    let localDeletes = 0;

    const result = await deleteTimeLogAcrossSystems({
        basecampEntryId: 'bc-123',
        removeBasecampEntry: async () => new Response(
            JSON.stringify({ error: 'Basecamp unavailable' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
        removeLocalEntry: async () => { localDeletes += 1; },
    });

    assert.deepEqual(result, {
        success: false,
        error: 'Basecamp unavailable',
    });
    assert.equal(localDeletes, 0);
});

test('a successful Basecamp removal is followed by local deletion', async () => {
    const operations: string[] = [];

    const result = await deleteTimeLogAcrossSystems({
        basecampEntryId: 'bc-123',
        removeBasecampEntry: async () => {
            operations.push('basecamp');
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        },
        removeLocalEntry: async () => { operations.push('local'); },
    });

    assert.deepEqual(result, { success: true });
    assert.deepEqual(operations, ['basecamp', 'local']);
});
