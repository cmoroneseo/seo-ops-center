import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETING_PLAN_TEMPLATE_ITEMS } from '../marketing-plan-template.ts';
import { onboardingProgress } from './overview.ts';
import {
    CONNECT_ANALYTICS_TITLE,
    catalogAddBlocked,
    onboardingChecklist,
    onboardingSeedItems,
    titlesForTemplateKey,
} from './onboarding.ts';
import { isSeoPlanOperator } from './operator.ts';
import type { MarketingPlanItem } from '../types.ts';

test('onboarding is one analytics item, with GBP and listings only in scope', () => {
    const base = onboardingChecklist({});
    assert.equal(base.length, 7);
    assert.equal(base.filter(item => item.title === CONNECT_ANALYTICS_TITLE).length, 1);
    assert.equal(base.some(item => item.templateKey === 'access.gsc' || item.templateKey === 'access.ga4'), false);
    assert.equal(base.some(item => item.title === 'Add Project to SEO platform'), false);
    const full = onboardingChecklist({ gbp: true, listings: true });
    assert.deepEqual(full.map(item => item.templateKey), [
        'access.cms', 'access.analytics', 'access.portal', 'tracking.consent', 'tracking.rank',
        'strategy.roadmap', 'kickoff.call', 'local.gbp', 'local.listings',
    ]);
    assert.equal(new Set(full.map(item => item.templateKey)).size, full.length);
});

test('catalog rows that repeat checklist work share a key and cannot be added twice', () => {
    const analytics = MARKETING_PLAN_TEMPLATE_ITEMS.filter(item => item.templateKey === 'access.analytics').map(item => item.title);
    assert.deepEqual(analytics, ['Connect Google Search Console', 'Connect Google Analytics 4']);
    const covered = titlesForTemplateKey('access.analytics');
    assert.ok(covered.includes(CONNECT_ANALYTICS_TITLE));
    assert.ok(covered.includes('Connect Google Search Console'));
    const plan = [{ templateKey: 'access.analytics', title: CONNECT_ANALYTICS_TITLE }];
    assert.equal(catalogAddBlocked(plan, { templateKey: 'access.analytics', title: 'Connect Google Analytics 4' }), true);
    assert.equal(catalogAddBlocked(plan, { templateKey: 'access.analytics', title: 'Connect Google Search Console' }), true);
    assert.equal(catalogAddBlocked([{ title: 'Prepare SEO strategy and roadmap' }], { templateKey: 'strategy.roadmap', title: 'Create the SEO roadmap and recommendations' }), true);
    assert.equal(catalogAddBlocked([], { templateKey: 'tracking.rank', title: 'Add client to Ahrefs tracking' }), false);
});

test('a seeded checklist reports real open work, not an empty zero', () => {
    const seeded = onboardingSeedItems({ gbp: false, listings: false });
    const items = seeded.map((item, index): MarketingPlanItem => ({
        id: `item-${index}`,
        marketingPlanId: 'plan',
        organizationId: 'org',
        clientId: 'client',
        stepKey: item.stepKey,
        title: item.title,
        description: item.description,
        status: 'todo',
        priority: item.priority,
        sortOrder: index,
        comments: [],
        isCustom: false,
        templateKey: item.templateKey,
        source: item.source,
        roadmapIncluded: true,
        roadmapPhase: 'onboarding',
        createdAt: '2026-10-13T00:00:00Z',
        updatedAt: '2026-10-13T00:00:00Z',
    }));
    const progress = onboardingProgress(items);
    assert.equal(progress.total, 7);
    assert.equal(progress.done, 0);
    assert.equal(progress.items.length, 7);
});

test('SEO admins and owners are operators; the integration permission stays', () => {
    assert.equal(isSeoPlanOperator('admin'), true);
    assert.equal(isSeoPlanOperator('admin', false), true);
    assert.equal(isSeoPlanOperator('owner'), true);
    assert.equal(isSeoPlanOperator('member'), false);
    assert.equal(isSeoPlanOperator('member', true), true);
    assert.equal(isSeoPlanOperator('viewer'), false);
    assert.equal(isSeoPlanOperator('viewer', true), true);
});
