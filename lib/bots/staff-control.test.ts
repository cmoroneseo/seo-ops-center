import assert from 'node:assert/strict';
import test from 'node:test';

import { parseStaffControl, staffControlOutcome } from './staff-control.ts';

const ID = '11111111-1111-4111-8111-111111111111';

test('staff control accepts pause, resume, and stop and refuses a duration', () => {
    const parsed = parseStaffControl({ action: 'stop', timeLogId: ID, description: 'Ready for review' });
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
        assert.equal(parsed.input.action, 'stop');
        assert.equal(parsed.input.description, 'Ready for review');
    }
    assert.equal(parseStaffControl({ action: 'pause', timeLogId: ID, hours: 1 }).ok, false);
    assert.equal(parseStaffControl({ action: 'start', timeLogId: ID }).ok, false);
    assert.equal(parseStaffControl({ action: 'resume', timeLogId: 'not-an-id' }).ok, false);
});

test('a second stop is already stopped and a cap is not a normal log', () => {
    const stopped = staffControlOutcome(200, {
        alreadyStopped: true,
        timeLog: { status: 'logged' },
        basecamp: { status: 'skipped' },
    });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.alreadyStopped, true);
    assert.equal(stopped.phase, 'stopped');

    const capped = staffControlOutcome(200, { capped: true, timeLog: { status: 'needs_review' } });
    assert.equal(capped.capped, true);
    assert.equal(capped.phase, 'stopped');

    const missing = staffControlOutcome(404, { code: 'timer_not_running', error: 'This bot timer is not running or paused.' });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'timer_not_running');
});
