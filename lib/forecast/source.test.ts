import test from 'node:test';
import assert from 'node:assert/strict';
import { rowToForecastLog, rowToForecastTask } from './source.ts';

test('unreadable hours stay null instead of becoming zero', () => {
    const log = rowToForecastLog({
        id: 'log-1',
        user_id: 'user-1',
        client_id: null,
        date: '2026-10-14',
        hours: 'nope',
        status: 'logged',
        import_status: 'mapped',
        voided_at: null,
        planner_event_id: null,
        planned_starts_at: '2026-10-14T18:30:00.000Z',
        basecamp_project_id: 47923138,
        clients: null,
    });
    assert.equal(log.hours, null);
    assert.equal(log.plannedStartsAt, '2026-10-14T18:30:00.000Z');
    assert.equal(log.basecampProjectId, '47923138');

    const missing = rowToForecastTask({
        id: 'task-1',
        title: 'Write the brief',
        status: 'todo',
        assignee_ids: ['user-1'],
        client_id: null,
        start_date: '2026-10-20T16:00:00.000Z',
        estimated_hours: null,
        clients: null,
    });
    assert.equal(missing.estimatedHours, null);
    assert.equal(missing.estimateUnreadable, false);

    const garbage = rowToForecastTask({
        id: 'task-2',
        title: 'Broken',
        status: 'todo',
        assignee_ids: [],
        client_id: null,
        start_date: null,
        estimated_hours: 'nope',
        clients: { name: 'Northwind Plumbing' },
    });
    assert.equal(garbage.estimatedHours, null);
    assert.equal(garbage.estimateUnreadable, true);
    assert.equal(garbage.clientName, 'Northwind Plumbing');
});
