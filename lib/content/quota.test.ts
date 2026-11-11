import test from 'node:test';
import assert from 'node:assert/strict';

import { contentPlanLimit, contentQuota, plannedAfterApproval, plannedPieces } from './quota.ts';

const pages = [
    { id: 'a', status: 'approved', workMonth: '2026-11' },
    { id: 'b', status: 'approved', workMonth: '2026-11' },
    { id: 'c', status: 'approved', workMonth: '2026-12' },
    { id: 'd', status: 'pending', workMonth: '2026-11' },
    { id: 'e', status: 'approved', workMonth: null },
];

test('the quota counts approved pages in that month and warns without a block flag', () => {
    assert.equal(plannedPieces(pages, '2026-11'), 2);
    assert.equal(plannedPieces(pages, '2026-12'), 1);
    assert.equal(plannedPieces(pages, '2026-10'), 0);
    assert.equal(plannedAfterApproval(pages, 'new', '2026-11'), 3);
    assert.equal(plannedAfterApproval(pages, 'a', '2026-11'), 2);
    assert.equal(plannedAfterApproval(pages, 'c', '2026-11'), 3);

    const room = contentQuota(2, 4, '2026-11');
    assert.equal(room.label, '2 of 4 pieces planned for November 2026');
    assert.equal(room.warning, null);
    assert.equal(room.limit, 4);
    assert.equal('blocked' in room, false);

    const full = contentQuota(4, 4, '2026-11');
    assert.equal(full.warning, null);

    const over = contentQuota(5, 4, '2026-11');
    assert.equal(over.label, '5 of 4 pieces planned for November 2026');
    assert.equal(over.warning, "This goes over the 4 pieces in this month's plan.");
    assert.equal('blocked' in over, false);

    const zero = contentQuota(1, 0, '2026-11');
    assert.equal(zero.warning, "This goes over the 0 pieces in this month's plan.");
});

test('a missing content plan shows an em dash and does not warn', () => {
    assert.equal(contentPlanLimit(undefined), null);
    assert.equal(contentPlanLimit(null), null);
    assert.equal(contentPlanLimit(1.5), null);
    assert.equal(contentPlanLimit(-1), null);
    assert.equal(contentPlanLimit(0), 0);

    for (const limit of [null, undefined]) {
        const quota = contentQuota(3, limit, '2026-11');
        assert.equal(quota.label, '—');
        assert.equal(quota.limit, null);
        assert.equal(quota.warning, null);
        assert.equal(quota.planned, 3);
    }
    assert.equal(contentQuota(1, 4, 'not-a-month').label, '—');
});
