import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast } from './build.ts';
import { EMPTY_FORECAST_SYNC_REASON, forecastWeekChip, formatLastSynced, presentForecast, syncButtonLabel } from './present.ts';

test('the preview shows allocation, a review link, and an em dash instead of a fake zero', () => {
    const built = buildForecast({
        organizationId: '22222222-2222-4222-8222-222222222222',
        today: '2026-10-14',
        timeZone: 'America/Los_Angeles',
        selectedWeekStarts: ['2026-10-12', '2026-10-19'],
        members: [{
            userId: 'user-carlos',
            displayName: 'Carlos Morones',
            email: 'cmorones@marketingempiregroup.com',
        }, {
            userId: 'user-abel',
            displayName: 'Abel Miranda',
            email: 'amiranda@marketingempiregroup.com',
        }],
        directory: [
            { id: 'desk_carlos', email: 'cmorones@marketingempiregroup.com' },
            { id: 'desk_abel', email: 'amiranda@marketingempiregroup.com' },
        ],
        logs: [{
            id: 'a', userId: 'user-carlos', clientId: '33333333-3333-4333-8333-333333333333',
            clientName: 'Northwind Plumbing', date: '2026-10-14', hours: 4,
            status: 'logged', importStatus: 'mapped',
        }, {
            id: 'b', userId: 'user-carlos', date: '2026-10-14', hours: 1,
            status: 'logged', importStatus: 'mapped', plannerEventId: 'meet',
        }, {
            id: 'orphan', userId: 'user-abel', date: '2026-10-14', hours: 2,
            status: 'logged', importStatus: 'needs_context',
        }, {
            id: 'break-log', userId: 'user-carlos', date: '2026-10-14', hours: 0.5,
            status: 'logged', importStatus: 'mapped', plannerEventId: 'break',
        }],
        events: [{
            id: 'meet', userId: 'user-carlos', attendeeIds: [], kind: 'meeting',
            startsAt: '2026-10-14T17:00:00.000Z', endsAt: '2026-10-14T18:00:00.000Z',
            allDay: false, title: 'Standup',
        }, {
            id: 'break', userId: 'user-carlos', attendeeIds: [], kind: 'break',
            startsAt: '2026-10-14T19:00:00.000Z', endsAt: '2026-10-14T19:30:00.000Z',
            allDay: false, title: 'Break',
        }],
        tasks: [{
            id: 'gap', title: 'Write the brief', status: 'todo', assigneeIds: ['user-abel'],
            clientId: '33333333-3333-4333-8333-333333333333', clientName: 'Northwind Plumbing',
            startDate: '2026-10-20T16:00:00.000Z', estimatedHours: null,
        }],
    });
    const view = presentForecast(built, { enabled: false, reason: 'Campaign Desk sync is turned off.' }, null);
    const carlos = view.sections[0].people[0];
    assert.equal(carlos.rows[0].sourceLabel, 'Actual');
    assert.equal(carlos.rows[0].hoursLabel, '4h 00m');
    assert.equal(carlos.rows[0].allocationLabel, '80%');
    assert.equal(carlos.rows[1].clientLabel, 'Internal');
    assert.equal(carlos.rows[1].hoursLabel, '1h 00m');
    assert.equal(carlos.rows[1].allocationLabel, '20%');
    const gap = view.sections[1].people[0].rows[0];
    assert.equal(gap.hoursLabel, '—');
    assert.match(gap.hoursReason ?? '', /No estimate/);
    assert.equal(gap.allocationLabel, '—');
    assert.equal(view.warnings.some(warning => warning.href === '/timesheets?tab=imports' && warning.hrefLabel === 'Review'), true);
    assert.match(view.notes.join(' '), /Breaks left out: 30m/);
    assert.equal(view.syncDisabled, true);
    assert.match(view.syncDisabledReason ?? '', /turned off/);
    assert.equal(view.syncLabel, 'Sync 2 weeks');
    assert.equal(syncButtonLabel(1), 'Sync 1 week');
    assert.equal(forecastWeekChip('2026-10-12', '2026-10-14'), 'This week · Oct 12');
    assert.equal(view.sections[0].emptyLabel, null);
});

test('last synced names the person, and a missing time stays an em dash', () => {
    const synced = formatLastSynced('2026-10-14T22:42:00.000Z', 'Carlos Morones', 'UTC');
    assert.equal(synced.label, 'Last synced Oct 14, 10:42 PM by Carlos Morones');
    assert.equal(synced.reason, null);
    assert.deepEqual(formatLastSynced(null, null, 'UTC'), { label: 'Not synced yet', reason: null });
    assert.equal(formatLastSynced('not-a-date', 'Carlos', 'UTC').label, '—');
});

test('an empty or unmapped preview disables sync so it cannot clear Campaign Desk', () => {
    const empty = buildForecast({
        organizationId: '22222222-2222-4222-8222-222222222222',
        today: '2026-10-14',
        timeZone: 'America/Los_Angeles',
        selectedWeekStarts: ['2026-10-12'],
        members: [{
            userId: 'user-carlos',
            displayName: 'Carlos Morones',
            email: 'cmorones@marketingempiregroup.com',
        }],
        directory: [{ id: 'desk_carlos', email: 'cmorones@marketingempiregroup.com' }],
        logs: [],
        events: [],
        tasks: [],
    });
    const emptyView = presentForecast(empty, { enabled: true, reason: null }, null);
    assert.equal(emptyView.syncDisabled, true);
    assert.equal(emptyView.syncDisabledReason, EMPTY_FORECAST_SYNC_REASON);

    const unmapped = buildForecast({
        organizationId: '22222222-2222-4222-8222-222222222222',
        today: '2026-10-14',
        timeZone: 'America/Los_Angeles',
        selectedWeekStarts: ['2026-10-12'],
        members: [{
            userId: 'user-carlos',
            displayName: 'Carlos Morones',
            email: 'cmorones@marketingempiregroup.com',
        }],
        directory: [],
        logs: [{
            id: 'a', userId: 'user-carlos', clientId: '33333333-3333-4333-8333-333333333333',
            clientName: 'Northwind Plumbing', date: '2026-10-14', hours: 4,
            status: 'logged', importStatus: 'mapped',
        }],
        events: [],
        tasks: [],
    });
    const unmappedView = presentForecast(unmapped, { enabled: true, reason: null }, null);
    assert.equal(unmappedView.syncDisabled, true);
    assert.equal(unmappedView.syncDisabledReason, EMPTY_FORECAST_SYNC_REASON);
    assert.equal(unmappedView.sections[0].people[0].rows[0].hoursLabel, '4h 00m');
});
