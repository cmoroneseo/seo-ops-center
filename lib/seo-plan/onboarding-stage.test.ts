import test from 'node:test';
import assert from 'node:assert/strict';

import {
    maxTopLevelOnboardingPosition,
    onboardingStageWrites,
    type OnboardingStageTask,
} from './onboarding-stage.ts';

function task(overrides: Partial<OnboardingStageTask> & Pick<OnboardingStageTask, 'id'>): OnboardingStageTask {
    return {
        stage: 'backlog',
        parentTaskId: null,
        position: null,
        ...overrides,
    };
}

test('backlog onboarding imports append after Onboarding, and a task already there is left alone', () => {
    const tasks = [
        task({ id: 'kept', stage: 'onboarding', position: 4 }),
        task({ id: 'setup', stage: 'backlog', position: 0 }),
        task({ id: 'research', stage: null, position: 2 }),
        task({ id: 'other', stage: 'backlog', position: 1 }),
        task({ id: 'step', stage: 'backlog', parentTaskId: 'setup', position: 1 }),
        task({ id: 'done-step', stage: 'onboarding', parentTaskId: 'setup', position: 2 }),
        task({ id: 'kept-step', stage: 'backlog', parentTaskId: 'kept', position: 3 }),
    ];
    const writes = onboardingStageWrites({
        tasks,
        includedIds: new Set(['setup', 'research', 'kept']),
        maxPosition: maxTopLevelOnboardingPosition(tasks),
    });
    assert.deepEqual(writes, [
        { id: 'setup', position: 5 },
        { id: 'research', position: 6 },
        { id: 'kept-step' },
        { id: 'step' },
    ]);
});

test('a second add does not reshuffle tasks that are already in Onboarding', () => {
    const tasks = [
        task({ id: 'setup', stage: 'onboarding', position: 1 }),
        task({ id: 'step', stage: 'onboarding', parentTaskId: 'setup', position: 1 }),
    ];
    assert.deepEqual(onboardingStageWrites({
        tasks,
        includedIds: new Set(['setup']),
        maxPosition: maxTopLevelOnboardingPosition(tasks),
    }), []);
});

test('a task outside this add stays where the user put it', () => {
    const tasks = [
        task({ id: 'moved', stage: 'backlog', position: 3 }),
    ];
    assert.deepEqual(onboardingStageWrites({
        tasks,
        includedIds: new Set(),
        maxPosition: null,
    }), []);
});
