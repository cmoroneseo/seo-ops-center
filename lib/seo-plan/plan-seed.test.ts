import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETING_PLAN_TEMPLATE_ITEMS } from '../marketing-plan-template.ts';
import { newClientPlanItems } from '../client-setup.ts';
import { onboardingSeedItems } from './onboarding.ts';
import { planSeedInserts } from './plan-seed.ts';
import {
    APPLY_LIBRARY_HELP,
    APPLY_LIBRARY_LABEL,
    APPLY_ONBOARDING_HELP,
    APPLY_ONBOARDING_LABEL,
    CREATE_PLAN_LABEL,
    EMPTY_CHECKLIST_ADD,
    EMPTY_PLAN_ADD_TASKS,
    EMPTY_PLAN_BODY,
    EMPTY_PLAN_TITLE,
    NO_PLAN_TITLE,
    SETUP_CHOOSE,
    SETUP_CREATE,
    SETUP_CUSTOM_CHOICE,
    SETUP_HOURS_PER_MONTH,
    SETUP_HOURS_USED_HELP,
    SETUP_HOURS_USED_TITLE,
    SETUP_INTRO,
    SETUP_MONTHLY_CHOICE,
    SETUP_MONTHLY_SERVICES,
    SETUP_OPEN_PLAN,
    SETUP_PLAN_NOTE,
    SETUP_PLAN_PREVIEW,
    SETUP_READY_NOTE,
    SETUP_SAVED,
    SETUP_SAVED_TOGETHER,
    SETUP_SCOPE_NOTE,
    SETUP_TOTAL_HOURS,
    noPlanBody,
} from './empty-plan.ts';

const ids = {
    marketingPlanId: '00000000-0000-0000-0000-000000000200',
    organizationId: '00000000-0000-0000-0000-000000000010',
    clientId: '00000000-0000-0000-0000-000000000020',
};

test('a new client plan has no seeded tasks or checklist rows', () => {
    assert.deepEqual(newClientPlanItems(), []);
});

test('an explicit saved list still builds every library row, and onboarding stays optional', () => {
    const library = planSeedInserts({ seed: 'library', ...ids });
    assert.equal(library.length, MARKETING_PLAN_TEMPLATE_ITEMS.length);
    assert.equal(library.length > 0, true);
    assert.equal(library[0]?.title, MARKETING_PLAN_TEMPLATE_ITEMS[0]?.title);
    assert.equal(library[0]?.marketing_plan_id, ids.marketingPlanId);
    assert.equal(library.some(row => row.roadmap_included === true), false);

    const onboarding = planSeedInserts({ seed: 'onboarding', ...ids, scope: { gbp: true, listings: true } });
    const expected = onboardingSeedItems({ gbp: true, listings: true });
    assert.equal(onboarding.length, expected.length);
    assert.equal(onboarding.every(row => row.source === 'onboarding' && row.roadmap_phase === 'onboarding' && row.roadmap_included === true), true);
    assert.equal(onboarding.filter(row => row.title === 'Connect GA4 and Search Console').length, 1);

    const withoutLocal = planSeedInserts({ seed: 'onboarding', ...ids, scope: { gbp: false, listings: false } });
    assert.equal(withoutLocal.some(row => row.template_key === 'local.gbp' || row.template_key === 'local.listings'), false);
    assert.equal(withoutLocal.length < onboarding.length, true);
});

test('empty plan copy names the plan and tells a person how to add the first task', () => {
    const copy = [
        EMPTY_PLAN_TITLE,
        EMPTY_PLAN_BODY,
        EMPTY_PLAN_ADD_TASKS,
        EMPTY_CHECKLIST_ADD,
        NO_PLAN_TITLE,
        noPlanBody('Mayas Construction'),
        CREATE_PLAN_LABEL,
        APPLY_LIBRARY_LABEL,
        APPLY_LIBRARY_HELP,
        APPLY_ONBOARDING_LABEL,
        APPLY_ONBOARDING_HELP,
        SETUP_CUSTOM_CHOICE,
        SETUP_MONTHLY_CHOICE,
        SETUP_PLAN_NOTE,
        SETUP_PLAN_PREVIEW,
        SETUP_READY_NOTE,
        SETUP_SCOPE_NOTE,
        SETUP_INTRO,
        SETUP_SAVED,
        SETUP_CHOOSE,
        SETUP_MONTHLY_SERVICES,
        SETUP_HOURS_PER_MONTH,
        SETUP_HOURS_USED_TITLE,
        SETUP_HOURS_USED_HELP,
        SETUP_TOTAL_HOURS,
        SETUP_SAVED_TOGETHER,
        SETUP_CREATE,
        SETUP_OPEN_PLAN,
    ].join('\n');
    assert.match(copy, /work plan/);
    assert.match(copy, /search engine optimization/);
    assert.match(copy, /Add task/);
    assert.match(copy, /Add Item/);
    assert.doesNotMatch(copy, /\bSEO\b|\bGBP\b|\bGA4\b|playbook|template|seed/i);
});
