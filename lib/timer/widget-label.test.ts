import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTimerStartClock, runningSegmentStartedAt, timerTaskLabel } from './widget-label.ts';

test('the timer names the task, then the description, then an untitled fallback', () => {
    assert.equal(timerTaskLabel({ taskTitle: ' Submit sitemap ' }), 'Submit sitemap');
    assert.equal(timerTaskLabel({ taskTitle: '  ', description: 'Internal notes' }), 'Internal notes');
    assert.equal(timerTaskLabel({ description: '' }), 'Untitled task');
});

test('the running clock is the open segment, in local time', () => {
    const started = new Date(2026, 9, 20, 15, 7, 0);
    const earlier = new Date(2026, 9, 20, 9, 0, 0);
    const iso = runningSegmentStartedAt({
        timerStartedAt: earlier.toISOString(),
        segments: [
            { startedAt: earlier.toISOString(), endedAt: new Date(2026, 9, 20, 10, 0, 0).toISOString() },
            { startedAt: started.toISOString() },
        ],
    });
    assert.equal(iso, started.toISOString());
    const today = new Date(2026, 9, 20, 16, 0, 0);
    const label = formatTimerStartClock(iso, today);
    const clock = started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    assert.equal(label, `Started ${clock}`);

    const yesterday = formatTimerStartClock(new Date(2026, 9, 19, 15, 7, 0).toISOString(), today);
    assert.match(yesterday ?? '', /^Started Oct 19 /);
    assert.equal(formatTimerStartClock(null, today), null);
    assert.equal(runningSegmentStartedAt({ timerStartedAt: earlier.toISOString(), segments: [] }), earlier.toISOString());
});
