import test from 'node:test';
import assert from 'node:assert/strict';
import { rankTrackerViewResult } from './rank-tracker-view';

test('a response without status is an error and rows are not read', () => {
    const result = rankTrackerViewResult({ error: 'Forbidden' });
    assert.equal(result.status, 'error');
    assert.equal('rows' in result, false);
    assert.equal(rankTrackerViewResult(null).status, 'error');
    assert.equal(rankTrackerViewResult({ status: 'ok' }).status, 'error');
});

test('a real rank tracker payload is preserved', () => {
    const result = rankTrackerViewResult({ status: 'ok', rows: [], dateStart: '2026-09-01', dateEnd: '2026-09-30' });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') assert.deepEqual(result.rows, []);
});
