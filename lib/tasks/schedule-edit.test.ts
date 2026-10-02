import test from 'node:test';
import assert from 'node:assert/strict';
import { startDateForDay, scheduleDateError, estimateFromInput } from './schedule-edit';

test('date edits preserve the existing scheduled clock time and offset', () => {
    assert.equal(startDateForDay('2026-10-20', '2026-10-15T14:30:00-07:00'), '2026-10-20T14:30:00-07:00');
    assert.equal(startDateForDay('2026-10-20', '2026-10-15T21:30:00.000Z'), '2026-10-20T21:30:00.000Z');
    assert.equal(startDateForDay('2026-10-20'), '2026-10-20T00:00:00.000Z');
    assert.equal(startDateForDay(''), null);
});
test('schedule dates allow clearing and same-day work but reject inverted ranges', () => {
    assert.equal(scheduleDateError('', '2026-10-01'), null);
    assert.equal(scheduleDateError('2026-10-01', ''), null);
    assert.equal(scheduleDateError('2026-10-01', '2026-10-01'), null);
    assert.ok(scheduleDateError('2026-10-02', '2026-10-01'));
});
test('estimates allow explicit zero and clearing while rejecting negative or invalid hours', () => {
    assert.deepEqual(estimateFromInput(''), { value: null });
    assert.deepEqual(estimateFromInput('0'), { value: 0 });
    assert.deepEqual(estimateFromInput('1.25'), { value: 1.25 });
    for (const value of ['-1', 'Infinity', 'NaN', 'bad']) assert.ok(estimateFromInput(value).error);
});
