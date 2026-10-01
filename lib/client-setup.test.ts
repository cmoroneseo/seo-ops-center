import test from 'node:test';
import assert from 'node:assert/strict';
import { setupBudgetMonth, setupPlanItems, validateClientSetup, type ClientSetupInput } from './client-setup';
const input: ClientSetupInput = { requestId: 'id', organizationId: 'org', name: 'Mayas Construction', website: '', accountManagerId: '', onboardingDate: '2026-09-01', launchDate: '', seoHours: 5, template: 'foundation', customItems: [], scope: { version: 1, mode: 'monthly', hoursMode: 'committed', contentPieces: 1, gbp: true, gbpUsesSeoHours: false, listings: true, onboardingBudget: 'separate' } };
test('setup distinguishes committed hours, allowance, and mixed content', () => {
    assert.equal(validateClientSetup(input, '2026-09-30'), null);
    assert.equal(validateClientSetup({ ...input, scope: { ...input.scope, hoursMode: 'allowance' } }, '2026-09-30'), null);
    assert.match(validateClientSetup({ ...input, launchDate: '2026-10-01' }, '2026-09-30')!, /Launched Date/);
    assert.match(validateClientSetup({ ...input, scope: { ...input.scope, contentPieces: 0.5 } }, '2026-09-30')!, /whole number/);
    assert.match(validateClientSetup({ ...input, website: 'javascript:alert(1)' }, '2026-09-30')!, /website URL/);
});
test('only explicit onboarding work is selected; foundation remains available to tailor', () => {
    const items = setupPlanItems(input);
    const selected = items.filter(item => item.included);
    assert.equal(selected.length, 3);
    assert.ok(selected.every(item => item.phase === 'onboarding'));
    assert.ok(items.some(item => !item.included && item.stepKey === 'technical'));
    assert.equal(setupPlanItems({ ...input, template: 'blank', customItems: ['Fix critical redirects'] }).filter(item => item.included).length, 4);
});
test('onboarding hours are allocated at launch without moving their recording date', () => {
    const scope = input.scope;
    assert.equal(setupBudgetMonth('2026-09-15', null, '2026-09-01', scope), null);
    assert.equal(setupBudgetMonth('2026-09-15', '2026-10-01', '2026-09-01', scope), null);
    assert.equal(setupBudgetMonth('2026-09-15', '2026-10-01', '2026-09-01', { ...scope, onboardingBudget: 'first_month' }), '2026-10');
    assert.equal(setupBudgetMonth('2026-10-15', '2026-10-01', '2026-09-01', scope), '2026-10');
    assert.equal(setupBudgetMonth('2026-09-15', null, null, null), '2026-09');
});
