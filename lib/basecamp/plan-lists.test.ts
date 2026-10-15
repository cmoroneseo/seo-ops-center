import test from 'node:test';
import assert from 'node:assert/strict';
import { readBasecampPlanLists, seoPlanPushTodolistId } from './plan-lists.ts';

test('a client with one todolist keeps that id as the SEO Plan push target', () => {
    const lists = readBasecampPlanLists({
        basecamp_project_id: 49198430,
        basecamp_todolist_id: 10388242991,
        basecamp_sync_enabled: true,
    });
    assert.equal(lists.projectId, '49198430');
    assert.equal(lists.seoPlanTodolistId, '10388242991');
    assert.equal(lists.onboardingTodolistId, '');
    assert.equal(seoPlanPushTodolistId({
        basecamp_todolist_id: '10388242991',
        basecamp_onboarding_todolist_id: '10388242459',
    }), '10388242991');
});

test('push never falls back to the onboarding list', () => {
    assert.equal(seoPlanPushTodolistId({
        basecamp_onboarding_todolist_id: '10388242459',
    }), '');
    assert.equal(seoPlanPushTodolistId(null), '');
    assert.equal(readBasecampPlanLists({
        basecamp_project_id: '49198430',
        basecamp_todolist_id: '10388242991',
        basecamp_onboarding_todolist_id: '10388242459',
    }).onboardingTodolistId, '10388242459');
});
