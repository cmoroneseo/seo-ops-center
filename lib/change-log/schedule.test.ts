import assert from 'node:assert/strict';
import test from 'node:test';

import { dateOffset } from '@/lib/gsc/history';

import { nextCheckCopy } from './list';
import { checkDueOn, checkSchedule, dataReadyOn } from './schedule';
import { GSC_LAG_DAYS } from './thresholds';
import { formatDay } from './time';

test('each check is due after the last full day, and data is ready exactly 3 days later', () => {
    assert.equal(GSC_LAG_DAYS, 3);
    const schedule = checkSchedule('2026-10-13');
    assert.deepEqual(schedule, [
        { days: 7, dueOn: '2026-10-21', dataReadyOn: '2026-10-24' },
        { days: 14, dueOn: '2026-10-28', dataReadyOn: '2026-10-31' },
        { days: 28, dueOn: '2026-11-11', dataReadyOn: '2026-11-14' },
        { days: 56, dueOn: '2026-12-09', dataReadyOn: '2026-12-12' },
    ]);
    assert.equal(checkDueOn('2026-10-13', 28), '2026-11-11');
    assert.equal(dataReadyOn('2026-11-11'), '2026-11-14');
    assert.equal(dataReadyOn('2026-11-11'), dateOffset('2026-11-11', GSC_LAG_DAYS));
    assert.deepEqual(checkSchedule('not-a-day'), []);
    assert.equal(checkDueOn('not-a-day', 7), null);
    assert.equal(dataReadyOn('Nov 10'), null);
});

test('the list hint uses the same due-plus-3 date', () => {
    const copy = nextCheckCopy({ nextCheckOn: '2026-11-11', nextCheckDays: 28 }, '2026-11-11');
    assert.equal(copy.data, `data ~${formatDay(dataReadyOn('2026-11-11') ?? '')}`);
    assert.equal(copy.data, 'data ~Nov 14');
});
