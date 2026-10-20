import test from 'node:test';
import assert from 'node:assert/strict';
import {
    basecampSyncNotice,
    publishTimeLogBasecampNotice,
    TIME_LOG_BASECAMP_EVENT,
} from './sync-notice.ts';

test('a failed send names the reason and a skip keeps the Skipped prefix', () => {
    assert.equal(basecampSyncNotice({ success: true }), null);
    assert.equal(
        basecampSyncNotice({ success: false, error: 'Send the task to Basecamp first' }),
        'Send the task to Basecamp first',
    );
    assert.equal(
        basecampSyncNotice({ skipped: true, error: 'timesheet sync not enabled for this client' }),
        'Skipped: timesheet sync not enabled for this client',
    );
    assert.equal(basecampSyncNotice({ success: false }), 'Basecamp sync failed');
});

test('publishing a notice is an event the open entry can read', () => {
    const events: CustomEvent[] = [];
    publishTimeLogBasecampNotice(
        { timeLogId: 'log-1', message: 'Send the task to Basecamp first' },
        event => events.push(event as CustomEvent),
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, TIME_LOG_BASECAMP_EVENT);
    assert.deepEqual(events[0].detail, {
        timeLogId: 'log-1',
        message: 'Send the task to Basecamp first',
    });
});
