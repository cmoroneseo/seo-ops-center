import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForecastPayloadV2 } from './contract-v2.ts';
import { buildForecastV2, type ForecastV2Input } from './v2.ts';
import type { ForecastEvent, ForecastLog, ForecastTask } from './build.ts';

const ORG = '22222222-2222-4222-8222-222222222222';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const LATER = '44444444-4444-4444-8444-444444444446';
const PAST_TASK = '44444444-4444-4444-8444-444444444447';
const NEXT_TASK = '44444444-4444-4444-8444-444444444448';
const LOG = '55555555-5555-4555-8555-555555555555';
const FOCUS = '66666666-6666-4666-8666-666666666671';
const LOGGED_FOCUS = '66666666-6666-4666-8666-666666666672';
const FUTURE_FOCUS = '66666666-6666-4666-8666-666666666673';

/**
 * Wednesday 14 Oct 2026, 11:00 in Los Angeles.
 * 09:00 that morning has passed. 15:00 is still ahead.
 */
const NOW = '2026-10-14T18:00:00.000Z';
const TODAY = '2026-10-14';

function input(overrides: Partial<ForecastV2Input> = {}): ForecastV2Input {
    return {
        organizationId: ORG,
        today: TODAY,
        now: NOW,
        timeZone: 'America/Los_Angeles',
        selectedWeekStarts: ['2026-10-05', '2026-10-12', '2026-10-19'],
        members: [{
            userId: 'user-carlos',
            displayName: 'Carlos Morones',
            email: 'cmorones@marketingempiregroup.com',
        }],
        directory: [{ id: 'desk_carlos', email: 'cmorones@marketingempiregroup.com' }],
        logs: [],
        events: [],
        tasks: [],
        clientLinks: new Map([[CLIENT, 'rc_north']]),
        deskClients: [{ id: 'rc_north', name: 'Northwind Plumbing' }],
        ...overrides,
    };
}

function log(overrides: Partial<ForecastLog> & { id: string; date: string }): ForecastLog {
    return {
        userId: 'user-carlos',
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        clientDomain: 'northwind.example',
        hours: 0.5,
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
        assigneeIds: ['user-carlos'],
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        clientDomain: 'northwind.example',
        startDate: '2026-10-14T22:00:00.000Z',
        estimatedHours: 2,
        ...overrides,
    };
}

function focus(overrides: Partial<ForecastEvent> = {}): ForecastEvent {
    return {
        id: FOCUS,
        userId: 'user-carlos',
        attendeeIds: [],
        kind: 'focus',
        startsAt: '2026-10-14T22:00:00.000Z',
        endsAt: '2026-10-14T23:30:00.000Z',
        allDay: false,
        clientId: CLIENT,
        clientName: 'Northwind Plumbing',
        clientDomain: 'northwind.example',
        title: 'Brief block',
        ...overrides,
    };
}

function sentItems(result: ReturnType<typeof buildForecastV2>) {
    return result.payloadBody.weeks.flatMap(week => week.people.flatMap(person =>
        person.days.flatMap(day => day.items.map(item => ({
            week: week.weekStart,
            basis: week.basis,
            date: day.date,
            ...item,
        })))));
}

test('the current week keeps logged time and adds work that is still ahead', () => {
    const result = buildForecastV2(input({
        logs: [
            log({ id: LOG, date: '2026-10-12', hours: 1, taskId: TASK, taskTitle: 'Monday pages' }),
            log({ id: '55555555-5555-4555-8555-555555555556', date: '2026-10-07', hours: 1, description: 'Last week' }),
        ],
        tasks: [
            task({ id: LATER, title: 'Later today', startDate: '2026-10-14T22:00:00.000Z', estimatedHours: 2 }),
            task({ id: TASK, title: 'Already passed', startDate: '2026-10-14T16:00:00.000Z', estimatedHours: 1 }),
            task({ id: '44444444-4444-4444-8444-444444444449', title: 'Thursday', startDate: '2026-10-15T17:00:00.000Z', estimatedHours: 1 }),
            task({ id: PAST_TASK, title: 'Last Thursday', startDate: '2026-10-08T17:00:00.000Z', estimatedHours: 4 }),
            task({ id: NEXT_TASK, title: 'Next Tuesday', startDate: '2026-10-20T16:00:00.000Z', estimatedHours: 3 }),
        ],
        events: [
            focus(),
            focus({
                id: FUTURE_FOCUS,
                startsAt: '2026-10-21T18:00:00.000Z',
                endsAt: '2026-10-21T19:00:00.000Z',
                title: 'Next week focus',
            }),
        ],
    }));

    const items = sentItems(result);
    const current = result.payloadBody.weeks.find(week => week.weekStart === '2026-10-12');
    assert.equal(current?.basis, 'actual');
    const monday = items.find(item => item.date === '2026-10-12');
    assert.equal(monday?.source, 'actual');
    assert.equal(monday?.minutes, 60);

    const later = items.find(item => item.itemKey === `task:${LATER}:2026-10-14`);
    assert.equal(later?.source, 'estimate');
    assert.equal(later?.minutes, 120);
    assert.equal(later?.startTime, '15:00');
    assert.equal(items.some(item => item.itemKey === `task:${TASK}:2026-10-14`), false);

    const thursday = items.find(item => item.itemKey.includes('444444444449'));
    assert.equal(thursday?.date, '2026-10-15');
    assert.equal(thursday?.source, 'estimate');
    assert.equal(thursday?.startTime, '10:00');

    const block = items.find(item => item.itemKey === `event:${FOCUS}:2026-10-14`);
    assert.equal(block?.source, 'estimate');
    assert.equal(block?.minutes, 90);
    assert.equal(block?.startTime, '15:00');
    assert.equal(block?.kind, 'event');

    const past = items.filter(item => item.week === '2026-10-05');
    assert.equal(past.length, 1);
    assert.equal(past[0]?.source, 'actual');
    assert.equal(past[0]?.minutes, 60);
    assert.equal(past.some(item => item.itemKey.includes(PAST_TASK)), false);

    const next = items.filter(item => item.week === '2026-10-19');
    assert.equal(next.length, 1);
    assert.equal(next[0]?.itemKey, `task:${NEXT_TASK}:2026-10-20`);
    assert.equal(next[0]?.source, 'estimate');
    assert.equal(next[0]?.minutes, 180);
    assert.equal(items.some(item => item.itemKey.includes(FUTURE_FOCUS)), false);

    const replay = buildForecastV2(input({
        logs: [
            log({ id: LOG, date: '2026-10-12', hours: 1, taskId: TASK, taskTitle: 'Monday pages' }),
            log({ id: '55555555-5555-4555-8555-555555555556', date: '2026-10-07', hours: 1, description: 'Last week' }),
        ],
        tasks: [
            task({ id: LATER, title: 'Later today', startDate: '2026-10-14T22:00:00.000Z', estimatedHours: 2 }),
            task({ id: TASK, title: 'Already passed', startDate: '2026-10-14T16:00:00.000Z', estimatedHours: 1 }),
            task({ id: '44444444-4444-4444-8444-444444444449', title: 'Thursday', startDate: '2026-10-15T17:00:00.000Z', estimatedHours: 1 }),
            task({ id: PAST_TASK, title: 'Last Thursday', startDate: '2026-10-08T17:00:00.000Z', estimatedHours: 4 }),
            task({ id: NEXT_TASK, title: 'Next Tuesday', startDate: '2026-10-20T16:00:00.000Z', estimatedHours: 3 }),
        ],
        events: [
            focus(),
            focus({
                id: FUTURE_FOCUS,
                startsAt: '2026-10-21T18:00:00.000Z',
                endsAt: '2026-10-21T19:00:00.000Z',
                title: 'Next week focus',
            }),
        ],
    }));
    assert.deepEqual(result.payloadBody, replay.payloadBody);
    parseForecastPayloadV2({ ...result.payloadBody, runId: '11111111-1111-4111-8111-111111111111' });
});

test('a logged plan is not sent again, and a past week stays logged only', () => {
    const result = buildForecastV2(input({
        logs: [
            log({
                id: LOG,
                date: '2026-10-14',
                hours: 0.5,
                taskId: TASK,
                taskTitle: 'Write the brief',
                plannerEventId: LOGGED_FOCUS,
            }),
        ],
        events: [
            focus({ id: LOGGED_FOCUS, taskId: TASK, title: 'Write the brief' }),
            focus(),
        ],
        tasks: [
            task({ estimatedHours: 3 }),
            task({ id: LATER, title: 'Open block', startDate: '2026-10-16T18:00:00.000Z', estimatedHours: 1 }),
        ],
    }));
    const items = sentItems(result);
    const logged = items.find(item => item.date === '2026-10-14' && item.source === 'actual');
    assert.equal(logged?.minutes, 30);
    assert.equal(items.filter(item => item.itemKey.includes(TASK) && item.source === 'estimate').length, 0);
    assert.equal(items.some(item => item.itemKey === `event:${LOGGED_FOCUS}:2026-10-14`), false);
    const open = items.find(item => item.itemKey === `event:${FOCUS}:2026-10-14`);
    assert.equal(open?.minutes, 90);
    assert.equal(open?.source, 'estimate');
    const friday = items.find(item => item.itemKey === `task:${LATER}:2026-10-16`);
    assert.equal(friday?.source, 'estimate');
    assert.equal(friday?.minutes, 60);

    const parsed = parseForecastPayloadV2({
        ...result.payloadBody,
        runId: '11111111-1111-4111-8111-111111111111',
    });
    const week = parsed.weeks.find(entry => entry.weekStart === '2026-10-12');
    assert.equal(week?.basis, 'actual');
    const sources = week?.people.flatMap(person => person.days.flatMap(day => day.items.map(item => item.source))) ?? [];
    assert.equal(sources.includes('actual'), true);
    assert.equal(sources.includes('estimate'), true);
});
