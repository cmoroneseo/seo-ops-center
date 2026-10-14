import test from 'node:test';
import assert from 'node:assert/strict';
import { buildForecast, matchPerson, type ForecastBuildInput, type ForecastEvent, type ForecastLog, type ForecastTask } from './build.ts';
import { CAMPAIGN_DESK_MEG_ORG_ID } from './flags.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const TODAY = '2026-10-14';
const THIS_WEEK = '2026-10-12';
const NEXT_WEEK = '2026-10-19';

const carlos = {
    userId: 'user-carlos',
    displayName: 'Carlos Morones',
    email: 'cmorones@marketingempiregroup.com',
};
const abel = {
    userId: 'user-abel',
    displayName: 'Abel Miranda',
    email: 'amiranda@marketingempiregroup.com',
};

function input(overrides: Partial<ForecastBuildInput> = {}): ForecastBuildInput {
    return {
        organizationId: ORG,
        today: TODAY,
        timeZone: 'America/Los_Angeles',
        selectedWeekStarts: [THIS_WEEK, NEXT_WEEK],
        members: [carlos, abel],
        directory: [
            { id: 'desk_carlos', email: 'cmorones@marketingempiregroup.com' },
            { id: 'desk_abel', email: 'amiranda@marketingempiregroup.com' },
        ],
        logs: [],
        events: [],
        tasks: [],
        ...overrides,
    };
}

function log(overrides: Partial<ForecastLog> & { id: string; date: string }): ForecastLog {
    return {
        userId: carlos.userId,
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        hours: 1,
        status: 'logged',
        importStatus: 'mapped',
        ...overrides,
    };
}

function task(overrides: Partial<ForecastTask> = {}): ForecastTask {
    return {
        id: 'task-1',
        title: 'Write the brief',
        status: 'todo',
        assigneeIds: [abel.userId],
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        startDate: '2026-10-20T16:00:00.000Z',
        estimatedHours: 3,
        ...overrides,
    };
}

function meeting(overrides: Partial<ForecastEvent> = {}): ForecastEvent {
    return {
        id: 'event-1',
        userId: abel.userId,
        attendeeIds: [],
        kind: 'meeting',
        startsAt: '2026-10-20T17:00:00.000Z',
        endsAt: '2026-10-20T18:00:00.000Z',
        allDay: false,
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        title: 'Client call',
        ...overrides,
    };
}

test('people match on the same email, ignoring case and surrounding space', () => {
    const directory = [{ id: 'desk_carlos', email: '  CMorones@MarketingEmpireGroup.com ' }];
    assert.deepEqual(matchPerson(carlos.email, directory), { status: 'mapped', campaignDeskPersonId: 'desk_carlos' });
    assert.equal(matchPerson('nobody@example.test', directory).status, 'not_mapped');
    assert.equal(matchPerson('', directory).reason, 'No email on this account');
    assert.equal(matchPerson(carlos.email, null).status, 'unknown');
    assert.match(matchPerson(carlos.email, null).reason, /not connected/);
    assert.equal(matchPerson(carlos.email, [
        { id: 'a', email: carlos.email },
        { id: 'b', email: carlos.email },
    ]).reason, 'Campaign Desk has more than one person with this email');
});

test('the current week uses tracked time and a later week uses task estimates', () => {
    const result = buildForecast(input({
        logs: [
            log({ id: 'client-work', date: '2026-10-14', hours: 4 }),
            log({ id: 'meeting-log', date: '2026-10-14', hours: 1, plannerEventId: 'meet-now', clientId: CLIENT }),
        ],
        events: [
            meeting({ id: 'meet-now', startsAt: '2026-10-14T17:00:00.000Z', endsAt: '2026-10-14T18:00:00.000Z', userId: carlos.userId }),
            meeting(),
        ],
        tasks: [task(), task({ id: 'this-week', startDate: '2026-10-14T16:00:00.000Z', assigneeIds: [carlos.userId], estimatedHours: 8 })],
    }));

    const actual = result.payloadBody.weeks.find(week => week.weekStart === THIS_WEEK);
    const estimate = result.payloadBody.weeks.find(week => week.weekStart === NEXT_WEEK);
    assert.equal(actual?.basis, 'actual');
    assert.deepEqual(actual?.allocations.map(line => [line.bucket, line.minutes, line.source]), [
        ['client', 240, 'actual'],
        ['internal', 60, 'actual'],
    ]);
    assert.equal(actual?.allocations[1].clientId, null);
    assert.equal(actual?.allocations[1].clientName, 'Internal');
    assert.equal(estimate?.basis, 'estimate');
    assert.deepEqual(estimate?.allocations.map(line => [line.personEmail, line.bucket, line.minutes]), [
        [abel.email, 'client', 180],
        [abel.email, 'internal', 60],
    ]);
    assert.equal(JSON.stringify(result.payloadBody).includes(CAMPAIGN_DESK_MEG_ORG_ID), false);
});

test('breaks are left out, unmapped time is not sent, and missing estimates are not zero', () => {
    const result = buildForecast(input({
        logs: [
            log({ id: 'break-log', date: '2026-10-13', hours: 0.5, plannerEventId: 'break-1', clientId: undefined, clientName: undefined }),
            log({ id: 'orphan', date: '2026-10-13', hours: 2, importStatus: 'needs_context' }),
            log({ id: 'open', date: '2026-10-13', hours: 1, status: 'in_progress' }),
            log({ id: 'void', date: '2026-10-13', hours: 9, importStatus: 'voided', voidedAt: '2026-10-13T00:00:00Z' }),
            log({ id: 'bad', date: '2026-10-13', hours: null }),
        ],
        events: [
            { id: 'break-1', userId: carlos.userId, attendeeIds: [], kind: 'break', startsAt: '2026-10-13T18:00:00.000Z', endsAt: '2026-10-13T18:30:00.000Z', allDay: false, title: 'Break' },
            { id: 'future-break', userId: abel.userId, attendeeIds: [], kind: 'break', startsAt: '2026-10-20T18:00:00.000Z', endsAt: '2026-10-20T18:30:00.000Z', allDay: false, title: 'Break' },
            meeting({ allDay: true, id: 'all-day' }),
        ],
        tasks: [
            task({ id: 'no-estimate', estimatedHours: null, title: 'Write the brief' }),
            task({ id: 'zero', estimatedHours: 0, title: 'Zero' }),
            task({ id: 'done', status: 'done', estimatedHours: 5 }),
            task({ id: 'many', assigneeIds: [carlos.userId, abel.userId], estimatedHours: 4 }),
            task({ id: 'none', assigneeIds: [], estimatedHours: 4 }),
        ],
    }));

    const sent = result.payloadBody.weeks.flatMap(week => week.allocations);
    assert.deepEqual(sent, []);
    assert.equal(result.breakMinutes, 60);
    assert.equal(JSON.stringify(result.payloadBody).includes('"minutes":0'), false);
    const kinds = new Map(result.warnings.map(warning => [warning.kind, warning.count]));
    assert.equal(kinds.get('unmapped_entries'), 1);
    assert.equal(kinds.get('open_entries'), 1);
    assert.equal(kinds.get('unreadable_hours'), 1);
    assert.equal(kinds.get('missing_estimates'), 2);
    assert.equal(kinds.get('all_day_meetings'), 1);
    assert.equal(kinds.get('multi_assignee_tasks'), 1);
    assert.equal(kinds.get('unassigned_tasks'), 1);
    const gap = result.weeks.flatMap(week => week.people).flatMap(person => person.rows)
        .find(row => row.minutesReason?.includes('Write the brief'));
    assert.equal(gap?.minutes, null);
    assert.equal(gap?.sent, false);
});

test('a disconnected directory does not label a known email as not mapped', () => {
    const result = buildForecast(input({
        directory: null,
        logs: [log({ id: 'a', date: '2026-10-14', hours: 2 })],
    }));
    const person = result.weeks[0].people[0];
    assert.equal(person.match.status, 'unknown');
    assert.equal(person.rows[0].minutes, 120);
    assert.equal(person.rows[0].sent, false);
    assert.deepEqual(result.payloadBody.weeks[0].allocations, []);
});

test('an email with no Campaign Desk person is not sent', () => {
    const result = buildForecast(input({
        directory: [{ id: 'desk_abel', email: abel.email }],
        logs: [log({ id: 'a', date: '2026-10-14', hours: 2 })],
    }));
    assert.equal(result.weeks[0].people[0].match.status, 'not_mapped');
    assert.equal(result.payloadBody.weeks[0].allocations.length, 0);
    assert.equal(result.warnings.some(warning => warning.kind === 'unmapped_people'), true);
});

test('a late-UTC Monday is still the previous Pacific week and is not estimated', () => {
    const result = buildForecast(input({
        selectedWeekStarts: [NEXT_WEEK],
        tasks: [task({ startDate: '2026-10-19T06:30:00.000Z', estimatedHours: 6 })],
    }));
    assert.equal(result.payloadBody.weeks[0].allocations.length, 0);
    assert.equal(result.weeks[0].people.length, 0);
});
