import assert from 'node:assert/strict';
import test from 'node:test';

import {
    BOT_TIMER_CAP_MS,
    botStretchSegmentId,
    botTimerBasecampSummary,
    botTimerCloseOpen,
    botTimerDaySlices,
    botTimerDaySlicesFromStretches,
    botTimerPauseIsStale,
    botTimerStop,
    closedRunningMs,
    combineStretchNote,
    hoursFromSeconds,
} from './timer.ts';

const START = '2026-11-03T18:00:00.000Z';
const ZONE = 'America/Los_Angeles';

test('a timer that runs exactly two hours is not capped', () => {
    const stop = botTimerStop(START, new Date('2026-11-03T20:00:00.000Z'));
    assert.equal(stop.capped, false);
    assert.equal(stop.stoppedAt, '2026-11-03T20:00:00.000Z');
    const slices = botTimerDaySlices(START, stop.stoppedAt, ZONE);
    assert.equal(slices.length, 1);
    assert.equal(slices[0].hours, 2);
    assert.equal(slices[0].date, '2026-11-03');
});

test('a timer longer than two hours stops at the cap', () => {
    const stop = botTimerStop(START, new Date('2026-11-03T21:30:00.000Z'));
    assert.equal(stop.capped, true);
    assert.equal(stop.stoppedAt, '2026-11-03T20:00:00.000Z');
    const slices = botTimerDaySlices(START, stop.stoppedAt, ZONE);
    assert.equal(slices[0].seconds, 2 * 60 * 60);
    assert.equal(slices[0].hours, 2);
});

test('thirty minutes is half an hour and a midnight crossing splits like a human stop', () => {
    const stop = botTimerStop(START, new Date('2026-11-03T18:30:00.000Z'));
    assert.equal(stop.capped, false);
    const half = botTimerDaySlices(START, stop.stoppedAt, ZONE);
    assert.equal(half[0].hours, 0.5);

    // 11:30pm Pacific through 12:30am is one hour on each calendar day.
    const late = '2026-11-04T07:30:00.000Z';
    const end = '2026-11-04T08:30:00.000Z';
    const slices = botTimerDaySlices(late, end, ZONE);
    assert.deepEqual(slices.map(slice => slice.date), ['2026-11-03', '2026-11-04']);
    assert.equal(slices[0].hours, 0.5);
    assert.equal(slices[1].hours, 0.5);
    assert.equal(hoursFromSeconds(36), 0.01);
});

test('the cap is cumulative running time and ignores time spent paused', () => {
    const first = botTimerCloseOpen({
        openStartedAt: START,
        closedMs: 0,
        now: new Date('2026-11-03T19:00:00.000Z'),
    });
    assert.equal(first.capped, false);
    assert.equal(first.runningMs, 60 * 60 * 1000);

    const closedMs = closedRunningMs([{ startedAt: START, endedAt: first.openEndedAt! }]);
    // Ninety minutes paused, then another 30 minutes running, is still under two hours.
    const resumed = botTimerCloseOpen({
        openStartedAt: '2026-11-03T20:30:00.000Z',
        closedMs,
        now: new Date('2026-11-03T21:00:00.000Z'),
    });
    assert.equal(resumed.capped, false);
    assert.equal(resumed.runningMs, 90 * 60 * 1000);

    const over = botTimerCloseOpen({
        openStartedAt: '2026-11-03T20:30:00.000Z',
        closedMs,
        now: new Date('2026-11-03T22:00:00.000Z'),
    });
    assert.equal(over.capped, true);
    assert.equal(over.runningMs, BOT_TIMER_CAP_MS);
    assert.equal(over.openEndedAt, '2026-11-03T21:30:00.000Z');

    const slices = botTimerDaySlicesFromStretches([
        { startedAt: START, endedAt: first.openEndedAt! },
        { startedAt: '2026-11-03T20:30:00.000Z', endedAt: over.openEndedAt! },
    ], ZONE);
    assert.equal(slices.length, 1);
    assert.equal(slices[0].hours, 2);
});

test('a pause at exactly two hours is not a cap', () => {
    const closed = botTimerCloseOpen({
        openStartedAt: START,
        closedMs: 90 * 60 * 1000,
        now: new Date(Date.parse(START) + 30 * 60 * 1000),
    });
    assert.equal(closed.capped, false);
    assert.equal(closed.runningMs, BOT_TIMER_CAP_MS);
});

test('stretch notes stay in order and the Basecamp summary never carries the clock', () => {
    const stretch = combineStretchNote('Mapped the keyword set', 'Checked the top ten');
    assert.equal(stretch, 'Mapped the keyword set\nChecked the top ten');
    assert.equal(combineStretchNote(stretch, 'Checked the top ten'), stretch);

    const startedAt = START;
    const stoppedAt = '2026-11-03T19:15:00.000Z';
    const summary = botTimerBasecampSummary({
        stretchNotes: [stretch, 'Drafted the brief'],
        stopNote: 'Ready for review',
        hours: 1.25,
        minutes: 75,
        startedAt,
        stoppedAt,
    });
    assert.equal(summary, [
        'Mapped the keyword set',
        'Checked the top ten',
        'Drafted the brief',
        'Ready for review',
    ].join('\n'));
    assert.equal(summary.includes('1.25'), false);
    assert.equal(summary.includes('75'), false);
    assert.equal(summary.includes(startedAt), false);
    assert.equal(summary.includes(stoppedAt), false);
    assert.equal(/\b(hour|hours|minute|minutes)\b/i.test(summary), false);
});

test('a replay id for one stretch does not change, and a paused timer goes stale after seven days', () => {
    const id = botStretchSegmentId('11111111-1111-4111-8111-111111111111', START);
    assert.equal(id, botStretchSegmentId('11111111-1111-4111-8111-111111111111', START));
    assert.notEqual(id, botStretchSegmentId('11111111-1111-4111-8111-111111111111', '2026-11-03T19:00:00.000Z'));
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const pausedAt = '2026-11-03T19:00:00.000Z';
    assert.equal(botTimerPauseIsStale(pausedAt, new Date('2026-11-10T18:59:59.000Z')), false);
    assert.equal(botTimerPauseIsStale(pausedAt, new Date('2026-11-10T19:00:00.000Z')), true);
});
