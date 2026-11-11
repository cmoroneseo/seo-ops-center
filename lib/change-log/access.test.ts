import assert from 'node:assert/strict';
import test from 'node:test';

import { CHANGE_LOG_READ_ONLY, canEditChangeLog } from './access';

test('viewers cannot edit the change log and everyone else who can open it can', () => {
    assert.equal(canEditChangeLog('viewer'), false);
    assert.equal(canEditChangeLog('owner'), true);
    assert.equal(canEditChangeLog('admin'), true);
    assert.equal(canEditChangeLog('member'), true);
    assert.equal(canEditChangeLog(null), false);
    assert.equal(canEditChangeLog(undefined), false);
    assert.equal(canEditChangeLog(''), false);
    assert.match(CHANGE_LOG_READ_ONLY, /view the change log/);
});
