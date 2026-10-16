import test from 'node:test';
import assert from 'node:assert/strict';
import {
    basecampStepPageItems,
    mergeBasecampTodoSteps,
    normalizeBasecampTodoStep,
    stepsForTodo,
} from './todo-steps.ts';

const publish = {
    id: 10211449969,
    title: 'Publish on website',
    completed: false,
    due_on: '2026-10-30',
    position: 1,
    status: 'active',
    assignees: [{ id: 9999, name: 'Unmapped' }],
    parent: { id: 10211418597, type: 'Todo' },
};

const approval = {
    id: 10211450455,
    title: 'Send for approval',
    completed: true,
    completion: { created_at: '2026-08-17T21:40:17.999Z' },
    position: 2,
    status: 'active',
    assignees: [{ id: 5001 }, { id: 'nope' }],
    parent: { id: 10211418597, type: 'Todo' },
};

test('a to-do step keeps its recording id, completion, due date, and numeric assignees', () => {
    const step = normalizeBasecampTodoStep(approval);
    assert.deepEqual(step, {
        id: 10211450455,
        title: 'Send for approval',
        due_on: null,
        completed: true,
        completion: { created_at: '2026-08-17T21:40:17.999Z' },
        completed_at: null,
        assignees: [{ id: 5001 }],
        position: 2,
        parentTodoId: 10211418597,
    });
    assert.equal(normalizeBasecampTodoStep(publish)?.due_on, '2026-10-30');
});

test('trashed steps and blank titles are not steps', () => {
    assert.equal(normalizeBasecampTodoStep({ ...approval, status: 'trashed' }), null);
    assert.equal(normalizeBasecampTodoStep({ ...publish, title: '   ' }), null);
    assert.equal(normalizeBasecampTodoStep({ title: 'No id' }), null);
});

test('a list page and the steps embedded on the to-do merge to one ordered checklist', () => {
    const merged = mergeBasecampTodoSteps([
        [approval],
        [publish, approval, { ...publish, title: 'second copy' }],
    ]);
    assert.deepEqual(merged.map(step => step.title), [
        'Publish on website',
        'Send for approval',
    ]);
    assert.deepEqual(basecampStepPageItems({ steps: [publish] }), [publish]);
    assert.deepEqual(basecampStepPageItems([approval]), [approval]);
    assert.deepEqual(basecampStepPageItems({}), []);
});

test('a step that names another to-do is not part of this checklist', () => {
    const steps = mergeBasecampTodoSteps([[
        publish,
        { ...approval, parent: { id: 42, type: 'Todo' } },
        { ...approval, id: 7, title: 'No parent', parent: null },
    ]]);
    assert.deepEqual(
        stepsForTodo(steps, '10211418597').map(step => step.title),
        ['Publish on website', 'No parent'],
    );
});
