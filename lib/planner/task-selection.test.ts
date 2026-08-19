import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTaskQuerySelection, taskForQuery } from './task-selection.ts';
import type { Task } from '../types';

function makeTask(id: string): Task {
    return {
        id,
        organizationId: 'org1',
        title: `Task ${id}`,
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [],
    };
}

test('taskForQuery selects the canonical task matching a deep-link id', () => {
    const wanted = makeTask('wanted');
    assert.equal(taskForQuery([makeTask('first'), wanted], 'wanted'), wanted);
});

test('taskForQuery ignores missing, blank, and unknown ids', () => {
    const tasks = [makeTask('first')];
    assert.equal(taskForQuery(tasks, null), null);
    assert.equal(taskForQuery(tasks, '  '), null);
    assert.equal(taskForQuery(tasks, 'missing'), null);
});

test('reconcileTaskQuerySelection opens the canonical task after its organization loads', () => {
    const wanted = makeTask('wanted');
    assert.deepEqual(reconcileTaskQuerySelection({
        tasks: [makeTask('first'), wanted],
        taskId: 'wanted',
        organizationId: 'org1',
        loadedOrganizationId: 'org1',
        loading: false,
        selectedTask: null,
        isDetailOpen: false,
    }), { selectedTask: wanted, isDetailOpen: true });
});

test('reconcileTaskQuerySelection closes a stale explicit query after loading', () => {
    assert.deepEqual(reconcileTaskQuerySelection({
        tasks: [makeTask('first')],
        taskId: 'missing',
        organizationId: 'org1',
        loadedOrganizationId: 'org1',
        loading: false,
        selectedTask: makeTask('old'),
        isDetailOpen: true,
    }), { selectedTask: null, isDetailOpen: false });
});

test('reconcileTaskQuerySelection closes an explicitly blank task query after loading', () => {
    assert.deepEqual(reconcileTaskQuerySelection({
        tasks: [makeTask('first')],
        taskId: '  ',
        organizationId: 'org1',
        loadedOrganizationId: 'org1',
        loading: false,
        selectedTask: makeTask('manual'),
        isDetailOpen: true,
    }), { selectedTask: null, isDetailOpen: false });
});

test('reconcileTaskQuerySelection clears prior-organization selection during an org change', () => {
    assert.deepEqual(reconcileTaskQuerySelection({
        tasks: [makeTask('old')],
        taskId: 'old',
        organizationId: 'org2',
        loadedOrganizationId: 'org1',
        loading: true,
        selectedTask: makeTask('old'),
        isDetailOpen: true,
    }), { selectedTask: null, isDetailOpen: false });
});

test('reconcileTaskQuerySelection waits for an in-scope refresh before rejecting a query', () => {
    const selected = makeTask('wanted');
    assert.deepEqual(reconcileTaskQuerySelection({
        tasks: [],
        taskId: 'wanted',
        organizationId: 'org1',
        loadedOrganizationId: 'org1',
        loading: true,
        selectedTask: selected,
        isDetailOpen: true,
    }), { selectedTask: selected, isDetailOpen: true });
});

test('reconcileTaskQuerySelection leaves manual selection open when there is no task query', () => {
    const selected = makeTask('manual');
    assert.deepEqual(reconcileTaskQuerySelection({
        tasks: [],
        taskId: null,
        organizationId: 'org2',
        loadedOrganizationId: 'org1',
        loading: true,
        selectedTask: selected,
        isDetailOpen: true,
    }), { selectedTask: selected, isDetailOpen: true });
});
