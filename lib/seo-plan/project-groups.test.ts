import assert from 'node:assert/strict';
import test from 'node:test';

import { groupTasksByProject } from './project-groups.ts';
import { applyStageReorder } from './stage-reorder.ts';
import type { StageListTask } from './stage-list.ts';

const projects = [
    { id: 'second', title: 'Second' },
    { id: 'first', title: 'First' },
    { id: 'empty', title: 'Empty' },
];

function task(id: string, overrides: Partial<StageListTask> = {}): StageListTask {
    return {
        id, title: id, stage: 'backlog', status: 'todo', position: 1, parentTaskId: null,
        category: null, createdAt: '', basecamp: false, recurring: false, ...overrides,
    };
}

test('project order follows the client list, empty projects remain, and unrecognized links go last', () => {
    const tasks = [
        task('parent', { initiativeId: 'first', stage: 'foundation' }),
        task('child', { initiativeId: 'second', parentTaskId: 'parent', stage: 'onboarding' }),
        task('other', { initiativeId: 'second', stage: 'growth', status: 'done' }),
        task('unknown', { initiativeId: 'outside-client' }),
        task('unassigned', { initiativeId: null }),
        task('orphan', { parentTaskId: 'missing', initiativeId: 'empty' }),
    ];
    const groups = groupTasksByProject(tasks, projects);

    assert.deepEqual(groups.map(group => group.id), ['second', 'first', 'empty', 'no-project']);
    assert.deepEqual(groups.map(group => group.groups.map(row => row.task.id)), [
        ['other'], ['parent'], [], ['unassigned', 'unknown'],
    ]);
    assert.equal(groups[0].meta, '1 / 1 done');
    assert.equal(groups[2].meta, '0 / 0 done');
    assert.deepEqual(groups[1].groups[0].children.map(child => child.id), ['child']);

    const results = groupTasksByProject(tasks, projects, 'child');
    assert.equal(results[0].count, 0);
    assert.equal(results[1].groups[0].task.id, 'parent');
    assert.equal(results[1].groups[0].expandChildren, true);
});

test('project reorder writes only positions in the group, even across stored stages', () => {
    const tasks = [
        task('one', { initiativeId: 'first', stage: 'foundation' }),
        task('two', { initiativeId: 'first', stage: 'growth', position: 2 }),
        task('untouched', { initiativeId: 'second', position: 7 }),
    ];
    const move = applyStageReorder(tasks, {
        taskId: 'two', stage: 'growth', parentTaskId: null, index: 0, projectGroup: 'first', projects,
    });
    assert.ok(move.ok);
    assert.deepEqual(move.writes, [
        { id: 'two', stage: 'growth', position: 1, parentTaskId: null },
        { id: 'one', stage: 'foundation', position: 2, parentTaskId: null },
    ]);
    assert.deepEqual(groupTasksByProject(move.tasks, projects)[1].groups.map(group => group.task.id), ['two', 'one']);
});
