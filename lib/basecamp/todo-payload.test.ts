import test from 'node:test';
import assert from 'node:assert/strict';
import { basecampTodoCreateBody } from './api.ts';

test('Basecamp create payload uses the official fields for every mapped SEO PM value', () => {
    assert.deepEqual(basecampTodoCreateBody({
        content: 'Optimize service pages',
        description: 'Start with the highest-opportunity pages.',
        dueOn: '2026-09-01',
        assigneePersonIds: [10, 11],
        completionSubscriberPersonIds: [12],
    }), {
        content: 'Optimize service pages',
        description: 'Start with the highest-opportunity pages.',
        due_on: '2026-09-01',
        assignee_ids: [10, 11],
        completion_subscriber_ids: [12],
    });
});
