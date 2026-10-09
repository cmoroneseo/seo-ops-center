import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDelta } from './sections';

test('a missing metric stays missing in month-over-month math', () => {
    assert.equal(computeDelta(null, 10), null);
    assert.equal(computeDelta(10, null), null);
    assert.equal(computeDelta(undefined, 10), null);
    assert.equal(computeDelta('', 10), null);
});

test('a real zero is a value and a zero baseline has no percent', () => {
    const drop = computeDelta(0, 10);
    assert.ok(drop);
    assert.equal(drop.pct, -100);
    assert.equal(computeDelta(5, 0), null);
});
