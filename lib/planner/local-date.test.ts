import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLocalDate, localDateForInstant, parseLocalDate } from './local-date.ts';

test('parseLocalDate keeps a yyyy-MM-dd value at local midnight', () => {
    const date = parseLocalDate('2026-08-18');

    assert.ok(date);
    assert.equal(date.getFullYear(), 2026);
    assert.equal(date.getMonth(), 7); // August
    assert.equal(date.getDate(), 18);
    assert.equal(date.getHours(), 0);
    assert.equal(date.getMinutes(), 0);
});

test('formatLocalDate uses the local calendar day when it differs from UTC', (t) => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    t.after(() => {
        if (originalTimezone === undefined) delete process.env.TZ;
        else process.env.TZ = originalTimezone;
    });

    const instant = '2026-08-18T01:30:00.000Z';
    const expected = '2026-08-17';

    assert.equal(formatLocalDate(instant), expected);
    assert.equal(localDateForInstant(instant), expected);
});
