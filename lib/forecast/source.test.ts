import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    assert.equal(log.workedStartsAt, undefined);
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

function loggedRow(overrides: {
    hours?: number | string | null;
    planned_starts_at?: string | null;
    time_log_segments?: {
        started_at?: string | null;
        ended_at?: string | null;
    } | {
        started_at?: string | null;
        ended_at?: string | null;
    }[] | null;
} = {}) {
    return {
        id: 'log-1',
        user_id: 'user-1',
        client_id: null,
        date: '2026-10-20',
        hours: '0.38' as number | string | null,
        status: 'logged',
        import_status: 'mapped',
        voided_at: null,
        planner_event_id: null,
        planned_starts_at: null as string | null,
        clients: null,
        ...overrides,
    };
}

test('a segment start becomes the worked clock', () => {
    const log = rowToForecastLog(loggedRow({
        time_log_segments: {
            started_at: '2026-10-20T17:29:20.582+00:00',
            ended_at: '2026-10-20T17:52:04.027+00:00',
        },
    }));
    assert.equal(log.workedStartsAt, '2026-10-20T17:29:20.582Z');
    assert.equal(log.plannedStartsAt, undefined);
    assert.equal(log.hours, 0.38);
});

test('several segments use the earliest start', () => {
    const log = rowToForecastLog(loggedRow({
        time_log_segments: [
            { started_at: '2026-10-20T17:52:04.027Z', ended_at: '2026-10-20T18:10:00.000Z' },
            { started_at: '2026-10-20T17:29:20.582Z', ended_at: '2026-10-20T17:52:04.027Z' },
            { started_at: null, ended_at: null },
            { started_at: 'not-a-time', ended_at: '2026-10-20T17:40:00.000Z' },
        ],
    }));
    assert.equal(log.workedStartsAt, '2026-10-20T17:29:20.582Z');
});

test('no readable segment leaves the worked clock empty', () => {
    assert.equal(rowToForecastLog(loggedRow()).workedStartsAt, undefined);
    assert.equal(rowToForecastLog(loggedRow({ time_log_segments: [] })).workedStartsAt, undefined);
    assert.equal(rowToForecastLog(loggedRow({
        time_log_segments: [{ started_at: ' ', ended_at: null }],
    })).workedStartsAt, undefined);
});

test('forecast logs embed segments through the time_log_id foreign key', () => {
    const source = readFileSync(new URL('./source.ts', import.meta.url), 'utf8');
    assert.match(
        source,
        /time_log_segments!time_log_segments_time_log_id_fkey\(started_at, ended_at\)/,
    );
});
