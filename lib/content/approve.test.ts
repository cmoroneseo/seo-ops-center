import test from 'node:test';
import assert from 'node:assert/strict';

import { approvalUpdate, planRecordApproval } from './approve.ts';
import { CONTENT_READ_ONLY, canEditContent } from './access.ts';

test('approving a page that is already approved and linked does not ask for another task', () => {
    const first = planRecordApproval({ status: 'pending', taskId: null });
    assert.equal(first.createTask, true);
    assert.equal(first.taskId, null);

    const linked = planRecordApproval({ status: 'approved', taskId: 'task-1' });
    assert.equal(linked.createTask, false);
    assert.equal(linked.taskId, 'task-1');
    const again = planRecordApproval({ status: 'approved', taskId: ' task-1 ' });
    assert.deepEqual(again, linked);

    assert.equal(planRecordApproval({ status: 'approved', taskId: '' }).createTask, true);
    assert.equal(planRecordApproval({ status: 'approved' }).createTask, true);
    assert.equal(planRecordApproval({ status: 'pending', taskId: 'task-1' }).createTask, true);
    assert.equal(planRecordApproval({ status: 'declined', taskId: 'task-1' }).createTask, true);
});

test('the saved approval keeps the existing task and the chosen month', () => {
    const reused = approvalUpdate({ productionStatus: 'writing' }, 'task-1', '2026-11');
    assert.equal(reused.ok, true);
    if (!reused.ok) return;
    assert.equal(reused.row.task_id, 'task-1');
    assert.equal(reused.row.status, 'approved');
    assert.equal(reused.row.work_month, '2026-11');
    assert.equal(reused.row.production_status, undefined);

    const fresh = approvalUpdate({ productionStatus: 'not_written' }, 'task-2', '2026-12');
    assert.equal(fresh.ok, true);
    if (!fresh.ok) return;
    assert.equal(fresh.row.production_status, 'approved');
    assert.equal(fresh.row.task_id, 'task-2');

    assert.equal(approvalUpdate({ productionStatus: null }, 'task-1', 'November').ok, false);
    assert.equal(approvalUpdate({ productionStatus: null }, '  ', '2026-11').ok, false);
});

test('viewers cannot change content', () => {
    assert.equal(canEditContent('viewer'), false);
    assert.equal(canEditContent('owner'), true);
    assert.equal(canEditContent('admin'), true);
    assert.equal(canEditContent('member'), true);
    assert.equal(canEditContent(null), false);
    assert.equal(canEditContent(undefined), false);
    assert.match(CONTENT_READ_ONLY, /view this content/);
});
