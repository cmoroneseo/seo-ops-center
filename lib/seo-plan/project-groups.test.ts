import assert from 'node:assert/strict';
import test from 'node:test';

import { groupTasksByProject } from './project-groups.ts';
import { applyStageReorder } from './stage-reorder.ts';
import type { StageListTask } from './stage-list.ts';

const projects = [
    { id: 'second', title: 'Second' },
    { id: 'first', title: 'First' },
    { id: 'empty', title: 'Empty' },
    { id: 'blank', title: 'Blank' },
];

function task(id: string, overrides: Partial<StageListTask> = {}): StageListTask {
    return {
        id, title: id, status: 'todo', position: 1, parentTaskId: null,
        category: null, createdAt: '', basecamp: false, recurring: false, ...overrides,
    };
}

test('project order follows the client list, empty projects remain, unrecognized links go last, and a subtask whose parent is not on the board stays visible', () => {
    const tasks = [
        task('parent', { initiativeId: 'first', stage: 'foundation' }),
        task('child', { initiativeId: 'second', parentTaskId: 'parent', stage: 'onboarding' }),
        task('other', { initiativeId: 'second', status: 'done' }),
        task('unknown', { initiativeId: 'outside-client' }),
        task('unassigned', { initiativeId: null }),
        task('orphan', { parentTaskId: 'missing', initiativeId: 'empty' }),
    ];
    const groups = groupTasksByProject(tasks, projects);

    assert.deepEqual(groups.map(group => group.id), ['second', 'first', 'empty', 'blank', 'no-project']);
    assert.deepEqual(groups.map(group => group.groups.map(row => row.task.id)), [
        ['other'], ['parent'], ['orphan'], [], ['unassigned', 'unknown'],
    ]);
    const orphan = groups[2].groups.find(row => row.task.id === 'orphan');
    assert.equal(orphan?.parentBreadcrumb, 'Under another task');
    assert.equal(groups[0].meta, '1 / 1 done');
    assert.equal(groups[2].meta, '0 / 1 done');
    assert.equal(groups[3].meta, '0 / 0 done');
    assert.deepEqual(groups[1].groups[0].children.map(child => child.id), ['child']);

    const results = groupTasksByProject(tasks, projects, 'child');
    assert.equal(results[0].count, 0);
    assert.equal(results[1].groups[0].task.id, 'parent');
    assert.equal(results[1].groups[0].expandChildren, true);
});

test('project reorder writes only positions in the group, without stage metadata', () => {
    const tasks = [
        task('one', { initiativeId: 'first', stage: 'foundation' }),
        task('two', { initiativeId: 'first', position: 2 }),
        task('untouched', { initiativeId: 'second', position: 7 }),
    ];
    const move = applyStageReorder(tasks, {
        taskId: 'two', parentTaskId: null, index: 0, projectGroup: 'first', projects,
    });
    assert.ok(move.ok);
    assert.deepEqual(move.writes, [
        { id: 'two', position: 1, parentTaskId: null },
        { id: 'one', position: 2, parentTaskId: null },
    ]);
    assert.deepEqual(groupTasksByProject(move.tasks, projects)[1].groups.map(group => group.task.id), ['two', 'one']);
});
