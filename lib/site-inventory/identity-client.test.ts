import assert from 'node:assert/strict';
import test from 'node:test';

import { processIdentityDecisionResponse } from './identity-client.ts';

test('invalidates a 409 decision before refreshing current identity state', async () => {
    const events: string[] = [];

    const result = await processIdentityDecisionResponse(
        Response.json({ error: 'The identity decision conflicts with the current review state.' }, { status: 409 }),
        {
            invalidateConflict() { events.push('invalidate'); },
            async refresh() { events.push('refresh'); return true; },
        },
    );

    assert.deepEqual(events, ['invalidate', 'refresh']);
    assert.equal(result.kind, 'conflict_refreshed');
    assert.match(result.message, /changed and was refreshed/i);
});

test('does not claim a conflict refresh when the follow-up read fails', async () => {
    const result = await processIdentityDecisionResponse(
        Response.json({ error: 'Conflict' }, { status: 409 }),
        {
            invalidateConflict() {},
            async refresh() { return false; },
        },
    );

    assert.equal(result.kind, 'conflict_refresh_failed');
});

test('refreshes a successful decision without conflict invalidation', async () => {
    let invalidated = false;
    let refreshes = 0;

    const result = await processIdentityDecisionResponse(
        Response.json({ id: 'decision-new' }),
        {
            invalidateConflict() { invalidated = true; },
            async refresh() { refreshes += 1; return true; },
        },
    );

    assert.equal(result.kind, 'saved');
    assert.equal(invalidated, false);
    assert.equal(refreshes, 1);
});
