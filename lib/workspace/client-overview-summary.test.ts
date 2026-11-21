import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientOverviewSummaries, clientHealthLabel } from './client-overview-summary';

test('health labels match the client overview thresholds', () => {
    assert.deepEqual([100, 85, 84, 70, 69].map(clientHealthLabel), ['Healthy', 'Healthy', 'Watch', 'Watch', 'Critical']);
});

test('one organization snapshot summarizes tasks, hours, fulfillment and either plan type by client', () => {
    const summaries = buildClientOverviewSummaries(
        ['a', 'b', 'c', 'empty'].map(id => ({
            id, status: 'Active' as const, launchDate: '2026-01-01', seoHours: 10,
        })),
        {
            today: '2026-11-20',
            daysLeft: 10,
            tasks: [
                { clientId: 'a', status: 'todo' },
                { clientId: 'a', status: 'in_progress', dueDate: '2026-11-20T00:00:00+00:00' },
                { clientId: 'a', status: 'done', dueDate: '2026-11-01' },
                { clientId: 'a', status: 'todo', dueDate: '2026-11-19T00:00:00+00:00', blockedReason: 'Waiting for approval' },
                { clientId: 'b', status: 'todo', dueDate: '2026-11-25' },
                { clientId: 'b', status: 'todo', dueDate: '2026-11-21T00:00:00+00:00' },
                { clientId: 'outside', status: 'todo' },
            ],
            cells: [
                { clientId: 'b', promised: 2, delivered: 0, inProgress: 0, overdue: 1 },
                { clientId: 'c', promised: 2, delivered: 0, inProgress: 0, overdue: 2 },
            ],
            hoursByClient: { c: 12 },
            campaignClientIds: ['a', 'a', 'c'],
            marketingClientIds: ['b'],
        },
    );

    assert.deepEqual(summaries.a, {
        health: 'Healthy', openTasks: 3, overdueTasks: 1, blockedTasks: 1, nextDueDate: '2026-11-19',
        overdueDeliverables: 0, hoursLogged: 0, hoursSeverity: 'ok', hasCampaignPlan: true,
    });
    assert.equal(summaries.b.nextDueDate, '2026-11-21');
    assert.equal(summaries.b.overdueTasks, 0);
    assert.equal(summaries.b.hasCampaignPlan, true);
    assert.equal(summaries.b.health, 'Watch');
    assert.equal(summaries.c.overdueDeliverables, 2);
    assert.equal(summaries.c.hoursSeverity, 'critical');
    assert.equal(summaries.c.health, 'Critical');
    assert.equal(summaries.empty.openTasks, 0);
    assert.equal(summaries.empty.nextDueDate, null);
    assert.equal(summaries.outside, undefined);
});
