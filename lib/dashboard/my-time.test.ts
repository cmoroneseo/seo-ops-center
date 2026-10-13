import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMyTimeHours, summarizeMyTime } from './my-time.ts';

test('unknown hours are an em dash and a loaded zero stays 0h', () => {
    assert.equal(formatMyTimeHours(null), '—');
    assert.equal(formatMyTimeHours(Number.NaN), '—');
    assert.equal(formatMyTimeHours(0), '0h');
    const today = new Date(2026, 9, 13, 12, 0, 0);
    assert.equal(summarizeMyTime(null, 'me', today), null);
    assert.equal(summarizeMyTime([], null, today), null);
    const zero = summarizeMyTime([], 'me', today);
    assert.deepEqual(zero, { week: 0, month: 0 });
    assert.equal(formatMyTimeHours(zero?.week ?? null), '0h');
    assert.equal(formatMyTimeHours(zero?.month ?? null), '0h');
});

test('week and month totals count only the signed-in person', () => {
    const today = new Date(2026, 9, 13, 12, 0, 0);
    const totals = summarizeMyTime([
        { date: '2026-10-13', hours: 2, userId: 'me' },
        { date: '2026-10-01', hours: 4, userId: 'me' },
        { date: '2026-10-13', hours: 9, userId: 'other' },
    ], 'me', today);
    assert.deepEqual(totals, { week: 2, month: 6 });
    assert.equal(formatMyTimeHours(totals?.week ?? null), '2h');
    assert.equal(formatMyTimeHours(totals?.month ?? null), '6h');
});
