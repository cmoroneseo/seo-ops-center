import assert from 'node:assert/strict';
import test from 'node:test';

import { botTimerDaySlices, botTimerStop, hoursFromSeconds } from './timer.ts';

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
