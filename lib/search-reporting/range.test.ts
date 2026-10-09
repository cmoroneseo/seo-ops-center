import test from 'node:test';
import assert from 'node:assert/strict';
import { monthFinality } from '@/lib/gsc/monthly';
import { comparisonDistortion, coverWindow, lastFinalDate, parseRange, resolveRange } from './range';

test('range presets accept 28 final days and a Pacific calendar month', () => {
    assert.deepEqual(parseRange(null), { kind: '28d', key: '28d', month: null });
    assert.equal(parseRange('2026-09')?.kind, 'month');
    assert.equal(parseRange('2026-13'), null);
    assert.equal(lastFinalDate([
        { date: '2026-10-06', isIncomplete: false },
        { date: '2026-10-07', isIncomplete: true },
        { date: '2026-10-10', isIncomplete: false },
    ], '2026-10-09'), '2026-10-06');
});

test('calendar-month finality is the monthly.ts finality', () => {
    const days = Array.from({ length: 30 }, (_, index) => ({ date: `2026-09-${String(index + 1).padStart(2, '0')}`, isIncomplete: false }));
    const resolved = resolveRange({ kind: 'month', key: '2026-09', month: '2026-09' }, days, new Date('2026-10-09T18:00:00.000Z'));
    assert.deepEqual(resolved.finality, monthFinality('2026-09', days));
    assert.deepEqual(resolved.current, { start: '2026-09-01', end: '2026-09-30' });
    assert.deepEqual(resolved.prior, { start: '2026-08-01', end: '2026-08-31' });
    const current = coverWindow(resolved.current, days);
    const prior = coverWindow(resolved.prior, []);
    assert.equal(comparisonDistortion(current, prior).reason, 'unequal coverage');
    const partial = coverWindow({ start: '2026-10-01', end: '2026-10-31' }, days.slice(0, 2).map((day, index) => ({ date: `2026-10-0${index + 1}`, isIncomplete: false })));
    const full = coverWindow(resolved.current, days);
    assert.equal(comparisonDistortion(partial, full).reason, 'partial period');
});
