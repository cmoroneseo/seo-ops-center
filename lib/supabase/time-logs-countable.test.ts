import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNTABLE_IMPORT_STATUS, countsAsConfirmedTime } from './time-logs.ts';

/**
 * The rule these guard is easy to get wrong twice over, and did:
 *
 *   * `time_logs.status` is the TIMER's state. A Basecamp import is `logged`
 *     the instant it arrives, which is why it leaked into the client activity
 *     feed and the workspace budget meter as ordinary confirmed time.
 *   * `import_status` is the review state, and only one of its four values
 *     means "a human decided what this was".
 */

test('only mapped time is countable', () => {
    assert.equal(COUNTABLE_IMPORT_STATUS, 'mapped');
    assert.equal(countsAsConfirmedTime('mapped'), true);
});

test('time still being reviewed does not count', () => {
    assert.equal(countsAsConfirmedTime('needs_context'), false);
    assert.equal(countsAsConfirmedTime('pending_review'), false);
});

test('time deleted at the provider does not count', () => {
    assert.equal(countsAsConfirmedTime('voided'), false);
});

test('an unknown or absent status fails closed', () => {
    // Better to under-report hours than to bill a client for time whose
    // review state we cannot establish.
    assert.equal(countsAsConfirmedTime(null), false);
    assert.equal(countsAsConfirmedTime(undefined), false);
    assert.equal(countsAsConfirmedTime(''), false);
    assert.equal(countsAsConfirmedTime('logged'), false);
});
