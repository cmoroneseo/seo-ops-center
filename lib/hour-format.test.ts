import test from 'node:test';
import assert from 'node:assert/strict';
import { clientScopeLabel, formatHourAmount, formatHoursAgainstQuota } from './hour-format.ts';

test('hour labels use the client fields and do not invent a zero', () => {
    assert.equal(formatHourAmount(Number.NaN), '—');
    assert.equal(formatHourAmount(4.256), '4.26');
    assert.equal(formatHourAmount(4.819999999999999), '4.82');
    assert.equal(formatHourAmount(2.6100000000000003), '2.61');
    assert.equal(formatHoursAgainstQuota(4, null), '4 / —');
    assert.equal(formatHoursAgainstQuota(null, 12), '—');
    assert.equal(formatHoursAgainstQuota(4, 12), '4 / 12h');
    assert.equal(clientScopeLabel({ seoHours: 10, setupScope: { mode: 'monthly' } }), '10h/mo');
    assert.equal(clientScopeLabel({ seoHours: 10, setupScope: { mode: 'custom' } }), 'Custom scope');
    assert.equal(clientScopeLabel({ seoHours: 8 }), '8h/mo');
});
