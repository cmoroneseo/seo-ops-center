import test from 'node:test';
import assert from 'node:assert/strict';
import { hoursStringFromMinutes } from './contract.ts';
import { parseForecastPayloadV2 } from './contract-v2.ts';
import { buildForecastV2, clockTimeInTimeZone, splitMinutesEvenly, type ForecastV2Input } from './v2.ts';
import type { ForecastEvent, ForecastLog, ForecastTask } from './build.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const TASK_B = '44444444-4444-4444-8444-444444444445';
const LOG_A = '55555555-5555-4555-8555-555555555555';
const LOG_B = '55555555-5555-4555-8555-555555555556';
const MEET = '66666666-6666-4666-8666-666666666666';
const INTERNAL = '66666666-6666-4666-8666-666666666667';
const GENERIC = '66666666-6666-4666-8666-666666666668';
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

function input(overrides: Partial<ForecastV2Input> = {}): ForecastV2Input {
    return {
        organizationId: ORG,
        today: TODAY,
        timeZone: 'America/Los_Angeles',
        selectedWeekStarts: [THIS_WEEK, NEXT_WEEK],
        members: [carlos, abel],
        directory: [
            { id: 'desk_carlos', email: carlos.email },
            { id: 'desk_abel', email: abel.email },
        ],
        logs: [],
        events: [],
        tasks: [],
        clientLinks: new Map(),
        deskClients: [
            { id: 'rc_north', name: 'Northwind Plumbing' },
            { id: 'rc_other', name: 'Other Co' },
        ],
        ...overrides,
    };
}

function log(overrides: Partial<ForecastLog> & { id: string; date: string }): ForecastLog {
    return {
        userId: carlos.userId,
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        clientDomain: 'northwind.example',
        hours: 1.5,
        status: 'logged',
        importStatus: 'mapped',
        ...overrides,
    };
}

function task(overrides: Partial<ForecastTask> = {}): ForecastTask {
    return {
        id: TASK,
        title: 'Write the brief',
        status: 'todo',
        assigneeIds: [abel.userId],
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        clientDomain: 'northwind.example',
        startDate: '2026-10-20T16:00:00.000Z',
        estimatedHours: 3,
        ...overrides,
    };
}

function meeting(overrides: Partial<ForecastEvent> = {}): ForecastEvent {
    return {
        id: MEET,
        userId: carlos.userId,
        attendeeIds: [],
        kind: 'meeting',
        startsAt: '2026-10-14T16:30:00.000Z',
        endsAt: '2026-10-14T17:00:00.000Z',
        allDay: false,
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        clientDomain: 'northwind.example',
        title: 'Client call',
        ...overrides,
    };
}

function items(result: ReturnType<typeof buildForecastV2>) {
    return result.payloadBody.weeks.flatMap(week =>
        week.people.flatMap(person => person.days.flatMap(day => day.items.map(item => ({
            week: week.weekStart,
            basis: week.basis,
            email: person.personEmail,
            date: day.date,
            ...item,
        })))));
}

test('an even split gives the remainder to the earliest assignee id', () => {
    assert.deepEqual(splitMinutesEvenly(100, 3), [34, 33, 33]);
    assert.deepEqual(splitMinutesEvenly(180, 2), [90, 90]);
    assert.equal(clockTimeInTimeZone('2026-10-14T16:30:00.000Z', 'America/Los_Angeles'), '09:30');
});

test('actual days are items, future estimates sit on the start date, and breaks and out of office are absent', () => {
    const result = buildForecastV2(input({
        logs: [
            log({ id: LOG_A, date: '2026-10-14', hours: 1.5, taskId: TASK, taskTitle: 'Service pages' }),
            log({ id: LOG_B, date: '2026-10-14', hours: 0.5, taskId: TASK, taskTitle: 'Service pages' }),
            log({
                id: '55555555-5555-4555-8555-555555555557',
                date: '2026-10-13',
                hours: 10 / 60,
                plannerEventId: MEET,
                description: 'should not title a meeting',
            }),
            log({
                id: '55555555-5555-4555-8555-555555555558',
                date: '2026-10-13',
                hours: 0.5,
                plannerEventId: INTERNAL,
                clientId: undefined,
                clientName: undefined,
                clientDomain: undefined,
            }),
            log({
                id: '55555555-5555-4555-8555-555555555559',
                date: '2026-10-17',
                hours: 1,
                description: 'Saturday notes',
                taskId: undefined,
                clientId: undefined,
                clientName: undefined,
                clientDomain: undefined,
            }),
            log({ id: '55555555-5555-4555-8555-555555555560', date: '2026-10-13', hours: 0.25, plannerEventId: 'break-1' }),
            log({ id: '55555555-5555-4555-8555-555555555561', date: '2026-10-13', hours: 8, plannerEventId: 'ooo-1' }),
            log({
                id: '55555555-5555-4555-8555-555555555562',
                date: '2026-10-13',
                hours: 1,
                plannerEventId: GENERIC,
                clientId: CLIENT,
            }),
        ],
        events: [
            meeting(),
            meeting({
                id: INTERNAL,
                kind: 'meeting',
                title: '1:1 – performance',
                clientId: undefined,
                clientName: undefined,
                startsAt: '2026-10-13T16:30:00.000Z',
                endsAt: '2026-10-13T17:00:00.000Z',
            }),
            {
                id: GENERIC,
                userId: carlos.userId,
                attendeeIds: [],
                kind: 'event',
                startsAt: '2026-10-13T18:00:00.000Z',
                endsAt: '2026-10-13T19:00:00.000Z',
                allDay: false,
                clientId: CLIENT,
                clientName: 'Northwind Plumbing',
                title: 'Office hours',
            },
            {
                id: 'break-1',
                userId: carlos.userId,
                attendeeIds: [],
                kind: 'break',
                startsAt: '2026-10-13T19:00:00.000Z',
                endsAt: '2026-10-13T19:15:00.000Z',
                allDay: false,
                title: 'Break',
            },
            {
                id: 'ooo-1',
                userId: carlos.userId,
                attendeeIds: [],
                kind: 'ooo',
                startsAt: '2026-10-13T15:00:00.000Z',
                endsAt: '2026-10-13T23:00:00.000Z',
                allDay: false,
                title: 'Out',
            },
            meeting({
                id: '77777777-7777-4777-8777-777777777777',
                startsAt: '2026-10-20T17:00:00.000Z',
                endsAt: '2026-10-20T18:00:00.000Z',
                userId: abel.userId,
            }),
        ],
        tasks: [
            task(),
            task({
                id: TASK_B,
                title: 'Shared estimate',
                assigneeIds: [abel.userId, carlos.userId],
                estimatedHours: 3,
                startDate: '2026-10-21T16:00:00.000Z',
            }),
        ],
    }));

    const sent = items(result);
    const keys = sent.map(item => item.itemKey);
    assert.equal(keys.includes(`task:${TASK}:2026-10-14`), true);
    const aggregated = sent.find(item => item.itemKey === `task:${TASK}:2026-10-14`);
    assert.equal(aggregated?.minutes, 120);
    assert.equal(aggregated?.hours, '2.00');
    assert.deepEqual(aggregated?.sourceIds.timeLogIds, [LOG_A, LOG_B].sort());
    assert.equal(aggregated?.client?.domain, 'northwind.example');
    assert.equal(aggregated?.client?.name, 'Northwind Plumbing');
    assert.equal(aggregated?.client?.campaignDeskClientId, 'rc_north');
    assert.equal(aggregated?.source, 'actual');

    const clientMeeting = sent.find(item => item.itemKey === `event:${MEET}:2026-10-13`);
    assert.equal(clientMeeting?.kind, 'event');
    assert.equal(clientMeeting?.bucket, 'client');
    assert.equal(clientMeeting?.title, 'Client call');
    assert.equal(clientMeeting?.minutes, 10);
    assert.equal(clientMeeting?.hours, hoursStringFromMinutes(10));
    assert.equal(clientMeeting?.hours, '0.17');
    assert.equal(clientMeeting?.startTime, '09:30');
    assert.equal(clientMeeting?.client?.seoOpsClientId, CLIENT);

    const internalMeeting = sent.find(item => item.itemKey === `event:${INTERNAL}:2026-10-13`);
    assert.equal(internalMeeting?.bucket, 'internal');
    assert.equal(internalMeeting?.client, null);
    assert.equal(internalMeeting?.title, '1:1 – performance');

    const generic = sent.find(item => item.itemKey === `event:${GENERIC}:2026-10-13`);
    assert.equal(generic?.bucket, 'internal');
    assert.equal(generic?.client, null);

    const saturday = sent.find(item => item.date === '2026-10-17');
    assert.equal(saturday?.itemKey, 'task:internal:2026-10-17');
    assert.equal(saturday?.title, 'Saturday notes');
    assert.equal(saturday?.bucket, 'internal');

    assert.equal(JSON.stringify(result.payloadBody).includes('ooo'), false);
    assert.equal(JSON.stringify(result.payloadBody).includes('Break'), false);
    assert.equal(result.breakMinutes, 15);
    assert.ok(result.oooLeftOut > 0);

    const estimate = sent.filter(item => item.source === 'estimate');
    assert.deepEqual(estimate.map(item => item.date).sort(), ['2026-10-20', '2026-10-21', '2026-10-21']);
    const shared = estimate.filter(item => item.itemKey === `task:${TASK_B}:2026-10-21`);
    assert.deepEqual(shared.map(item => item.minutes).sort(), [90, 90]);
    assert.equal(shared.every(item => item.kind === 'task' && item.startTime === '09:00'), true);
    assert.equal(estimate.find(item => item.itemKey === `task:${TASK}:2026-10-20`)?.startTime, '09:00');
    assert.equal(aggregated?.startTime, null);
    assert.equal(sent.some(item => item.itemKey.includes('77777777')), false);

    const parsed = parseForecastPayloadV2({
        ...result.payloadBody,
        runId: '11111111-1111-4111-8111-111111111111',
    });
    assert.equal(parsed.version, 2);
    assert.equal(parsed.weeks.every(week => week.people.every(person =>
        person.days.every(day => day.items.every(item => item.source === week.basis)))), true);
});

test('focus actuals and scheduled estimates keep a clock, and unscheduled work stays null', () => {
    const focusId = '66666666-6666-4666-8666-666666666669';
    const allDayFocusId = '66666666-6666-4666-8666-666666666670';
    const result = buildForecastV2(input({
        logs: [
            log({
                id: '55555555-5555-4555-8555-555555555564',
                date: '2026-10-14',
                hours: 0.5,
                taskId: TASK,
                taskTitle: 'Service pages',
            }),
            log({
                id: LOG_A,
                date: '2026-10-14',
                hours: 1.5,
                taskId: TASK,
                taskTitle: 'Service pages',
                plannerEventId: focusId,
            }),
            log({
                id: LOG_B,
                date: '2026-10-14',
                hours: 1,
                taskId: TASK_B,
                taskTitle: 'Unscheduled notes',
            }),
            log({
                id: '55555555-5555-4555-8555-555555555563',
                date: '2026-10-15',
                hours: 2,
                taskId: TASK,
                taskTitle: 'All-day focus',
                plannerEventId: allDayFocusId,
            }),
        ],
        events: [
            {
                id: focusId,
                userId: carlos.userId,
                attendeeIds: [],
                kind: 'focus',
                startsAt: '2026-10-14T16:00:00.000Z',
                endsAt: '2026-10-14T17:30:00.000Z',
                allDay: false,
                clientId: CLIENT,
                clientName: 'Northwind Plumbing',
                taskId: TASK,
                taskTitle: 'Service pages',
                title: 'Service pages',
            },
            {
                id: allDayFocusId,
                userId: carlos.userId,
                attendeeIds: [],
                kind: 'focus',
                startsAt: '2026-10-15T07:00:00.000Z',
                endsAt: '2026-10-16T07:00:00.000Z',
                allDay: true,
                taskId: TASK,
                title: 'All-day focus',
            },
        ],
        tasks: [
            task({
                title: 'Scheduled brief',
                assigneeIds: [abel.userId],
                startDate: '2026-10-20T17:30:00.000Z',
                estimatedHours: 2,
            }),
            task({
                id: TASK_B,
                title: 'Day only',
                assigneeIds: [abel.userId],
                startDate: '2026-10-21',
                estimatedHours: 1,
            }),
        ],
    }));

    const sent = items(result);
    const focus = sent.find(item => item.itemKey === `task:${TASK}:2026-10-14`);
    assert.equal(focus?.kind, 'task');
    assert.equal(focus?.source, 'actual');
    assert.equal(focus?.minutes, 120);
    assert.equal(focus?.startTime, '09:00');

    const unscheduled = sent.find(item => item.itemKey === `task:${TASK_B}:2026-10-14`);
    assert.equal(unscheduled?.kind, 'task');
    assert.equal(unscheduled?.source, 'actual');
    assert.equal(unscheduled?.startTime, null);

    const allDay = sent.find(item => item.itemKey === `task:${TASK}:2026-10-15`);
    assert.equal(allDay?.kind, 'task');
    assert.equal(allDay?.startTime, null);

    const scheduled = sent.find(item => item.itemKey === `task:${TASK}:2026-10-20`);
    assert.equal(scheduled?.kind, 'task');
    assert.equal(scheduled?.source, 'estimate');
    assert.equal(scheduled?.startTime, '10:30');

    const dayOnly = sent.find(item => item.itemKey === `task:${TASK_B}:2026-10-21`);
    assert.equal(dayOnly?.source, 'estimate');
    assert.equal(dayOnly?.startTime, null);

    const parsed = parseForecastPayloadV2({
        ...result.payloadBody,
        runId: '11111111-1111-4111-8111-111111111111',
    });
    assert.equal(parsed.weeks.flatMap(week => week.people.flatMap(person =>
        person.days.flatMap(day => day.items))).some(item => item.startTime === '09:00'), true);
});

test('a saved client id wins, and an ambiguous name stays null', () => {
    const saved = buildForecastV2(input({
        clientLinks: new Map([[CLIENT, 'rc_saved']]),
        logs: [log({ id: LOG_A, date: '2026-10-14', hours: 1, taskId: TASK, taskTitle: 'Pages' })],
    }));
    const item = items(saved)[0];
    assert.equal(item.client?.campaignDeskClientId, 'rc_saved');
    assert.equal(saved.nameMatches.length, 0);

    const ambiguous = buildForecastV2(input({
        deskClients: [
            { id: 'rc_a', name: 'Northwind Plumbing' },
            { id: 'rc_b', name: 'Northwind Plumbing' },
        ],
        logs: [log({ id: LOG_A, date: '2026-10-14', hours: 1, taskId: TASK, taskTitle: 'Pages' })],
    }));
    assert.equal(items(ambiguous)[0].client?.campaignDeskClientId, null);
    assert.equal(ambiguous.unmatchedClients, 1);
    assert.equal(ambiguous.warnings.some(warning => warning.kind === 'unmatched_clients'), true);
});

test('version 2 still leaves a zero-minute row out of the payload', () => {
    const result = buildForecastV2(input({
        logs: [log({ id: LOG_A, date: '2026-10-14', hours: 0, taskId: TASK })],
        tasks: [task({ estimatedHours: 0 })],
    }));
    assert.equal(items(result).length, 0);
    assert.equal(JSON.stringify(result.payloadBody).includes('"minutes":0'), false);
});
