import test from 'node:test';
import assert from 'node:assert/strict';
import { executionCapacity, monthlyExecution, resolvePlanItem, monthKey } from './marketing-plan-execution.ts';
import type { MarketingPlanItem, Task } from './types.ts';
const task = (patch: Partial<Task> = {}): Task => ({ id: 't1', organizationId: 'o', title: 'Live task', status: 'todo', priority: 'high', assignees: [], assigneeIds: [], tags: [], subtasks: [], ...patch });
const item = (patch: Partial<MarketingPlanItem> = {}): MarketingPlanItem => ({ id: 'i', marketingPlanId: 'p', organizationId: 'o', clientId: 'c', stepKey: 'setup', title: 'Old title', status: 'todo', priority: 'low', sortOrder: 0, comments: [], isCustom: false, createdAt: '', updatedAt: '', ...patch });

test('completed and reopened tasks override stale checklist completion and cleared fields', () => {
    const done = resolvePlanItem(item({ status: 'todo', dueDate: '2026-08-01', assigneeId: 'old', linkedTask: task({ status: 'done' }) }));
    assert.equal(done.status, 'done'); assert.equal(done.title, 'Live task');
    assert.equal(done.dueDate, undefined); assert.equal(done.assigneeId, undefined);
    assert.equal(resolvePlanItem({ ...done, linkedTask: task({ status: 'in_progress' }) }).status, 'todo');
    assert.equal(resolvePlanItem(item({ linkedTask: task({ status: 'approved' }) })).status, 'done');
});

test('monthly scope deduplicates links, includes completed effort, and flags missing estimates', () => {
    const a = item({ linkedTask: task({ dueDate: '2026-09-23', estimatedHours: 3 }) });
    const summary = monthlyExecution([a, a, item({ linkedTask: task({ id: 't2', dueDate: '2026-09-18', status: 'done', estimatedHours: 2 }) }), item({ linkedTask: task({ id: 't3', dueDate: '2026-09-25' }) }), item({ linkedTask: task({ id: 'old', dueDate: '2026-08-20' }) }), item({ linkedTask: task({ id: 'future', dueDate: '2026-10-01', estimatedHours: 100 }) }), item({ linkedTask: task({ id: 'undated' }) }), item({ linkedTask: task({ id: 'done-undated', status: 'done' }) })], '2026-09', 4);
    assert.equal(summary.tasks.length, 3); assert.equal(summary.estimatedHours, 5);
    assert.equal(summary.remainingHours, -1); assert.equal(summary.missingEstimates, 1);
    assert.equal(summary.completed.length, 1); assert.equal(summary.carryover.length, 1); assert.equal(summary.unscheduled.length, 1);
    assert.equal(summary.tasks.at(-1)?.status, 'done');
});

test('unlinked library items do not silently become monthly commitments', () => {
    assert.equal(monthlyExecution([item({ dueDate: '2026-09-20' })], '2026-09', 10).tasks.length, 0);
    assert.equal(monthKey(new Date(2026, 0, 1)), '2026-01');
});

test('capacity subtracts logged task time and excludes completed estimates', () => {
    const result = executionCapacity([task({ estimatedHours: 5 }), task({ id: 'done', status: 'done', estimatedHours: 4 })], { t1: 2 }, 3, 10);
    assert.deepEqual(result, { plannedHours: 3, consumed: 6, available: 4, scale: 10 });
    const over = executionCapacity([task({ estimatedHours: 1 })], { t1: 4 }, 12, 10);
    assert.equal(over.plannedHours, 0); assert.equal(over.available, 0); assert.equal(over.scale, 12);
    assert.equal(executionCapacity([], {}, null, 0).scale, 1);
});

test('ignored linked tasks stay excluded from monthly execution', () => {
    const ignored = resolvePlanItem(item({ status: 'ignored', linkedTask: task({ dueDate: '2026-09-01', status: 'done' }) }));
    assert.equal(ignored.status, 'ignored');
    assert.equal(monthlyExecution([ignored], '2026-09', 10).tasks.length, 0);
});
