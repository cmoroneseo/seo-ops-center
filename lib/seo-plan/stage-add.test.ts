import assert from 'node:assert/strict';
import test from 'node:test';

import {
    appendStageTasks,
    commitStageTasks,
    endPosition,
    nextStagePositions,
    pendingStageTasks,
    rollbackStageTasks,
} from './stage-add.ts';
import { groupTasksByStage, type StageListTask } from './stage-list.ts';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'onboarding',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const current: StageListTask[] = [
    task({ id: 'setup', title: 'SEO Setup', position: 1 }),
    task({ id: 'roadmap', title: 'Create SEO Roadmap', position: 2 }),
    task({ id: 'robots', title: 'Review robots.txt', stage: 'backlog', position: 4 }),
    task({ id: 'keywords', title: 'Add keywords', parentTaskId: 'setup', position: 2 }),
    task({ id: 'cookies', title: 'Set Up Empire Cookies', stage: 'backlog', parentTaskId: 'setup', position: 9 }),
];

test('new positions start at 1 and then walk forward from the end', () => {
    assert.deepEqual(nextStagePositions(null, 2), [1, 2]);
    assert.deepEqual(nextStagePositions(4, 3), [5, 6, 7]);
    assert.deepEqual(nextStagePositions(0, 1), [1]);
    assert.deepEqual(nextStagePositions(Number.NaN, 1), [1]);
    assert.deepEqual(nextStagePositions(2.5, 2), [3.5, 4.5]);
    assert.deepEqual(nextStagePositions(1, 0), []);
});

test('top-level placement stays inside the stage, and a subtask follows the whole pillar', () => {
    assert.equal(endPosition(current, 'onboarding', null), 2);
    assert.equal(endPosition(current, 'backlog', null), 4);
    assert.equal(endPosition([], 'backlog', null), null);
    assert.equal(endPosition(current, 'onboarding', 'setup'), 9);
});

test('optimistic rows render at the end of the stage and roll back without touching other rows', () => {
    const positions = nextStagePositions(endPosition(current, 'onboarding', null), 2);
    const pending = pendingStageTasks({
        titles: ['Hold kickoff', 'Confirm access'],
        stage: 'onboarding',
        parentTaskId: null,
        ids: ['pending:kickoff', 'pending:access'],
        createdAt: '2026-10-16T12:00:00.000Z',
        positions,
    });
    const shown = appendStageTasks(current, pending);
    const onboarding = groupTasksByStage(shown, '').find(section => section.stage === 'onboarding');
    assert.deepEqual(onboarding?.groups.map(group => group.task.title), [
        'SEO Setup',
        'Create SEO Roadmap',
        'Hold kickoff',
        'Confirm access',
    ]);
    assert.equal(pending[0].basecamp, false);
    assert.equal(pending[0].status, 'todo');

    const other = pendingStageTasks({
        titles: ['Later'],
        stage: 'backlog',
        parentTaskId: null,
        ids: ['pending:later'],
        createdAt: '2026-10-16T12:00:01.000Z',
        positions: [1],
    });
    const both = appendStageTasks(shown, other);
    const rolled = rollbackStageTasks(both, ['pending:kickoff', 'pending:access']);
    assert.deepEqual(rolled.map(item => item.id), [...current.map(item => item.id), 'pending:later']);
});

test('a saved task replaces its pending row and is not duplicated when the list already has it', () => {
    const pending = pendingStageTasks({
        titles: ['Hold kickoff'],
        stage: 'onboarding',
        parentTaskId: null,
        ids: ['pending:kickoff'],
        createdAt: '2026-10-16T12:00:00.000Z',
        positions: [3],
    });
    const created = task({ id: 'real-kickoff', title: 'Hold kickoff', position: 3, createdAt: '2026-10-16T12:00:02.000Z' });
    const committed = commitStageTasks(appendStageTasks(current, pending), ['pending:kickoff'], [created]);
    assert.equal(committed.some(item => item.id === 'pending:kickoff'), false);
    assert.equal(committed.filter(item => item.id === 'real-kickoff').length, 1);

    const reloaded = commitStageTasks([...current, created], ['pending:kickoff'], [created]);
    assert.equal(reloaded.filter(item => item.id === 'real-kickoff').length, 1);
});
