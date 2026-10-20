import test from 'node:test';
import assert from 'node:assert/strict';

import {
    assignOnboardingPositions,
    containedIdsFromBasecampGroups,
    EMPTY_ONBOARDING_SCOPE,
    importedTodoLandsInOnboarding,
    providerParentListId,
    sourceListIsOnboarding,
    type OnboardingListScope,
} from './import-stage.ts';

/**
 * Read-only check, Oct 2026: client f1eabcd4's configured onboarding id
 * 10424777299 is the todolist "Set up SEO campaign". It is one list inside
 * the Onboarding Checklist to-do set, next to lists such as Internal
 * Onboarding (10424777697). The SEO Plan list is 10424778903. That setup
 * list has no groups. Sibling lists must stay in Backlog.
 */
const SETUP_LIST = '10424777299';
const SIBLING_LIST = '10424777697';
const SEO_PLAN_LIST = '10424778903';
const GROUP_ID = '10424780001';

const scope: OnboardingListScope = {
    onboardingTodolistId: SETUP_LIST,
    containedIds: [GROUP_ID],
};

test('the configured setup list lands in Onboarding, and a sibling list does not', () => {
    assert.equal(sourceListIsOnboarding(SETUP_LIST, scope), true);
    assert.equal(sourceListIsOnboarding(GROUP_ID, scope), true);
    assert.equal(sourceListIsOnboarding(SIBLING_LIST, scope), false);
    assert.equal(sourceListIsOnboarding(SEO_PLAN_LIST, scope), false);
    assert.equal(sourceListIsOnboarding(SETUP_LIST, EMPTY_ONBOARDING_SCOPE), false);
    assert.equal(sourceListIsOnboarding(null, scope), false);
});

test('a group id and the provider parent both count as the onboarding list', () => {
    assert.equal(importedTodoLandsInOnboarding({
        requestedListId: SETUP_LIST,
        providerParentId: null,
        scope,
    }), true);
    assert.equal(importedTodoLandsInOnboarding({
        requestedListId: GROUP_ID,
        providerParentId: null,
        scope,
    }), true);
    assert.equal(importedTodoLandsInOnboarding({
        requestedListId: null,
        providerParentId: GROUP_ID,
        scope,
    }), true);
    assert.equal(importedTodoLandsInOnboarding({
        requestedListId: SIBLING_LIST,
        providerParentId: SEO_PLAN_LIST,
        scope,
    }), false);
    assert.equal(providerParentListId({ parent: { id: SETUP_LIST, type: 'Todolist' } }), SETUP_LIST);
    assert.equal(providerParentListId({ parent: { id: 10425524627, type: 'Todo' } }), null);
    assert.equal(providerParentListId({}), null);
});

test('group payloads contribute recording ids and nothing else', () => {
    assert.deepEqual(containedIdsFromBasecampGroups([
        { id: 10424780001, parent: { id: Number(SETUP_LIST), type: 'Todolist' } },
        { id: '10424780001' },
        { id: 'nope' },
        null,
    ]), [GROUP_ID]);
    assert.deepEqual(containedIdsFromBasecampGroups({ id: GROUP_ID }), []);
});

test('onboarding rows append after the current end, and other rows keep the backlog default', () => {
    const setup = { title: 'SEO Set Up', stage: 'onboarding' };
    const research = { title: 'Perform keyword research', stage: 'onboarding' };
    const other = { title: 'Contract line', sort_order: 0 };
    const placed = assignOnboardingPositions([setup, other, research], 4);
    assert.equal(placed[0].position, 5);
    assert.equal(placed[0].stage, 'onboarding');
    assert.equal(Object.hasOwn(placed[1], 'stage'), false);
    assert.equal(Object.hasOwn(placed[1], 'position'), false);
    assert.equal(placed[2].position, 6);
    assert.deepEqual(assignOnboardingPositions([setup, research], null).map(row => row.position), [1, 2]);
});
