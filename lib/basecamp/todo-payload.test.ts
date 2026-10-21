import test from 'node:test';
import assert from 'node:assert/strict';
import {
    basecampAccountPath,
    basecampRecordingPath,
    basecampSubtaskCompletionPath,
    basecampSubtaskCreatePath,
    basecampSubtaskSupport,
    basecampTodoCreateBody,
    basecampTodoUpdateBody,
    basecampTrashPath,
} from './api.ts';

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

test('a to-do update sends content with the assignee and subscriber lists, including when they are empty', () => {
    assert.deepEqual(basecampTodoUpdateBody({
        content: 'Indexing + bloat triage',
        description: 'Pick one page per service and city.',
        dueOn: '2026-11-30',
        assigneePersonIds: [],
        completionSubscriberPersonIds: [],
    }), {
        content: 'Indexing + bloat triage',
        description: 'Pick one page per service and city.',
        due_on: '2026-11-30',
        assignee_ids: [],
        completion_subscriber_ids: [],
    });
    assert.deepEqual(basecampTodoUpdateBody({
        content: 'Indexing + bloat triage',
        description: null,
        dueOn: null,
        assigneePersonIds: [4],
        completionSubscriberPersonIds: [9],
    }), {
        content: 'Indexing + bloat triage',
        description: '',
        due_on: null,
        assignee_ids: [4],
        completion_subscriber_ids: [9],
    });
});

test('subtask support follows the recording fields and the create path is the recordings route', () => {
    assert.equal(basecampSubtaskSupport({ id: 1 }), undefined);
    assert.equal(basecampSubtaskSupport({ subtasks_count: 0, subtasks_url: 'https://3.basecampapi.com/1/recordings/2/subtasks.json' }), true);
    assert.equal(basecampSubtaskSupport({ subtasks_count: undefined, subtasks_url: '' }), false);
    assert.equal(basecampSubtaskCreatePath(77), '/recordings/77/subtasks.json');
    assert.equal(basecampSubtaskCompletionPath(200), '/subtasks/200/completion.json');
    assert.equal(basecampRecordingPath(12, 77), '/buckets/12/recordings/77.json');
    assert.equal(basecampTrashPath(12, 77), '/buckets/12/recordings/77/status/trashed.json');
    assert.equal(
        basecampAccountPath('https://3.basecampapi.com/5338018/buckets/12/todos.json?page=2'),
        '/buckets/12/todos.json?page=2',
    );
    assert.equal(basecampAccountPath('https://example.com/buckets/12/todos.json'), null);
    assert.throws(() => basecampSubtaskCreatePath('not-an-id'), /parentTodoId/);
});
