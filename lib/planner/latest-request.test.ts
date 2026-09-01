import test from 'node:test';
import assert from 'node:assert/strict';
import * as latestRequest from './latest-request.ts';

test('only the latest planner reload may apply its response', () => {
    const createGate = (latestRequest as Record<string, unknown>)
        .createLatestRequestGate as (() => { start: () => () => boolean }) | undefined;
    assert.equal(typeof createGate, 'function', 'createLatestRequestGate must be exported');

    const gate = createGate?.();
    const olderMayApply = gate?.start();
    const latestMayApply = gate?.start();

    assert.equal(latestMayApply?.(), true);
    assert.equal(olderMayApply?.(), false);
});
