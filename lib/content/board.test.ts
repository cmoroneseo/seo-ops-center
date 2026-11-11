import test from 'node:test';
import assert from 'node:assert/strict';

import {
    BOARD_STATUS_LABEL,
    boardLink,
    boardTopicGroups,
    CONTENT_TIME_ZONE,
    contentMonthChoices,
    currentWorkMonth,
    DEFAULT_BOARD_VIEW,
    filterBoardRecords,
    groupBoardContent,
    groupCountLabel,
    monthName,
    monthPlan,
    nextWorkMonth,
    overPlanDetail,
    overPlanHeadline,
    overPlanMoves,
    planHeadline,
    shortDueDate,
    UNSCHEDULED_LABEL,
    type ContentBoardRecord,
} from './board.ts';
import { countsTowardPlan, plannedAfterApproval, plannedPieces } from './quota.ts';

function page(overrides: Partial<ContentBoardRecord> = {}): ContentBoardRecord {
    return {
        id: 'page-1',
        title: 'Marketing ROI',
        status: 'approved',
        action: 'create',
        ...overrides,
    };
}

test('every page groups by month in order, with Unscheduled last', () => {
    const groups = groupBoardContent([
        page({ id: 'nov-late', title: 'Late page', workMonth: '2026-11', dueDate: '2026-11-20' }),
        page({ id: 'pending', title: 'Still an idea', status: 'pending', workMonth: '2026-11', dueDate: '2026-11-30' }),
        page({ id: 'oct', title: 'October page', workMonth: '2026-10', dueDate: '2026-10-02' }),
        page({ id: 'loose-declined', title: 'Declined idea', status: 'declined', productionStatus: 'declined' }),
        page({ id: 'loose-live', title: 'Home page', status: 'pending', action: 'keep', matchedUrl: 'https://example.com/' }),
        page({ id: 'loose-b', title: 'Zebra idea', status: 'pending', workMonth: null }),
        page({ id: 'nov-early', title: 'Early page', workMonth: '2026-11', dueDate: '2026-11-02' }),
        page({ id: 'loose-a', title: 'alpha idea', status: 'pending', workMonth: 'not-a-month' }),
    ]);

    assert.deepEqual(groups.map(group => group.label), ['October 2026', 'November 2026', UNSCHEDULED_LABEL]);
    assert.equal(UNSCHEDULED_LABEL, 'Unscheduled');
    assert.deepEqual(groups[1].records.map(record => record.id), ['nov-early', 'nov-late', 'pending']);
    assert.equal(groups[1].approved, 2);
    assert.equal(groupCountLabel(groups[1]), '3 pages · 2 approved');
    assert.equal(groupCountLabel(groups[0]), '1 page · 1 approved');
    const unscheduled = groups[2];
    assert.equal(unscheduled.workMonth, null);
    assert.deepEqual(unscheduled.records.map(record => record.id), ['loose-a', 'loose-b', 'loose-live', 'loose-declined']);
    assert.equal(groupCountLabel(unscheduled), '4 pages');
    assert.deepEqual(groupBoardContent([]), []);
});

test('only approved, writing, client review, ready and published pages use up the plan', () => {
    const counted = (overrides: Partial<ContentBoardRecord>) => countsTowardPlan(page(overrides));
    assert.equal(counted({}), true);
    for (const status of ['approved', 'writing', 'client_review', 'ready', 'published'] as const) {
        assert.equal(counted({ productionStatus: status }), true, status);
    }
    assert.equal(counted({ productionStatus: 'already_live', action: 'keep', matchedUrl: 'https://example.com/' }), false);
    assert.equal(counted({ productionStatus: 'failed' }), false);
    assert.equal(counted({ action: 'keep', matchedUrl: 'https://example.com/' }), false);
    assert.equal(counted({ status: 'pending', productionStatus: 'awaiting_approval' }), false);
    assert.equal(counted({ status: 'declined', productionStatus: 'declined' }), false);

    const records = [
        page({ id: 'a', workMonth: '2026-11' }),
        page({ id: 'b', workMonth: '2026-11', action: 'keep', matchedUrl: 'https://example.com/b' }),
        page({ id: 'c', workMonth: '2026-11', status: 'pending' }),
    ];
    assert.equal(plannedPieces(records, '2026-11'), 1);
    assert.equal(plannedAfterApproval(records, 'c', '2026-11'), 2);
    assert.equal(plannedPieces([{ status: 'approved', workMonth: '2026-11' }], '2026-11'), 1);
});

test('the monthly plan counts this month and next month and spots overage', () => {
    const records = [
        ...Array.from({ length: 9 }, (_, index) => page({ id: `nov-${index}`, workMonth: '2026-11' })),
        page({ id: 'nov-waiting', status: 'pending', productionStatus: 'awaiting_approval', workMonth: '2026-11' }),
        page({ id: 'dec-1', workMonth: '2026-12' }),
        page({ id: 'dec-2', workMonth: '2026-12', productionStatus: 'writing' }),
    ];
    const over = monthPlan(records, 8, '2026-11');
    assert.deepEqual(over, { month: '2026-11', nextMonth: '2026-12', approved: 9, nextApproved: 2, limit: 8, over: 1, left: 0 });
    assert.equal(planHeadline(over), '9 of 8 content pieces approved for November');
    assert.equal(overPlanHeadline(over), "9 of 8 approved: 1 over this month's plan");
    assert.equal(
        overPlanDetail(over),
        'Approving still works. Check with the client whether the extra piece is added to this month or moved to December.',
    );
    assert.match(overPlanDetail({ ...over, over: 2 }), /the extra pieces are added/);

    const under = monthPlan(records.slice(0, 6), 8, '2026-11');
    assert.equal(under.left, 2);
    assert.equal(under.over, 0);
    assert.equal(planHeadline(under), '6 of 8 content pieces approved for November');

    const none = monthPlan(records, null, '2026-11');
    assert.equal(none.limit, null);
    assert.equal(none.over, 0);

    const zero = monthPlan(records.slice(0, 1), 0, '2026-11');
    assert.equal(zero.limit, 0);
    assert.equal(zero.over, 1);

    assert.equal(monthPlan([], 8, '2026-12').nextMonth, '2027-01');
    assert.equal(nextWorkMonth('2026-12'), '2027-01');
    assert.equal(nextWorkMonth('nope'), null);
    assert.equal(monthName('2026-11'), 'November');
});

test('moving the overage picks the most recently approved pages that have not started', () => {
    const records = [
        page({ id: 'old', workMonth: '2026-11', updatedAt: '2026-11-01T10:00:00Z' }),
        page({ id: 'newest', workMonth: '2026-11', updatedAt: '2026-11-10T10:00:00Z' }),
        page({ id: 'newer', workMonth: '2026-11', updatedAt: '2026-11-09T10:00:00Z' }),
        page({ id: 'writing', workMonth: '2026-11', productionStatus: 'writing', updatedAt: '2026-11-11T10:00:00Z' }),
        page({ id: 'published', workMonth: '2026-11', productionStatus: 'published', updatedAt: '2026-11-11T11:00:00Z' }),
        page({ id: 'december', workMonth: '2026-12', updatedAt: '2026-11-12T10:00:00Z' }),
    ];
    const plan = monthPlan(records, 3, '2026-11');
    assert.equal(plan.over, 2);
    assert.deepEqual(overPlanMoves(records, plan).map(record => record.id), ['newest', 'newer']);
    assert.deepEqual(overPlanMoves(records, monthPlan(records, 5, '2026-11')), []);
    assert.deepEqual(overPlanMoves(records, monthPlan(records, 0, '2026-11')).map(record => record.id), ['newest', 'newer', 'old']);
});

test('filter chips, topic group and search narrow the pages', () => {
    const records = [
        page({ id: 'idea', title: 'Gum disease signs', status: 'pending', topicGroup: 'Gum health' }),
        page({ id: 'waiting', title: 'First visit', status: 'pending', productionStatus: 'awaiting_approval', topicGroup: 'Family dentistry' }),
        page({ id: 'writing', title: 'Teeth whitening', productionStatus: 'writing', topicGroup: 'Cosmetic' }),
        page({ id: 'review', title: 'Cracked tooth', productionStatus: 'client_review', topicGroup: 'Patient education' }),
        page({ id: 'published', title: 'Emergency dentist', productionStatus: 'published', topicGroup: 'Emergency care' }),
        page({ id: 'live', title: 'Family dentist', status: 'pending', action: 'keep', matchedUrl: 'https://x.test/', topicGroup: 'Family dentistry' }),
        page({ id: 'declined', title: 'Same-day crowns', status: 'declined', productionStatus: 'declined', topicGroup: 'Restorative' }),
    ];
    const ids = (view: Partial<typeof DEFAULT_BOARD_VIEW>) =>
        filterBoardRecords(records, { ...DEFAULT_BOARD_VIEW, ...view }).map(record => record.id);
    assert.equal(ids({}).length, records.length);
    assert.deepEqual(ids({ filter: 'decision' }), ['idea', 'waiting']);
    assert.deepEqual(ids({ filter: 'in_progress' }), ['writing', 'review']);
    assert.deepEqual(ids({ filter: 'done' }), ['published', 'live']);
    assert.deepEqual(ids({ topicGroup: 'Family dentistry' }), ['waiting', 'live']);
    assert.deepEqual(ids({ query: '  TOOTH ' }), ['review']);
    assert.deepEqual(ids({ filter: 'done', topicGroup: 'Family dentistry', query: 'family' }), ['live']);
    assert.deepEqual(boardTopicGroups(records), [
        'Cosmetic', 'Emergency care', 'Family dentistry', 'Gum health', 'Patient education', 'Restorative',
    ]);
});

test('each row gets one plain link, and statuses have plain labels', () => {
    const link = (overrides: Partial<ContentBoardRecord>) => boardLink(page(overrides), 'summit');
    assert.deepEqual(link({ productionStatus: 'client_review', draftUrl: 'https://docs.test/d' }), {
        kind: 'approvals', href: '/workspace/summit?tab=approvals', label: 'Review in Approvals',
    });
    assert.deepEqual(link({ status: 'pending', productionStatus: 'awaiting_approval' }), { kind: 'waiting', label: 'Waiting on client' });
    assert.deepEqual(link({ productionStatus: 'published', liveUrl: 'https://example.com/a', draftUrl: 'https://docs.test/d' }), {
        kind: 'live', href: 'https://example.com/a', label: 'View live page',
    });
    assert.deepEqual(link({ action: 'keep', matchedUrl: 'https://example.com/home', status: 'pending' }), {
        kind: 'live', href: 'https://example.com/home', label: 'View live page',
    });
    assert.deepEqual(link({ productionStatus: 'writing', draftUrl: 'https://docs.test/d' }), {
        kind: 'draft', href: 'https://docs.test/d', label: 'Open draft',
    });
    assert.deepEqual(link({ productionStatus: 'writing', draftUrl: 'javascript:alert(1)' }), { kind: 'none', label: 'No link yet' });
    assert.deepEqual(link({}), { kind: 'none', label: 'No link yet' });

    assert.equal(BOARD_STATUS_LABEL.not_written, 'Not written');
    assert.equal(BOARD_STATUS_LABEL.client_review, 'Client review');
    assert.equal(BOARD_STATUS_LABEL.already_live, 'Already live');
    assert.equal(shortDueDate('2026-11-04', '2026-11'), 'Nov 4');
    assert.equal(shortDueDate('2027-01-15', '2026-11'), 'Jan 15, 2027');
    assert.equal(shortDueDate(null, '2026-11'), null);
});

test('the month list starts this month and keeps any saved month', () => {
    assert.deepEqual(contentMonthChoices('2026-11', ['2026-09', 'nope', null]), [
        '2026-09', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04',
        '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10',
    ]);
    assert.deepEqual(contentMonthChoices('November', []), []);
});

test('this month is the month in Los Angeles, not the browser time zone', () => {
    // 9 PM on Nov 30 in Los Angeles is already Dec 1 in UTC and in New York.
    assert.equal(currentWorkMonth(new Date('2026-12-01T05:00:00Z')), '2026-11');
    assert.equal(currentWorkMonth(new Date('2026-12-01T07:59:00Z')), '2026-11');
    assert.equal(currentWorkMonth(new Date('2026-12-01T08:00:00Z')), '2026-12');
    // Daylight time: midnight in Los Angeles on Jul 1 is 07:00 UTC.
    assert.equal(currentWorkMonth(new Date('2026-07-01T06:59:00Z')), '2026-06');
    assert.equal(currentWorkMonth(new Date('2026-07-01T07:00:00Z')), '2026-07');
    // New Year in Tokyo is still December in Los Angeles.
    assert.equal(currentWorkMonth(new Date('2027-01-01T00:30:00+09:00')), '2026-12');
    assert.equal(CONTENT_TIME_ZONE, 'America/Los_Angeles');
});
