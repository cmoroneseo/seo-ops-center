import test from 'node:test';
import assert from 'node:assert/strict';
import { isClientVisibleEvent } from './client-activity.ts';

/**
 * The activity feed doubles as a client-facing report. Events describing our
 * own tooling belong in the audit trail, not in that report.
 */

test('an import event is internal', () => {
    assert.equal(isClientVisibleEvent('integration.tasks_imported'), false);
});

test('the work itself stays visible', () => {
    for (const eventType of ['task.completed', 'task.created', 'deliverable.published']) {
        assert.equal(isClientVisibleEvent(eventType), true, eventType);
    }
});

test('connecting an integration remains visible', () => {
    // Only the task-import chatter was called out as noise; a connection is a
    // real change to how the client's work is tracked.
    assert.equal(isClientVisibleEvent('integration.connected'), true);
});
