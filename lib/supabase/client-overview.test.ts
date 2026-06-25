import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHealthScore, computeNextBestActions } from './client-overview-logic.ts';

test('computeHealthScore: all-green client scores 100', () => {
    assert.equal(computeHealthScore({
        overdueDeliverables: 0,
        hoursSeverity: 'ok',
        blockedTasks: 0,
        hasCampaignPlan: true,
    }), 100);
});

test('computeHealthScore: overdue deliverables degrade with cap', () => {
    assert.equal(computeHealthScore({
        overdueDeliverables: 1,
        hoursSeverity: 'ok',
        blockedTasks: 0,
        hasCampaignPlan: true,
    }), 80);
    assert.equal(computeHealthScore({
        overdueDeliverables: 3,
        hoursSeverity: 'ok',
        blockedTasks: 0,
        hasCampaignPlan: true,
    }), 60);
});

test('computeHealthScore: critical hours degrade', () => {
    assert.equal(computeHealthScore({
        overdueDeliverables: 0,
        hoursSeverity: 'critical',
        blockedTasks: 0,
        hasCampaignPlan: true,
    }), 85);
});

test('computeHealthScore: clamps from 0 to 100', () => {
    assert.equal(computeHealthScore({
        overdueDeliverables: 20,
        hoursSeverity: 'critical',
        blockedTasks: 20,
        hasCampaignPlan: false,
    }), 20);
    assert.equal(computeHealthScore({
        overdueDeliverables: 0,
        hoursSeverity: 'ok',
        blockedTasks: 0,
        hasCampaignPlan: true,
    }), 100);
});

test('computeNextBestActions: prioritizes overdue deliverables', () => {
    const actions = computeNextBestActions({
        overdueDeliverables: 2,
        hoursSeverity: 'ok',
        blockedTasks: 0,
        hasCampaignPlan: true,
        hoursLogged: 5,
        hoursBudget: 10,
        openTasks: 1,
        atRiskDeliverables: 0,
    });

    assert.equal(actions[0].label, 'Clear overdue deliverables');
    assert.equal(actions[0].priority, 'critical');
});

test('computeNextBestActions: suggests scheduling work when hours are low', () => {
    const actions = computeNextBestActions({
        overdueDeliverables: 0,
        hoursSeverity: 'ok',
        blockedTasks: 0,
        hasCampaignPlan: true,
        hoursLogged: 3,
        hoursBudget: 10,
        openTasks: 0,
        atRiskDeliverables: 0,
    });

    assert.equal(actions[0].label, 'Schedule planned work');
});

test('computeNextBestActions: includes blocked tasks and missing plan', () => {
    const labels = computeNextBestActions({
        overdueDeliverables: 0,
        hoursSeverity: 'ok',
        blockedTasks: 2,
        hasCampaignPlan: false,
        hoursLogged: 6,
        hoursBudget: 10,
        openTasks: 3,
        atRiskDeliverables: 0,
    }).map((action) => action.label);

    assert.deepEqual(labels, ['Unblock active tasks', 'Create campaign plan']);
});
