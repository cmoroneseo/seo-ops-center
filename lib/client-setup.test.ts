import test from 'node:test';
import assert from 'node:assert/strict';
import { setupHoursStatus, setupBudgetMonth, setupPlanItems, validateClientSetup, type ClientSetupInput } from './client-setup';
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
    assert.equal(items.filter(item => item.templateKey).length, 0);
    assert.equal(setupPlanItems({ ...input, template: 'blank', customItems: ['Fix critical redirects'] }).filter(item => item.included).length, 4);
});
test('flagged setup seeds the onboarding checklist and leaves the library in code', () => {
    const items = setupPlanItems(input, { v2: true });
    const titles = items.map(item => item.title);
    assert.equal(items.length, 9);
    assert.ok(items.every(item => item.included && item.phase === 'onboarding' && item.source === 'onboarding'));
    assert.equal(titles.filter(title => title === 'Connect GA4 and Search Console').length, 1);
    assert.equal(titles.includes('Connect Google Search Console'), false);
    assert.equal(titles.includes('Connect Google Analytics 4'), false);
    assert.equal(items.some(item => item.stepKey === 'technical'), false);
    assert.equal(new Set(items.map(item => item.templateKey)).size, items.length);
    const withoutLocal = setupPlanItems({ ...input, scope: { ...input.scope, gbp: false, listings: false } }, { v2: true });
    assert.equal(withoutLocal.length, 7);
    assert.equal(withoutLocal.some(item => item.templateKey === 'local.gbp' || item.templateKey === 'local.listings'), false);
    const withCustom = setupPlanItems({ ...input, template: 'blank', customItems: ['Fix critical redirects'] }, { v2: true });
    const custom = withCustom.find(item => item.title === 'Fix critical redirects');
    assert.equal(custom?.source, 'custom');
    assert.equal(custom?.templateKey, undefined);
    assert.equal(withCustom.filter(item => item.source === 'onboarding').length, 9);
});
test('onboarding hours are allocated at launch without moving their recording date', () => {
    const scope = input.scope;
    assert.equal(setupBudgetMonth('2026-09-15', null, '2026-09-01', scope), null);
    assert.equal(setupBudgetMonth('2026-09-15', '2026-10-01', '2026-09-01', scope), null);
    assert.equal(setupBudgetMonth('2026-09-15', '2026-10-01', '2026-09-01', { ...scope, onboardingBudget: 'first_month' }), '2026-10');
    assert.equal(setupBudgetMonth('2026-10-15', '2026-10-01', '2026-09-01', scope), '2026-10');
    assert.equal(setupBudgetMonth('2026-09-15', null, null, null), '2026-09');
});

test('committed hours flag shortfalls; allowance and onboarding do not', () => {
    const committed = input.scope;
    const allowance = { ...committed, hoursMode: 'allowance' as const };
    assert.equal(setupHoursStatus(committed, 'Active', '2026-08-01', 3, 5, '2026-09', '2026-10-01').status, 'Shortfall');
    assert.equal(setupHoursStatus(allowance, 'Active', '2026-08-01', 3, 5, '2026-09', '2026-10-01').severity, 'ok');
    assert.equal(setupHoursStatus(committed, 'Onboarding', undefined, 0, 5, '2026-09', '2026-10-01').status, 'Planned');
    assert.equal(setupHoursStatus(committed, 'Active', '2026-08-01', 3, 5, '2026-09', '2026-09-28').severity, 'warn');
    assert.equal(setupHoursStatus(committed, 'Active', '2026-08-01', 5, 5, '2026-09', '2026-09-28').status, 'Met');
    assert.equal(setupHoursStatus(allowance, 'Active', '2026-08-01', 6, 5, '2026-09', '2026-09-28').status, 'Over');
    assert.equal(setupHoursStatus(committed, 'Paused', '2026-08-01', 0, 5, '2026-09', '2026-10-01').severity, 'ok');
});
