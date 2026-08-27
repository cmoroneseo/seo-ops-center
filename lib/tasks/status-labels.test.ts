import test from 'node:test';
import assert from 'node:assert/strict';
import { TASK_STATUS_LABELS, taskStatusLabel } from './status-labels.ts';

test('multi-word statuses read the way the dropdown writes them', () => {
    // The shipped bug: `capitalize` over the enum rendered "Todo" directly
    // below a select whose own option said "To Do".
    assert.equal(taskStatusLabel('todo'), 'To Do');
    assert.equal(taskStatusLabel('in_progress'), 'In Progress');
});

test('every status has a label', () => {
    for (const [status, label] of Object.entries(TASK_STATUS_LABELS)) {
        assert.ok(label.length > 0, status);
        assert.ok(!label.includes('_'), `${status} label leaks the enum`);
    }
});

test('an unknown status degrades to itself rather than blank', () => {
    assert.equal(taskStatusLabel('archived'), 'archived');
});
