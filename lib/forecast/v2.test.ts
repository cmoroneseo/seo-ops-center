import test from 'node:test';
import assert from 'node:assert/strict';
import { hoursStringFromMinutes } from './contract.ts';
import { parseForecastPayloadV2 } from './contract-v2.ts';
import { buildForecastV2, clockTimeInTimeZone, splitMinutesEvenly, type ForecastV2Input } from './v2.ts';
import { rowToForecastLog } from './source.ts';
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

test('logged blocks keep their minutes, clocks follow focus then planned then the event, and a second log of the same interval is not added', () => {
    const checkIn = '66666666-6666-4666-8666-666666666671';
    const focusId = '66666666-6666-4666-8666-666666666672';
    const badge = '55555555-5555-4555-8555-555555555570';
    const shadow = '55555555-5555-4555-8555-555555555571';
    const cisco = '55555555-5555-4555-8555-555555555572';
    const focusLog = '55555555-5555-4555-8555-555555555573';
    const plain = '55555555-5555-4555-8555-555555555574';
    const result = buildForecastV2(input({
        logs: [
            log({
                id: badge,
                date: '2026-10-14',
                hours: 1,
                clientId: undefined,
                clientName: undefined,
                clientDomain: undefined,
                plannerEventId: checkIn,
                description: 'Internal Check In',
            }),
            log({
                id: shadow,
                date: '2026-10-14',
                hours: 1,
                clientId: undefined,
                clientName: undefined,
                clientDomain: undefined,
                description: 'Internal Check In',
                plannedStartsAt: '2026-10-14T16:00:00.000Z',
            }),
            log({
                id: cisco,
                date: '2026-10-12',
                hours: 1.25,
                taskId: TASK,
                taskTitle: 'CISCO',
                plannedStartsAt: '2026-10-12T18:30:00.000Z',
            }),
            log({
                id: focusLog,
                date: '2026-10-14',
                hours: 1.5,
                taskId: TASK_B,
                taskTitle: 'Pre Launch',
                plannerEventId: focusId,
                plannedStartsAt: '2026-10-14T20:00:00.000Z',
            }),
            log({
                id: plain,
                date: '2026-10-14',
                hours: 0.5,
                taskId: '44444444-4444-4444-8444-444444444446',
                taskTitle: 'Notes with no clock',
            }),
        ],
        events: [
            {
                id: checkIn,
                userId: carlos.userId,
                attendeeIds: [],
                kind: 'event',
                startsAt: '2026-10-14T16:00:00.000Z',
                endsAt: '2026-10-14T17:00:00.000Z',
                allDay: false,
                title: 'Internal Check In',
            },
            {
                id: focusId,
                userId: carlos.userId,
                attendeeIds: [],
                kind: 'focus',
                startsAt: '2026-10-14T19:00:00.000Z',
                endsAt: '2026-10-14T20:30:00.000Z',
                allDay: false,
                clientId: CLIENT,
                taskId: TASK_B,
                title: 'Pre Launch',
            },
        ],
    }));

    const sent = items(result);
    const meeting = sent.find(item => item.itemKey === `event:${checkIn}:2026-10-14`);
    assert.equal(meeting?.minutes, 60);
    assert.equal(meeting?.startTime, '09:00');
    assert.equal(meeting?.bucket, 'internal');
    assert.deepEqual(meeting?.sourceIds.timeLogIds, [badge]);

    const placed = sent.find(item => item.itemKey === `task:${TASK}:2026-10-12`);
    assert.equal(placed?.minutes, 75);
    assert.equal(placed?.startTime, '11:30');

    const focus = sent.find(item => item.itemKey === `task:${TASK_B}:2026-10-14`);
    assert.equal(focus?.minutes, 90);
    assert.equal(focus?.startTime, '12:00');

    const untimed = sent.find(item => item.itemKey === 'task:44444444-4444-4444-8444-444444444446:2026-10-14');
    assert.equal(untimed?.minutes, 30);
    assert.equal(untimed?.startTime, null);
    assert.equal(sent.some(item => item.sourceIds.timeLogIds.includes(shadow)), false);
});

test('a Basecamp project on a logged block prefers that client, and no match still sends the hours', () => {
    const brief = '66666666-6666-4666-8666-666666666680';
    const logged = '55555555-5555-4555-8555-555555555580';
    const unmatchedEvent = '66666666-6666-4666-8666-666666666681';
    const unmatchedLog = '55555555-5555-4555-8555-555555555581';
    const watchName = 'Our Watch w/Tim Thompson Growth OS – Powered by the Empire Method™';
    const result = buildForecastV2(input({
        deskClients: [
            { id: 'rc_watch', name: 'Our Watch' },
            { id: 'rc_north', name: 'Northwind Plumbing' },
        ],
        seoClients: [{ id: CLIENT, name: 'Northwind Plumbing', domain: 'northwind.example' }],
        basecampProjects: [
            { id: '47923138', name: watchName, kind: 'unknown' },
            { id: '27062278', name: 'Marketing Empire Group HQ', kind: 'internal' },
        ],
        logs: [
            log({
                id: logged,
                date: '2026-10-15',
                hours: 0.5,
                clientId: undefined,
                clientName: undefined,
                clientDomain: undefined,
                plannerEventId: brief,
                description: "Tim's Channel Cleanup Brief",
                basecampProjectId: '47923138',
            }),
            log({
                id: unmatchedLog,
                date: '2026-10-15',
                hours: 1,
                clientId: undefined,
                clientName: undefined,
                clientDomain: undefined,
                plannerEventId: unmatchedEvent,
                basecampProjectId: '27062278',
            }),
        ],
        events: [
            {
                id: brief,
                userId: carlos.userId,
                attendeeIds: [],
                kind: 'event',
                startsAt: '2026-10-15T17:30:00.000Z',
                endsAt: '2026-10-15T18:00:00.000Z',
                allDay: false,
                title: "Tim's Channel Cleanup Brief",
            },
            {
                id: unmatchedEvent,
                userId: carlos.userId,
                attendeeIds: [],
                kind: 'event',
                startsAt: '2026-10-15T18:00:00.000Z',
                endsAt: '2026-10-15T19:00:00.000Z',
                allDay: false,
                title: 'HQ standup',
            },
        ],
    }));

    const sent = items(result);
    const briefItem = sent.find(item => item.title === "Tim's Channel Cleanup Brief");
    assert.equal(briefItem?.bucket, 'client');
    assert.equal(briefItem?.minutes, 30);
    assert.equal(briefItem?.startTime, '10:30');
    assert.equal(briefItem?.client?.name, 'Our Watch');
    assert.equal(briefItem?.client?.campaignDeskClientId, 'rc_watch');
    assert.equal(result.nameMatches.length, 0);

    const hq = sent.find(item => item.title === 'HQ standup');
    assert.equal(hq?.bucket, 'internal');
    assert.equal(hq?.client, null);
    assert.equal(hq?.minutes, 60);
    assert.equal(hq?.startTime, '11:00');

    const parsed = parseForecastPayloadV2({
        ...result.payloadBody,
        runId: '11111111-1111-4111-8111-111111111111',
    });
    assert.equal(parsed.version, 2);
});

test('a saved project binding uses that SEO client and its Campaign Desk link', () => {
    const eventId = '66666666-6666-4666-8666-666666666682';
    const result = buildForecastV2(input({
        clientLinks: new Map([[CLIENT, 'rc_north']]),
        basecampProjects: [{
            id: '39953917',
            name: 'CISCo Restaurant + Bar',
            kind: 'client',
            clientId: CLIENT,
            clientName: 'Cisco Restaurant',
            clientDomain: 'cisco.example',
        }],
        logs: [log({
            id: LOG_A,
            date: '2026-10-13',
            hours: 1,
            clientId: undefined,
            clientName: undefined,
            clientDomain: undefined,
            plannerEventId: eventId,
            basecampProjectId: '39953917',
        })],
        events: [{
            id: eventId,
            userId: carlos.userId,
            attendeeIds: [],
            kind: 'event',
            startsAt: '2026-10-13T19:00:00.000Z',
            endsAt: '2026-10-13T20:00:00.000Z',
            allDay: false,
            title: 'Cisco working session',
        }],
    }));
    const item = items(result)[0];
    assert.equal(item.bucket, 'client');
    assert.equal(item.client?.name, 'Cisco Restaurant');
    assert.equal(item.client?.seoOpsClientId, CLIENT);
    assert.equal(item.client?.campaignDeskClientId, 'rc_north');
    assert.equal(item.startTime, '12:00');
    assert.equal(item.minutes, 60);
});

test('version 2 still leaves a zero-minute row out of the payload', () => {
    const result = buildForecastV2(input({
        logs: [log({ id: LOG_A, date: '2026-10-14', hours: 0, taskId: TASK })],
        tasks: [task({ estimatedHours: 0 })],
    }));
    assert.equal(items(result).length, 0);
    assert.equal(JSON.stringify(result.payloadBody).includes('"minutes":0'), false);
});

const FLOOR = 'Floor Co Design USA';
const SEO_TASK = '44444444-4444-4444-8444-444444444451';
const FIX_TASK = '44444444-4444-4444-8444-444444444452';
const MON_LOG = '55555555-5555-4555-8555-555555555581';
const TUE_TIMER = '55555555-5555-4555-8555-555555555582';
const TUE_MANUAL = '55555555-5555-4555-8555-555555555583';
const OPEN_LOG = '55555555-5555-4555-8555-555555555584';

/** Week of 19 Oct 2026, America/Los_Angeles. Hours are the stored hundredths. */
function floorLog(overrides: {
    id: string;
    date: string;
    hours: string;
    task_id: string;
    task_title: string;
    status?: string;
    segments: { started_at: string; ended_at: string }[];
}): ForecastLog {
    return rowToForecastLog({
        id: overrides.id,
        user_id: carlos.userId,
        client_id: CLIENT,
        date: overrides.date,
        hours: overrides.hours,
        status: overrides.status ?? 'logged',
        import_status: 'mapped',
        voided_at: null,
        planner_event_id: null,
        planned_starts_at: null,
        task_id: overrides.task_id,
        description: overrides.task_title,
        clients: { name: FLOOR, domain: null },
        tasks: { title: overrides.task_title },
        time_log_segments: overrides.segments,
    });
}

function floorWeek(logs: ForecastLog[]) {
    return buildForecastV2(input({
        today: '2026-10-21',
        timeZone: 'America/Los_Angeles',
        selectedWeekStarts: ['2026-10-19'],
        deskClients: [{ id: 'rc_floor', name: FLOOR }],
        logs,
    }));
}

test('timer and manual logs send the segment start on the log date', () => {
    const logs = [
        floorLog({
            id: MON_LOG,
            date: '2026-10-19',
            hours: '0.76',
            task_id: SEO_TASK,
            task_title: 'SEO Setup',
            segments: [{
                started_at: '2026-10-20T06:07:34.586+00:00',
                ended_at: '2026-10-20T06:52:53.626+00:00',
            }],
        }),
        floorLog({
            id: TUE_TIMER,
            date: '2026-10-20',
            hours: '0.38',
            task_id: SEO_TASK,
            task_title: 'SEO Setup',
            segments: [{
                started_at: '2026-10-20T17:29:20.582+00:00',
                ended_at: '2026-10-20T17:52:04.027+00:00',
            }],
        }),
        floorLog({
            id: TUE_MANUAL,
            date: '2026-10-20',
            hours: '0.82',
            task_id: FIX_TASK,
            task_title: "Fix 404s on Floor Co's 323 city pages",
            segments: [{
                started_at: '2026-10-20T19:42:00+00:00',
                ended_at: '2026-10-20T20:31:00+00:00',
            }],
        }),
        floorLog({
            id: OPEN_LOG,
            date: '2026-10-20',
            hours: '0.25',
            task_id: SEO_TASK,
            task_title: 'SEO Setup',
            status: 'in_progress',
            segments: [{
                started_at: '2026-10-20T21:00:00+00:00',
                ended_at: '2026-10-20T21:15:00+00:00',
            }],
        }),
    ];
    // 23:07 PT is already the next UTC day. The item stays on the log's local date.
    assert.equal(logs[0].workedStartsAt, '2026-10-20T06:07:34.586Z');
    assert.equal(logs[0].plannedStartsAt, undefined);

    const result = floorWeek(logs);
    const sent = items(result);
    assert.equal(sent.length, 3);
    assert.equal(sent.some(item => item.sourceIds.timeLogIds.includes(OPEN_LOG)), false);

    const monday = sent.find(item => item.sourceIds.timeLogIds.includes(MON_LOG));
    assert.equal(monday?.date, '2026-10-19');
    assert.equal(monday?.startTime, '23:07');
    assert.equal(monday?.minutes, 46);
    assert.equal(monday?.hours, '0.77');
    assert.equal(monday?.title, 'SEO Setup');

    const tuesdayTimer = sent.find(item => item.sourceIds.timeLogIds.includes(TUE_TIMER));
    assert.equal(tuesdayTimer?.date, '2026-10-20');
    assert.equal(tuesdayTimer?.startTime, '10:29');
    assert.equal(tuesdayTimer?.minutes, 23);
    assert.equal(tuesdayTimer?.hours, '0.38');

    const tuesdayManual = sent.find(item => item.sourceIds.timeLogIds.includes(TUE_MANUAL));
    assert.equal(tuesdayManual?.date, '2026-10-20');
    assert.equal(tuesdayManual?.startTime, '12:42');
    assert.equal(tuesdayManual?.minutes, 49);
    assert.equal(tuesdayManual?.hours, '0.82');
    assert.equal(tuesdayManual?.title, "Fix 404s on Floor Co's 323 city pages");

    const parsed = parseForecastPayloadV2({
        ...result.payloadBody,
        runId: '11111111-1111-4111-8111-111111111111',
    });
    const days = parsed.weeks[0].people[0].days;
    assert.deepEqual(days.map(day => day.date), ['2026-10-19', '2026-10-20']);
    assert.deepEqual(Object.keys(days[0]).sort(), ['date', 'items']);
    const sentItems = days.flatMap(day => day.items);
    assert.equal(sentItems.reduce((sum, item) => sum + item.minutes, 0), 118);
    for (const item of sentItems) {
        assert.equal(item.hours, hoursStringFromMinutes(item.minutes));
    }
});

test('several segments use the earliest start, and the focus block still wins', () => {
    const focusId = '66666666-6666-4666-8666-666666666690';
    const focusTask = '44444444-4444-4444-8444-444444444453';
    const resumed = floorLog({
        id: TUE_TIMER,
        date: '2026-10-20',
        hours: '0.50',
        task_id: SEO_TASK,
        task_title: 'SEO Setup',
        segments: [
            { started_at: '2026-10-20T18:15:00.000Z', ended_at: '2026-10-20T18:30:00.000Z' },
            { started_at: '2026-10-20T17:29:20.582Z', ended_at: '2026-10-20T17:52:04.027Z' },
        ],
    });
    assert.equal(resumed.workedStartsAt, '2026-10-20T17:29:20.582Z');

    const placed = buildForecastV2(input({
        today: '2026-10-21',
        timeZone: 'America/Los_Angeles',
        selectedWeekStarts: ['2026-10-19'],
        deskClients: [{ id: 'rc_floor', name: FLOOR }],
        logs: [
            resumed,
            log({
                id: LOG_A,
                date: '2026-10-20',
                hours: 1,
                taskId: focusTask,
                taskTitle: 'Pre Launch',
                clientName: FLOOR,
                plannerEventId: focusId,
                plannedStartsAt: '2026-10-20T18:00:00.000Z',
                workedStartsAt: '2026-10-20T17:29:20.582Z',
            }),
        ],
        events: [{
            id: focusId,
            userId: carlos.userId,
            attendeeIds: [],
            kind: 'focus',
            startsAt: '2026-10-20T19:00:00.000Z',
            endsAt: '2026-10-20T20:00:00.000Z',
            allDay: false,
            clientId: CLIENT,
            taskId: focusTask,
            title: 'Pre Launch',
        }],
    }));

    const sent = items(placed);
    const setup = sent.find(item => item.sourceIds.timeLogIds.includes(TUE_TIMER));
    assert.equal(setup?.startTime, '10:29');
    assert.equal(setup?.date, '2026-10-20');

    const focus = sent.find(item => item.itemKey === `task:${focusTask}:2026-10-20`);
    assert.equal(focus?.startTime, '12:00');
    assert.equal(focus?.date, '2026-10-20');
    assert.equal(sent.length, 2);
});
