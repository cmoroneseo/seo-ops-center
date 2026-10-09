import test from 'node:test';
import assert from 'node:assert/strict';
import {
    businessDayNumber,
    instantAtPt,
    isBusinessDay,
    nthBusinessDay,
    reportSendInstant,
    usFederalHolidays,
} from './business-days';

test('November 2026 business days match the send calendar, including Veterans Day', () => {
    assert.equal(nthBusinessDay('2026-11', 1), '2026-11-02');
    assert.equal(nthBusinessDay('2026-11', 3), '2026-11-04');
    assert.equal(nthBusinessDay('2026-11', 5), '2026-11-06');
    assert.equal(businessDayNumber('2026-11-06'), 5);
    assert.equal(isBusinessDay('2026-11-01'), false);
    assert.equal(isBusinessDay('2026-11-07'), false);
    assert.equal(isBusinessDay('2026-11-11'), false);
    assert.equal(usFederalHolidays(2026).includes('2026-11-11'), true);
});

test('9:00 AM Pacific is 17:00 UTC after the November clock change and 16:00 UTC before it', () => {
    assert.equal(instantAtPt('2026-11-06', 9, 0).toISOString(), '2026-11-06T17:00:00.000Z');
    assert.equal(instantAtPt('2026-10-07', 9, 0).toISOString(), '2026-10-07T16:00:00.000Z');
    assert.equal(instantAtPt('2026-03-09', 9, 0).toISOString(), '2026-03-09T16:00:00.000Z');
});

test('Saturday Independence Day is observed Friday, and an extra holiday can be added', () => {
    assert.equal(usFederalHolidays(2026).includes('2026-07-03'), true);
    assert.equal(isBusinessDay('2026-07-03'), false);
    assert.equal(isBusinessDay('2026-07-04'), false);
    assert.equal(nthBusinessDay('2026-07', 3), '2026-07-06');
    assert.equal(nthBusinessDay('2026-11', 3, ['2026-11-04']), '2026-11-05');
    assert.equal(isBusinessDay('2026-11-04', ['2026-11-04']), false);
});

test('a Saturday New Year is observed on the previous Friday', () => {
    assert.equal(isBusinessDay('2021-12-31'), false);
    assert.equal(isBusinessDay('2022-01-01'), false);
    assert.equal(nthBusinessDay('2022-01', 1), '2022-01-03');
});

test('a September report is scheduled for October business day 5 at 9:00 AM Pacific', () => {
    const early = reportSendInstant('2026-09', new Date('2026-10-01T15:00:00.000Z'));
    assert.equal(early.toISOString(), '2026-10-07T16:00:00.000Z');
    const late = reportSendInstant('2026-09', new Date('2026-10-08T00:00:00.000Z'));
    assert.equal(late.toISOString(), '2026-10-08T16:00:00.000Z');
});
