import test from 'node:test';
import assert from 'node:assert/strict';
import {
    formatDuration,
    formatDayHeading,
    formatWeekRange,
    formatSourceLabel,
    percentOf,
} from './format.ts';

test('durations read as hours and minutes, matching the grid', () => {
    assert.equal(formatDuration(190), '3h 10m');
    assert.equal(formatDuration(60), '1h 00m');
    assert.equal(formatDuration(15), '15m');
    assert.equal(formatDuration(920), '15h 20m');
});

test('an empty cell is a dash, not a zero', () => {
    assert.equal(formatDuration(0), '–');
    assert.equal(formatDuration(0, { zero: '0m' }), '0m');
});

test('negative durations are shown as an over-budget overage', () => {
    assert.equal(formatDuration(-120, { zero: '0m' }), '-2h 00m');
});

test('day headings are two lines: weekday and date', () => {
    assert.deepEqual(formatDayHeading('2026-08-23'), { weekday: 'Sun', date: 'Aug 23' });
    assert.deepEqual(formatDayHeading('2026-08-29'), { weekday: 'Sat', date: 'Aug 29' });
});

test('a week range reads as one span across a month boundary', () => {
    assert.equal(formatWeekRange('2026-08-23'), 'Aug 23 – Aug 29, 2026');
    assert.equal(formatWeekRange('2026-08-30'), 'Aug 30 – Sep 5, 2026');
    assert.equal(formatWeekRange('2026-12-27'), 'Dec 27, 2026 – Jan 2, 2027');
});

test('source labels name the system a row came from', () => {
    assert.equal(formatSourceLabel(['seo_pm']), 'SEO PM');
    assert.equal(formatSourceLabel(['basecamp']), 'Basecamp');
    assert.equal(formatSourceLabel(['seo_pm', 'basecamp']), 'SEO PM + Basecamp');
    assert.equal(formatSourceLabel([]), '');
});

test('percentages are whole numbers and never divide by zero', () => {
    assert.equal(percentOf(920, 1105), 83);
    assert.equal(percentOf(0, 0), 0);
    assert.equal(percentOf(60, 0), 0);
});
