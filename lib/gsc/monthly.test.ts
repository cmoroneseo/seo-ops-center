import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOffset } from './history';
import { deriveMonthlyGsc, monthFinality, type DaySnapshot } from './monthly';

function days(start: string, count: number, incompleteFrom?: string): DaySnapshot[] {
    return Array.from({ length: count }, (_, index) => {
        const date = dateOffset(start, index);
        return {
            date,
            isIncomplete: incompleteFrom != null && date >= incompleteFrom,
            property: { clicks: 1, impressions: 10, position: 4 },
        };
    });
}

test('September 2026 is final when all 30 Pacific days are stored and complete', () => {
    const stored = days('2026-09-01', 30);
    const month = deriveMonthlyGsc('2026-09', stored);
    assert.ok(month);
    assert.deepEqual(month.provenance.finality, {
        complete_through: '2026-09-30',
        days_present: 30,
        days_expected: 30,
        final: true,
    });
    assert.equal(month.data.organic_clicks, 30);
    assert.equal(month.data.impressions, 300);
    assert.equal(month.provenance.timezone, 'America/Los_Angeles');
    assert.deepEqual(month.provenance.range, { start: '2026-09-01', end: '2026-09-30' });
});

test('October stays partial until every day is final, and a gap is not filled with zero', () => {
    const stored = days('2026-10-01', 9);
    const partial = deriveMonthlyGsc('2026-10', stored);
    assert.equal(partial?.provenance.finality.final, false);
    assert.equal(partial?.provenance.finality.days_present, 9);
    assert.equal(partial?.provenance.finality.days_expected, 31);
    assert.equal(partial?.provenance.finality.complete_through, '2026-10-09');
    assert.equal(partial?.data.organic_clicks, 9);

    const gapped = days('2026-10-01', 9).filter(day => day.date !== '2026-10-05');
    const gap = deriveMonthlyGsc('2026-10', gapped);
    assert.equal(gap?.provenance.finality.complete_through, '2026-10-04');
    assert.equal(gap?.provenance.finality.days_present, 8);
    assert.equal(gap?.data.organic_clicks, 8);

    const preliminary = days('2026-10-01', 9, '2026-10-08');
    assert.equal(monthFinality('2026-10', preliminary).complete_through, '2026-10-07');
    assert.equal(monthFinality('2026-10', preliminary).final, false);
});

test('a month with no stored days is missing, and a stored zero stays zero', () => {
    assert.equal(deriveMonthlyGsc('2026-09', []), null);
    assert.equal(deriveMonthlyGsc('2026-09', [{ date: '2026-08-31', isIncomplete: false, property: { clicks: 4, impressions: 4, position: 1 } }]), null);
    const zero = deriveMonthlyGsc('2026-09', [{ date: '2026-09-01', isIncomplete: false, property: null }]);
    assert.equal(zero?.data.organic_clicks, 0);
    assert.equal(zero?.data.impressions, 0);
    assert.equal(zero?.data.avg_position, null);
    assert.equal(zero?.data.ctr, null);
    assert.equal(zero?.provenance.finality.final, false);
    assert.equal(zero?.provenance.finality.days_present, 1);
});
