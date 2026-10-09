import test from 'node:test';
import assert from 'node:assert/strict';
import { cronMonths, monthBounds, previousMonth, ptMonth } from './months';

test('Pacific month stays in October just before daylight saving ends', () => {
    assert.equal(ptMonth(new Date('2026-11-01T06:30:00Z')), '2026-10');
});

test('month bounds count February in leap and common years', () => {
    assert.deepEqual(monthBounds('2026-02'), { start: '2026-02-01', end: '2026-02-28', days: 28 });
    assert.deepEqual(monthBounds('2028-02'), { start: '2028-02-01', end: '2028-02-29', days: 29 });
});

test('previous month wraps the year', () => {
    assert.equal(previousMonth('2026-01'), '2025-12');
});

test('a cron run re-syncs the previous month through Pacific day 7', () => {
    assert.deepEqual(cronMonths(new Date('2026-11-07T20:00:00Z')), ['2026-11', '2026-10']);
    assert.deepEqual(cronMonths(new Date('2026-11-08T20:00:00Z')), ['2026-11']);
    assert.deepEqual(cronMonths(new Date('2026-11-03T18:00:00Z')), ['2026-11', '2026-10']);
    assert.deepEqual(cronMonths(new Date('2026-11-01T06:30:00Z')), ['2026-10']);
});
