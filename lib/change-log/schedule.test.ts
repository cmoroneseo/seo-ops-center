import assert from 'node:assert/strict';
import test from 'node:test';

import { dateOffset } from '@/lib/gsc/history';

import { nextCheckCopy } from './list';
import { checkDueOn, checkSchedule, dataReadyOn } from './schedule';
import { GSC_LAG_DAYS } from './thresholds';
import { formatDay } from './time';

test('each check is due on go-live plus its length, and data is ready exactly 3 days later', () => {
    assert.equal(GSC_LAG_DAYS, 3);
    const schedule = checkSchedule('2026-10-13');
    assert.deepEqual(schedule, [
        { days: 7, dueOn: '2026-10-20', dataReadyOn: '2026-10-23' },
        { days: 14, dueOn: '2026-10-27', dataReadyOn: '2026-10-30' },
        { days: 28, dueOn: '2026-11-10', dataReadyOn: '2026-11-13' },
        { days: 56, dueOn: '2026-12-08', dataReadyOn: '2026-12-11' },
    ]);
    assert.equal(checkDueOn('2026-10-13', 28), '2026-11-10');
    assert.equal(dataReadyOn('2026-11-10'), '2026-11-13');
    // The check ends the day before it is due. Adding the lag to that end is Nov 12.
    assert.notEqual(dataReadyOn('2026-11-10'), dateOffset('2026-11-09', GSC_LAG_DAYS));
    assert.equal(dataReadyOn('2026-11-10'), dateOffset('2026-11-10', GSC_LAG_DAYS));
    assert.deepEqual(checkSchedule('not-a-day'), []);
    assert.equal(checkDueOn('not-a-day', 7), null);
    assert.equal(dataReadyOn('Nov 10'), null);
});

test('the list hint uses the same due-plus-3 date', () => {
    const copy = nextCheckCopy({ nextCheckOn: '2026-11-10', nextCheckDays: 28 }, '2026-11-10');
    assert.equal(copy.data, `data ~${formatDay(dataReadyOn('2026-11-10') ?? '')}`);
    assert.equal(copy.data, 'data ~Nov 13');
    assert.equal(copy.data?.includes('Nov 12'), false);
});
