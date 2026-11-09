import assert from 'node:assert/strict';
import test from 'node:test';

import { manualLogDate } from './manual-log.ts';

test('manual log uses today when that day is on the timesheet', () => {
    assert.equal(manualLogDate('2026-08-24', '2026-08-26'), '2026-08-26');
});

test('manual log uses the first visible day when today is on another week', () => {
    assert.equal(manualLogDate('2026-08-17', '2026-08-26'), '2026-08-17');
});
