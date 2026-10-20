import assert from 'node:assert/strict';
import test from 'node:test';

import {
    classifyBasecampHttpFailure,
    formatBasecampHttpFailure,
    formatPlanSyncAttempt,
    isSeoPlanTask,
    planTaskIgnoresBasecampReopen,
    nightlyBasecampRetryIds,
    planBasecampBanner,
    planBasecampReadout,
    planTaskQualifiesForBasecampPush,
    PLAN_BASECAMP_PUSH_DEBOUNCE_MS,
} from './basecamp-push.ts';

test('a backlog task with no due date does not qualify, and a due date or onboarding does', () => {
    assert.equal(planTaskQualifiesForBasecampPush({ stage: 'backlog', dueDate: null }), false);
    assert.equal(planTaskQualifiesForBasecampPush({ stage: 'backlog', dueDate: '' }), false);
    assert.equal(planTaskQualifiesForBasecampPush({ stage: 'backlog', dueDate: '2026-10-31' }), true);
    assert.equal(planTaskQualifiesForBasecampPush({ stage: 'onboarding', dueDate: null }), true);
    assert.equal(planTaskQualifiesForBasecampPush({ stage: null, dueDate: null }), false);
    assert.equal(PLAN_BASECAMP_PUSH_DEBOUNCE_MS, 2000);
});

test('only onboarding and backlog rows are plan tasks', () => {
    assert.equal(isSeoPlanTask('onboarding'), true);
    assert.equal(isSeoPlanTask('backlog'), true);
    assert.equal(isSeoPlanTask(null), false);
    assert.equal(isSeoPlanTask(undefined), false);
    assert.equal(planTaskIgnoresBasecampReopen('backlog', 'ok'), true);
    assert.equal(planTaskIgnoresBasecampReopen('backlog', 'failed'), true);
    assert.equal(planTaskIgnoresBasecampReopen('backlog', null), false);
    assert.equal(planTaskIgnoresBasecampReopen(null, 'ok'), false);
});

test('nightly retry keeps failed qualifying tasks and drops the rest', () => {
    const ids = nightlyBasecampRetryIds([
        { id: 'dated', state: 'failed', stage: 'backlog', dueDate: '2026-11-30', hasProject: true },
        { id: 'undated', state: 'failed', stage: 'backlog', dueDate: null, hasProject: true },
        { id: 'setup', state: 'failed', stage: 'onboarding', dueDate: null, hasProject: true },
        { id: 'healthy', state: 'ok', stage: 'onboarding', dueDate: '2026-10-31', hasProject: true },
        { id: 'unbound', state: 'failed', stage: 'onboarding', dueDate: '2026-10-31', hasProject: false },
        { id: 'waiting', state: null, stage: 'onboarding', dueDate: '2026-10-31', hasProject: true },
    ]);
    assert.deepEqual(ids, ['dated', 'setup']);
});

test('auth and a missing project are client-wide, and a missing to-do list is not', () => {
    assert.equal(classifyBasecampHttpFailure(401, 'todo'), 'client');
    assert.equal(classifyBasecampHttpFailure(429, 'todo'), 'client');
    assert.equal(classifyBasecampHttpFailure(404, 'project'), 'client');
    assert.equal(classifyBasecampHttpFailure(404, 'todolist'), 'task');
    assert.equal(classifyBasecampHttpFailure(404, 'todo'), 'task');
    assert.equal(
        formatBasecampHttpFailure(404, '', { operation: 'todolist', listName: 'SEO: October', projectName: "Maya's Construction" }),
        'Basecamp returned 404: the to-do list "SEO: October" no longer exists in project "Maya\'s Construction".',
    );
    assert.match(formatBasecampHttpFailure(401, 'nope', { operation: 'auth' }), /no longer authorized/);
});

test('a client with no project stays quiet, and a client-wide failure is one line', () => {
    assert.deepEqual(planBasecampBanner({
        syncEnabled: false,
        projectId: null,
        syncState: 'failed',
        syncError: 'revoked',
    }), { connected: false, failure: null });
    assert.equal(planBasecampBanner({
        syncEnabled: true,
        projectId: '48599958',
        syncState: 'failed',
        syncError: 'Basecamp returned 401: the connection is no longer authorized.',
    }).failure?.includes('401'), true);
    assert.equal(planBasecampBanner({
        syncEnabled: true,
        projectId: '48599958',
        syncState: 'ok',
        syncError: null,
    }).failure, null);
});

test('the side-panel readout is the stored state and does not invent a push', () => {
    const readout = planBasecampReadout({
        taskId: 'task-1',
        stage: 'backlog',
        dueDate: null,
        sync: { state: 'failed', error: 'Basecamp returned 404.', attemptedAt: '2026-10-20T18:14:00.000Z' },
        basecampTodoId: null,
        banner: { connected: true, failure: null },
    });
    assert.equal(readout.qualifies, false);
    assert.equal(readout.state, 'failed');
    assert.equal(readout.clientFailure, null);
    assert.equal(formatPlanSyncAttempt('2026-10-20T18:14:00.000Z', 'UTC'), 'Last try 6:14 PM');
    assert.equal(formatPlanSyncAttempt(null), '');
});
