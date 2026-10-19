import test from 'node:test';
import assert from 'node:assert/strict';
import type { MarketingPlanItem } from '../types.ts';
import { managerIsAssigned, onboardingProgress, planHourLabel, planSurfaceViews, scheduleHoursNote, taskDateCounts } from './overview.ts';

function item(over: Partial<MarketingPlanItem>): MarketingPlanItem {
    return {
        id: 'i1', marketingPlanId: 'p1', organizationId: 'o1', clientId: 'c1',
        stepKey: 'foundation', title: 'Strategy', status: 'todo', priority: 'high',
        sortOrder: 0, comments: [], isCustom: false,
        createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
        ...over,
    };
}

test('onboarding progress counts selected onboarding items and ignores library rows', () => {
    const progress = onboardingProgress([
        item({ id: 'a', title: 'Strategy', roadmapIncluded: true, roadmapPhase: 'onboarding', status: 'done' }),
        item({ id: 'b', title: 'GBP', roadmapIncluded: true, roadmapPhase: 'onboarding' }),
        item({ id: 'c', title: 'Listings', roadmapIncluded: true, roadmapPhase: 'onboarding' }),
        item({ id: 'lib', title: 'Audit crawl budget', roadmapIncluded: false, roadmapPhase: 'onboarding' }),
        item({ id: 'm1', title: 'Month one content', roadmapIncluded: true, roadmapPhase: 'month_1' }),
        item({ id: 'ignored', title: 'Skipped', status: 'ignored', roadmapPhase: 'onboarding' }),
    ]);
    assert.equal(progress.total, 3);
    assert.equal(progress.done, 1);
    assert.deepEqual(progress.items.map(row => row.id), ['a', 'b', 'c']);
});

test('undated tasks increment need a date and do not increment a due count', () => {
    const counts = taskDateCounts([
        { status: 'todo', dueDate: null },
        { status: 'in_progress' },
        { status: 'todo', dueDate: '' },
        { status: 'todo', dueDate: '2026-10-12' },
        { status: 'todo', dueDate: '2026-11-02' },
        { status: 'done', dueDate: null },
        { status: 'approved', dueDate: '2026-10-03' },
    ], '2026-10');
    assert.equal(counts.needDate, 3);
    assert.equal(counts.due, 1);
});

test('hour labels follow the client scope and never render a missing budget as zero', () => {
    assert.equal(planHourLabel({
        seoHours: 0,
        status: 'Active',
        launchDate: '2026-01-01',
        month: '2026-10',
    }), '—');
    assert.equal(planHourLabel({
        seoHours: 10,
        scopeMode: 'custom',
        status: 'Active',
        launchDate: '2026-01-01',
        month: '2026-10',
    }), 'Custom scope');
    assert.equal(planHourLabel({
        seoHours: 10,
        status: 'Onboarding',
        launchDate: '2026-11-01',
        month: '2026-10',
    }), 'Hours start after launch');
    assert.equal(planHourLabel({
        seoHours: 10,
        status: 'Active',
        launchDate: '2026-01-01',
        month: '2026-10',
    }), '10h/mo');
    assert.equal(scheduleHoursNote('unavailable', 10, 9, 1), '—');
    assert.equal(scheduleHoursNote('prelaunch', 10, 9, 1), 'These hours start after launch.');
});

test('v2 plan surfaces are This month and Roadmap', () => {
    assert.deepEqual(planSurfaceViews(true).map(view => view.label), ['This month', 'Roadmap']);
    assert.deepEqual(planSurfaceViews(false).map(view => view.label), ['This month', 'Full plan', 'Results']);
    assert.equal(managerIsAssigned(''), false);
    assert.equal(managerIsAssigned('Unassigned'), false);
    assert.equal(managerIsAssigned('Abel Miranda'), true);
});
