import assert from 'node:assert/strict';
import test from 'node:test';

import { rowToTask, taskInsertToRpcPayload } from '../supabase/tasks.ts';
import { TASK_STAGES, type TaskStage } from '../types.ts';
import { earliestTaskStage, isTaskStage } from './stage.ts';

test('the stage list is the roadmap order, earliest first', () => {
    assert.deepEqual(TASK_STAGES, ['onboarding', 'backlog']);
    const listed: readonly TaskStage[] = TASK_STAGES;
    assert.equal(listed.length, 2);
    for (const stage of TASK_STAGES) assert.equal(isTaskStage(stage), true);
    assert.equal(isTaskStage('month_1'), false);
    assert.equal(isTaskStage('month_2'), false);
    assert.equal(isTaskStage('month_3'), false);
    assert.equal(isTaskStage('month_4'), false);
    assert.equal(isTaskStage(null), false);
});

test('several included phases resolve to the earliest one', () => {
    assert.equal(earliestTaskStage(['backlog', 'onboarding']), 'onboarding');
    assert.equal(earliestTaskStage(['onboarding', 'backlog', 'onboarding']), 'onboarding');
    assert.equal(earliestTaskStage(['backlog', 'backlog']), 'backlog');
});

test('missing and unknown phases stay backlog', () => {
    assert.equal(earliestTaskStage([]), 'backlog');
    assert.equal(earliestTaskStage([null, undefined, 'month_4', 'due_soon']), 'backlog');
    assert.equal(earliestTaskStage(['month_3', 'onboarding', 'month_1']), 'onboarding');
    assert.equal(earliestTaskStage(['month_2', 'month_3', 'backlog']), 'backlog');
    assert.equal(earliestTaskStage(['backlog', 'month_1']), 'backlog');
    assert.equal(earliestTaskStage(['month_3']), 'backlog');
    assert.equal(earliestTaskStage(['nope', 'month_2']), 'backlog');
});

test('task reads keep a known stage and position and drop anything else', () => {
    const task = rowToTask({
        id: 'task-1',
        organization_id: 'org-1',
        title: 'SEO Setup',
        stage: 'onboarding',
        position: 2,
    });
    assert.equal(task.stage, 'onboarding');
    assert.equal(task.position, 2);

    const unmigrated = rowToTask({ id: 'task-2', organization_id: 'org-1', title: 'Loose task' });
    assert.equal(unmigrated.stage, undefined);
    assert.equal(unmigrated.position, undefined);

    const invalid = rowToTask({
        id: 'task-3',
        organization_id: 'org-1',
        title: 'Bad stage',
        stage: 'month_1',
        position: Number.NaN,
    });
    assert.equal(invalid.stage, undefined);
    assert.equal(invalid.position, undefined);
});

test('task writes do not send stage or position', () => {
    const payload = taskInsertToRpcPayload({ organizationId: 'org-1', title: 'New task' });
    assert.equal('stage' in payload, false);
    assert.equal('position' in payload, false);
});
