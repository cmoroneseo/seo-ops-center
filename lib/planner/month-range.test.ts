import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonthDays } from './month-range.ts';

function localDateParts(date: Date): [number, number, number] {
    return [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

test('Sunday-first August 2026 includes the displayed July 26 through September 5 boundaries', () => {
    const days = buildMonthDays(new Date(2026, 7, 18), 0);

    assert.equal(days.length, 42);
    assert.deepEqual(localDateParts(days[0]), [2026, 7, 26]);
    assert.deepEqual(localDateParts(days.at(-1)!), [2026, 9, 5]);
});

test('Monday-first August 2026 includes the displayed July 27 through September 6 boundaries', () => {
    const days = buildMonthDays(new Date(2026, 7, 18), 1);

    assert.equal(days.length, 42);
    assert.deepEqual(localDateParts(days[0]), [2026, 7, 27]);
    assert.deepEqual(localDateParts(days.at(-1)!), [2026, 9, 6]);
});
