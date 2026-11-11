import test from 'node:test';
import assert from 'node:assert/strict';

import { contentMonthChoices, groupApprovedContent, UNSCHEDULED_LABEL, type ContentBoardRecord } from './board.ts';

function page(overrides: Partial<ContentBoardRecord> = {}): ContentBoardRecord {
    return {
        id: 'page-1',
        title: 'Marketing ROI',
        status: 'approved',
        action: 'create',
        ...overrides,
    };
}

test('approved pages group by month, with pages that have no month first', () => {
    const groups = groupApprovedContent([
        page({ id: 'nov-late', title: 'Late page', workMonth: '2026-11', dueDate: '2026-11-20' }),
        page({ id: 'pending', title: 'Still an idea', status: 'pending', workMonth: '2026-11' }),
        page({ id: 'declined', title: 'Not going ahead', status: 'declined', workMonth: '2026-11' }),
        page({ id: 'oct', title: 'October page', workMonth: '2026-10', dueDate: '2026-10-02' }),
        page({ id: 'loose-b', title: 'Zebra draft', workMonth: null }),
        page({ id: 'nov-early', title: 'Early page', workMonth: '2026-11', dueDate: '2026-11-02' }),
        page({ id: 'nov-open', title: 'No due date', workMonth: '2026-11' }),
        page({ id: 'loose-a', title: 'alpha draft', workMonth: 'not-a-month' }),
        page({ id: 'same-day', title: 'Also early', workMonth: '2026-11', dueDate: '2026-11-02' }),
    ]);

    assert.deepEqual(groups.map(group => group.label), [UNSCHEDULED_LABEL, 'October 2026', 'November 2026']);
    assert.equal(groups[0].workMonth, null);
    assert.deepEqual(groups[0].records.map(record => record.title), ['alpha draft', 'Zebra draft']);
    assert.deepEqual(groups[1].records.map(record => record.id), ['oct']);
    assert.deepEqual(groups[2].records.map(record => record.title), ['Also early', 'Early page', 'Late page', 'No due date']);
    assert.equal(groups.some(group => group.records.some(record => record.status !== 'approved')), false);
});

test('an empty plan and a month list stay predictable', () => {
    assert.deepEqual(groupApprovedContent([]), []);
    assert.deepEqual(groupApprovedContent([page({ status: 'pending' })]), []);
    assert.deepEqual(contentMonthChoices('2026-11', ['2026-09', 'nope', null]), [
        '2026-09', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04',
        '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10',
    ]);
    assert.deepEqual(contentMonthChoices('November', []), []);
});
