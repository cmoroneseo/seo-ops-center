import test from 'node:test';
import assert from 'node:assert/strict';
import { timeLogSyncState, canPushToBasecamp } from './log-sync-state.ts';

test('a log that landed reports as synced', () => {
    assert.equal(timeLogSyncState({ basecampSyncedAt: '2026-08-27T00:00:00Z' }, true), 'synced');
    assert.equal(timeLogSyncState({ basecampEntryId: 123 }, true), 'synced');
});

test('a log that was never sent is not silent', () => {
    // The bug: hours logged without ever asking for a push showed no status
    // and offered no retry, because retry was gated on a stored error.
    const state = timeLogSyncState({}, true);
    assert.equal(state, 'unsent');
    assert.equal(canPushToBasecamp(state), true);
});

test('a failed push stays pushable', () => {
    const state = timeLogSyncState({ basecampSyncError: 'HTTP 500' }, true);
    assert.equal(state, 'failed');
    assert.equal(canPushToBasecamp(state), true);
});

test('a client that does not sync timesheets advertises nothing', () => {
    const state = timeLogSyncState({}, false);
    assert.equal(state, 'not_applicable');
    assert.equal(canPushToBasecamp(state), false);
});

test('a failure is reported even when sync is currently off', () => {
    // Something was attempted and did not land; hiding that loses information.
    assert.equal(timeLogSyncState({ basecampSyncError: 'HTTP 500' }, false), 'failed');
});

test('a synced log is never offered a push', () => {
    assert.equal(canPushToBasecamp(timeLogSyncState({ basecampEntryId: 9 }, true)), false);
});
