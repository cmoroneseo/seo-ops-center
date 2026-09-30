/**
 * Run with:  node --test lib/marketing-plan-logic.test.ts
 * (Node >= 23 strips TypeScript types natively — no test framework needed.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    computePlanSummary, groupItems, filterItems,
    itemsEligibleForTaskGeneration, taskFieldsFromPlanItem,
    nextChecklistStatusForTask, checklistTogglePlan,
    TASK_STATUSES_THAT_COMPLETE_CHECKLIST,
    readPlanReportView, fulfillmentCounts, stepFulfillmentBuckets,
    engagementMonthIndex, planEngagementAnchor, schedulingDateForItem,
    monthFulfillmentBuckets, planFulfillmentBuckets,
} from './marketing-plan-logic.ts';
import { displaySeoPlanTitle, SEO_PLAN_LABEL } from './marketing-plan-template.ts';
import type { MarketingPlanItem, MarketingPlanStep } from './types.ts';

function item(over: Partial<MarketingPlanItem>): MarketingPlanItem {
    return {
        id: 'i1', marketingPlanId: 'p1', organizationId: 'o1', clientId: 'c1',
        stepKey: 'setup', title: 'Item', status: 'todo', priority: 'medium',
        sortOrder: 0, comments: [], isCustom: false,
        createdAt: '2026-07-02T00:00:00Z', updatedAt: '2026-07-02T00:00:00Z',
        ...over,
    };
}

const STEPS: MarketingPlanStep[] = [
    { key: 'setup', name: 'Introduction & Setup', sortOrder: 0 },
    { key: 'technical', name: 'Technical SEO', sortOrder: 1 },
];

test('computePlanSummary counts statuses and priorities', () => {
    const s = computePlanSummary([
        item({ id: 'a', status: 'done', priority: 'high' }),
        item({ id: 'b', status: 'todo', priority: 'medium' }),
        item({ id: 'c', status: 'todo', priority: 'medium' }),
        item({ id: 'd', status: 'ignored', priority: 'low' }),
    ]);
    assert.equal(s.total, 4);
    assert.equal(s.done, 1);
    assert.equal(s.todo, 2);
    assert.equal(s.ignored, 1);
    // done / (total - ignored) = 1/3 → 33
    assert.equal(s.progressPercent, 33);
    // ignored items excluded from priority counts
    assert.deepEqual(s.priorityCounts, { high: 1, medium: 2, low: 0 });
});

test('computePlanSummary handles empty list', () => {
    const s = computePlanSummary([]);
    assert.equal(s.total, 0);
    assert.equal(s.progressPercent, 0);
});

test('computePlanSummary is 100% when all non-ignored are done', () => {
    const s = computePlanSummary([
        item({ id: 'a', status: 'done' }),
        item({ id: 'b', status: 'ignored' }),
    ]);
    assert.equal(s.progressPercent, 100);
});

test('groupItems by step keeps template order and includes empty steps', () => {
    const groups = groupItems(
        [item({ id: 'a', stepKey: 'technical', sortOrder: 1 }),
         item({ id: 'b', stepKey: 'technical', sortOrder: 0 })],
        STEPS, 'step');
    assert.equal(groups.length, 2);
    assert.equal(groups[0].label, 'Introduction & Setup');
    assert.equal(groups[0].items.length, 0);
    // sorted by sortOrder within group
    assert.deepEqual(groups[1].items.map(i => i.id), ['b', 'a']);
});

test('groupItems by priority omits empty groups, orders high→low', () => {
    const groups = groupItems(
        [item({ id: 'a', priority: 'low' }), item({ id: 'b', priority: 'high' })],
        STEPS, 'priority');
    assert.deepEqual(groups.map(g => g.key), ['high', 'low']);
});

test('groupItems by status orders todo→done→ignored', () => {
    const groups = groupItems(
        [item({ id: 'a', status: 'done' }), item({ id: 'b', status: 'todo' })],
        STEPS, 'status');
    assert.deepEqual(groups.map(g => g.key), ['todo', 'done']);
    assert.equal(groups[0].label, 'To Do');
});

test('filterItems matches title and description, case-insensitive', () => {
    const items = [
        item({ id: 'a', title: 'Connect Google Search Console' }),
        item({ id: 'b', title: 'Other', description: 'verify GSC property' }),
        item({ id: 'c', title: 'Unrelated' }),
    ];
    assert.deepEqual(filterItems(items, 'gsc').map(i => i.id), ['b']);
    assert.deepEqual(filterItems(items, 'google').map(i => i.id), ['a']);
    assert.equal(filterItems(items, '  ').length, 3);
});

test('task generation skips done, ignored, and already-linked items', () => {
    const eligible = itemsEligibleForTaskGeneration([
        item({ id: 'todo', status: 'todo' }),
        item({ id: 'done', status: 'done' }),
        item({ id: 'ignored', status: 'ignored' }),
        item({ id: 'linked', status: 'todo', taskId: 'task-1' }),
    ]);
    assert.deepEqual(eligible.map(i => i.id), ['todo']);
});

test('task fields copy title, description, priority, assignee, and due date', () => {
    const fields = taskFieldsFromPlanItem(item({
        title: 'Fix titles',
        description: 'Rewrite title tags',
        priority: 'high',
        assigneeId: 'user-1',
        dueDate: '2026-08-01',
    }));
    assert.equal(fields.title, 'Fix titles');
    assert.equal(fields.description, 'Rewrite title tags');
    assert.equal(fields.priority, 'high');
    assert.deepEqual(fields.assigneeIds, ['user-1']);
    assert.equal(fields.dueDate, '2026-08-01');
    assert.equal(fields.clientId, 'c1');

    const bare = taskFieldsFromPlanItem(item({ description: '' }));
    assert.equal(bare.description, undefined);
    assert.equal(bare.assigneeIds, undefined);
    assert.equal(bare.dueDate, undefined);
});

test('checklist follows done and approved, and never rewrites ignored items', () => {
    assert.deepEqual([...TASK_STATUSES_THAT_COMPLETE_CHECKLIST], ['done', 'approved']);
    assert.equal(nextChecklistStatusForTask('todo', 'done'), 'done');
    assert.equal(nextChecklistStatusForTask('todo', 'approved'), 'done');
    assert.equal(nextChecklistStatusForTask('done', 'done'), null);
    assert.equal(nextChecklistStatusForTask('done', 'approved'), null);
    assert.equal(nextChecklistStatusForTask('done', 'todo'), 'todo');
    assert.equal(nextChecklistStatusForTask('done', 'in_progress'), 'todo');
    assert.equal(nextChecklistStatusForTask('done', 'review'), 'todo');
    assert.equal(nextChecklistStatusForTask('done', 'blocked'), 'todo');
    assert.equal(nextChecklistStatusForTask('todo', 'in_progress'), null);
    assert.equal(nextChecklistStatusForTask('ignored', 'done'), null);
    assert.equal(nextChecklistStatusForTask('ignored', 'todo'), null);
});

test('checkbox completes a linked task and does not rewind in-progress work', () => {
    assert.deepEqual(
        checklistTogglePlan({ itemStatus: 'todo' }),
        { write: 'item', status: 'done' },
    );
    assert.deepEqual(
        checklistTogglePlan({ itemStatus: 'done' }),
        { write: 'item', status: 'todo' },
    );
    assert.deepEqual(
        checklistTogglePlan({ itemStatus: 'todo', taskId: 'task-1' }),
        { write: 'task', status: 'done' },
    );
    assert.deepEqual(
        checklistTogglePlan({ itemStatus: 'done', taskId: 'task-1', taskStatus: 'done' }),
        { write: 'task', status: 'todo' },
    );
    assert.deepEqual(
        checklistTogglePlan({ itemStatus: 'done', taskId: 'task-1', taskStatus: 'approved' }),
        { write: 'task', status: 'todo' },
    );
    assert.deepEqual(
        checklistTogglePlan({ itemStatus: 'done', taskId: 'task-1', taskStatus: 'in_progress' }),
        { write: 'item', status: 'todo' },
    );
    assert.deepEqual(
        checklistTogglePlan({ itemStatus: 'done', taskId: 'task-1', taskStatus: 'review' }),
        { write: 'item', status: 'todo' },
    );
    assert.deepEqual(
        checklistTogglePlan({ itemStatus: 'done', taskId: 'task-1', taskStatus: null }),
        { write: 'item', status: 'todo' },
    );
});

test('report view falls back to step', () => {
    assert.equal(readPlanReportView('month'), 'month');
    assert.equal(readPlanReportView('step'), 'step');
    assert.equal(readPlanReportView(undefined), 'step');
    assert.equal(readPlanReportView('priority'), 'step');
});

test('fulfillment counts leave ignored items out of the fraction', () => {
    const counts = fulfillmentCounts([
        item({ id: 'a', status: 'done' }),
        item({ id: 'b', status: 'todo' }),
        item({ id: 'c', status: 'ignored' }),
    ]);
    assert.equal(counts.done, 1);
    assert.equal(counts.todo, 1);
    assert.equal(counts.ignored, 1);
    assert.equal(counts.total, 2);
    assert.equal(counts.progressPercent, 50);
    assert.equal(fulfillmentCounts([]).progressPercent, 0);
});

test('step buckets number the template order and keep empty steps', () => {
    const buckets = stepFulfillmentBuckets([
        item({ id: 'done', stepKey: 'technical', status: 'done', sortOrder: 2 }),
        item({ id: 'todo', stepKey: 'technical', status: 'todo', sortOrder: 0 }),
        item({ id: 'skip', stepKey: 'technical', status: 'ignored', sortOrder: 1 }),
        item({ id: 'orphan', stepKey: 'missing', sortOrder: 0 }),
    ], STEPS);
    assert.deepEqual(buckets.map(b => b.label), [
        'Step 1: Introduction & Setup',
        'Step 2: Technical SEO',
        'Other',
    ]);
    assert.equal(buckets[0].done, 0);
    assert.equal(buckets[0].total, 0);
    assert.equal(buckets[1].done, 1);
    assert.equal(buckets[1].total, 2);
    assert.deepEqual(buckets[1].items.map(i => i.id), ['todo', 'skip', 'done']);
    assert.deepEqual(buckets[2].items.map(i => i.id), ['orphan']);
});

test('engagement month is the calendar offset from the anchor month', () => {
    assert.equal(engagementMonthIndex('2026-03-15', '2026-03-02'), 1);
    assert.equal(engagementMonthIndex('2026-03-15', '2026-05-01'), 3);
    assert.equal(engagementMonthIndex('2026-12-01', '2027-01-15'), 2);
    assert.equal(engagementMonthIndex('2026-03-15', '2026-02-28'), 0);
    assert.equal(engagementMonthIndex('2026-03-15', 'not-a-date'), null);
    assert.equal(engagementMonthIndex('2026-03-15T00:00:00Z', '2026-05-02T15:00:00Z'), 3);
});

test('engagement anchor prefers the launch override, then launch, then plan creation', () => {
    assert.equal(planEngagementAnchor({
        launchDateOverride: '2026-04-01',
        launchDate: '2025-01-01',
        planCreatedAt: '2026-07-02T00:00:00Z',
    }), '2026-04-01');
    assert.equal(planEngagementAnchor({
        launchDate: '2025-01-01',
        planCreatedAt: '2026-07-02T00:00:00Z',
    }), '2025-01-01');
    assert.equal(planEngagementAnchor({ planCreatedAt: '2026-07-02T00:00:00Z' }), '2026-07-02T00:00:00Z');
    assert.equal(planEngagementAnchor({ launchDate: 'soon' }), null);
});

test('checklist due date wins; linked task due date fills a blank item', () => {
    const taskDueDates = { 'task-1': '2026-08-01' };
    assert.equal(
        schedulingDateForItem(item({ dueDate: '2026-04-01', taskId: 'task-1' }), taskDueDates),
        '2026-04-01',
    );
    assert.equal(
        schedulingDateForItem(item({ dueDate: '  ', taskId: 'task-1' }), taskDueDates),
        '2026-08-01',
    );
    assert.equal(schedulingDateForItem(item({ taskId: 'task-1' })), null);
});

test('month buckets index from the anchor and keep undated items', () => {
    const buckets = monthFulfillmentBuckets([
        item({ id: 'm1', dueDate: '2026-03-20', status: 'done', sortOrder: 1 }),
        item({ id: 'm1b', dueDate: '2026-03-02', status: 'todo', sortOrder: 0 }),
        item({ id: 'm3', dueDate: '2026-05-01', status: 'todo' }),
        item({ id: 'early', dueDate: '2026-01-15', status: 'todo' }),
        item({ id: 'skip', dueDate: '2026-05-01', status: 'ignored' }),
        item({ id: 'linked', taskId: 'task-9', status: 'todo', sortOrder: 4 }),
        item({ id: 'none', status: 'todo', sortOrder: 2 }),
    ], {
        anchorDate: '2026-03-15',
        taskDueDates: { 'task-9': '2026-06-10' },
    });
    // April (month 2) has nothing, so it is omitted rather than shown as 0/0.
    assert.deepEqual(buckets.map(b => `${b.label} ${b.done}/${b.total}`), [
        'Before start 0/1',
        'Month 1 1/2',
        'Month 3 0/1',
        'Month 4 0/1',
        'Unscheduled 0/1',
    ]);
    assert.deepEqual(buckets[1].items.map(i => i.id), ['m1b', 'm1']);
    assert.deepEqual(buckets[3].items.map(i => i.id), ['linked']);
    assert.deepEqual(buckets[4].items.map(i => i.id), ['none']);
    // ignored stays in the month's items but not in the fraction
    assert.equal(buckets[2].items.length, 2);
    assert.equal(buckets[2].total, 1);
});

test('month buckets are all unscheduled when there is no anchor', () => {
    const buckets = planFulfillmentBuckets(
        [item({ id: 'dated', dueDate: '2026-03-01' }), item({ id: 'open' })],
        STEPS,
        'month',
        { anchorDate: null },
    );
    assert.deepEqual(buckets.map(b => b.key), ['unscheduled']);
    assert.equal(buckets[0].total, 2);
});

test('display title replaces the legacy SEO Marketing Plan label', () => {
    assert.equal(SEO_PLAN_LABEL, 'SEO Plan');
    assert.equal(displaySeoPlanTitle('Justia — SEO Marketing Plan'), 'Justia — SEO Plan');
    assert.equal(displaySeoPlanTitle('Custom checklist'), 'Custom checklist');
});
