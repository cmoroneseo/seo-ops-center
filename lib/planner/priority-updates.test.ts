import test from 'node:test';
import assert from 'node:assert/strict';
import { priorityUpdatesSucceeded } from './priority-updates.ts';

test('priority updates fail when any Supabase response contains an error', () => {
    assert.equal(priorityUpdatesSucceeded([
        { error: null },
        { error: { message: 'permission denied' } },
        { error: null },
    ]), false);
});

test('priority updates succeed when every Supabase response is error-free', () => {
    assert.equal(priorityUpdatesSucceeded([
        { error: null },
        { error: null },
    ]), true);
});
