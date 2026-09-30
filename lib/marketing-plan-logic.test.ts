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
} from './marketing-plan-logic.ts';
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
