/** Run with:  node --test lib/planner/timer-sync.test.ts */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isSameLocalDay,
    shouldMoveBlockToNow,
    trackedBlockMinutes,
    MIN_TRACKED_MINUTES,
} from './timer-sync.ts';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

// --- same-day comparison ----------------------------------------------------

test('isSameLocalDay compares calendar days, not elapsed hours', () => {
    assert.equal(isSameLocalDay(at(2026, 8, 12, 0, 5), at(2026, 8, 12, 23, 55)), true);
    // Under 24h apart but a different day.
    assert.equal(isSameLocalDay(at(2026, 8, 12, 23, 55), at(2026, 8, 13, 0, 5)), false);
});

// --- when the block should move ---------------------------------------------

test('an unscheduled task gets placed on the calendar when you start work', () => {
    assert.equal(shouldMoveBlockToNow(undefined, at(2026, 8, 12, 14, 20)), true);
});

test('starting late on a block planned for today snaps it to the real start', () => {
    // Planned 14:00, actually began 14:20.
    const planned = at(2026, 8, 12, 14, 0).toISOString();
    assert.equal(shouldMoveBlockToNow(planned, at(2026, 8, 12, 14, 20)), true);
});

test('starting early on a block planned for today also snaps', () => {
    const planned = at(2026, 8, 12, 15, 0).toISOString();
    assert.equal(shouldMoveBlockToNow(planned, at(2026, 8, 12, 9, 30)), true);
});

test('a plan for another day is left alone — moving it would erase the intent', () => {
    // Planned Friday, timer started Monday.
    const planned = at(2026, 8, 14, 10, 0).toISOString();
    assert.equal(shouldMoveBlockToNow(planned, at(2026, 8, 10, 9, 0)), false);
});

test('a past plan is likewise not dragged forward', () => {
    const planned = at(2026, 8, 3, 10, 0).toISOString();
    assert.equal(shouldMoveBlockToNow(planned, at(2026, 8, 12, 9, 0)), false);
});

test('an unparseable start date is treated as unscheduled rather than crashing', () => {
    assert.equal(shouldMoveBlockToNow('not-a-date', at(2026, 8, 12)), true);
});

// --- block length after stopping --------------------------------------------

test('trackedBlockMinutes rounds a real session to whole minutes', () => {
    assert.equal(trackedBlockMinutes(45 * 60), 45);
    assert.equal(trackedBlockMinutes(90 * 60 + 20), 90);
});

test('a very short session still leaves a readable block', () => {
    assert.equal(trackedBlockMinutes(90), MIN_TRACKED_MINUTES);
    assert.equal(trackedBlockMinutes(0), MIN_TRACKED_MINUTES);
});
