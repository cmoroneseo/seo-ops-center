import test from 'node:test';
import assert from 'node:assert/strict';
import { basecampSubtaskCreatePath, basecampSubtaskSupport, basecampTodoCreateBody } from './api.ts';

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

test('subtask support follows the recording fields and the create path is the recordings route', () => {
    assert.equal(basecampSubtaskSupport({ id: 1 }), undefined);
    assert.equal(basecampSubtaskSupport({ subtasks_count: 0, subtasks_url: 'https://3.basecampapi.com/1/recordings/2/subtasks.json' }), true);
    assert.equal(basecampSubtaskSupport({ subtasks_count: undefined, subtasks_url: '' }), false);
    assert.equal(basecampSubtaskCreatePath(77), '/recordings/77/subtasks.json');
    assert.throws(() => basecampSubtaskCreatePath('not-an-id'), /parentTodoId/);
});
