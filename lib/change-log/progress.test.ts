import assert from 'node:assert/strict';
import test from 'node:test';

import { dateOffset } from '@/lib/gsc/history';

import { testProgress } from './progress.ts';
import { dataReadyOn } from './schedule.ts';
import { GSC_LAG_DAYS } from './thresholds.ts';
import { afterWindow, finalThrough } from './time.ts';

const LIVE = '2026-11-10';

test('a change with no final after-days is 0% on the 28-day window', () => {
    // Nov 12, 2026 noon Pacific. Ecoworkz H1 went live Nov 10. finalThrough is Nov 9.
    const now = new Date('2026-11-12T20:00:00.000Z');
    assert.equal(finalThrough(now), '2026-11-09');
    assert.equal(GSC_LAG_DAYS, 3);
    const progress = testProgress(LIVE, finalThrough(now));
    assert.ok(progress);
    assert.equal(progress.targetDays, 28);
    assert.equal(progress.percent, 0);
    assert.equal(progress.status, 'in_progress');
    assert.equal(progress.finalDays, 0);
    assert.equal(progress.windowDays, 28);
    assert.equal(progress.windowStart, LIVE);
    assert.equal(progress.windowEnd, afterWindow(LIVE, 28).end);
});

test('progress counts final days in the window, not calendar days since go-live', () => {
    const first = testProgress(LIVE, LIVE);
    assert.equal(first?.finalDays, 1);
    assert.equal(first?.targetDays, 28);
    assert.equal(first?.percent, 4);
    assert.equal(first?.status, 'in_progress');

    const almost = testProgress(LIVE, '2026-12-06');
    assert.equal(almost?.finalDays, 27);
    assert.equal(almost?.percent, 96);
    assert.notEqual(almost?.percent, 100);
    assert.equal(almost?.targetDays, 28);
});

test('a finished 28-day window moves the gauge onto the 56-day check', () => {
    const end = afterWindow(LIVE, 28).end;
    assert.equal(end, '2026-12-07');
    const handoff = testProgress(LIVE, end);
    assert.equal(handoff?.targetDays, 56);
    assert.equal(handoff?.finalDays, 28);
    assert.equal(handoff?.windowDays, 56);
    assert.equal(handoff?.percent, 50);
    assert.equal(handoff?.status, 'in_progress');
    // The stepper's "data ready" date is one day later than this. Progress does not wait for it.
    assert.equal(dataReadyOn(dateOffset(LIVE, 28)), '2026-12-11');
    assert.notEqual(end, '2026-12-11');
});

test('the 56-day window is finished only when its last day is final', () => {
    const end = afterWindow(LIVE, 56).end;
    assert.equal(end, '2027-01-04');
    const short = testProgress(LIVE, dateOffset(end, -1));
    assert.equal(short?.targetDays, 56);
    assert.equal(short?.status, 'in_progress');
    assert.equal(short?.percent, 98);
    const done = testProgress(LIVE, end);
    assert.equal(done?.percent, 100);
    assert.equal(done?.status, 'finished');
    assert.equal(done?.finalDays, 56);
});

test('a bad date does not invent a percent', () => {
    assert.equal(testProgress('Nov 10', '2026-11-09'), null);
    assert.equal(testProgress(LIVE, 'yesterday'), null);
});
