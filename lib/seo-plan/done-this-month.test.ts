import test from 'node:test';
import assert from 'node:assert/strict';

import {
    completedLeavesInMonth,
    doneThisMonth,
    footerHours,
    formatFooterHours,
    logMonthKey,
    planLeafTasks,
} from './done-this-month.ts';
import type { DoneThisMonthLog } from './done-this-month.ts';
import type { StageListTask } from './stage-list.ts';

const CLIENT = 'maya';
const ZONE = 'America/Los_Angeles';
const MONTH = '2026-10';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: null,
        parentTaskId: null,
        createdAt: '2026-10-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

function log(overrides: Partial<DoneThisMonthLog> & Pick<DoneThisMonthLog, 'hours'>): DoneThisMonthLog {
    return {
        clientId: CLIENT,
        countsTowardBudget: true,
        status: 'logged',
        date: '2026-10-15',
        ...overrides,
    };
}

/**
 * SPEC §11 example, October 2026.
 * Completed leaves: Yelp, BBB, Angi, Bathroom page.
 * The citations pillar is done in October and has children, so it does not count.
 * Hours (all billable): 0.25 kickoff + 0.5 kitchen + 0.75 GBP + 0.5 citations
 * pillar + 4×0.25 citation subtasks + 0.5 blog + 1.0 bathroom = 4.5.
 */
const exampleTasks: StageListTask[] = [
    task({
        id: 'kickoff',
        title: 'Kickoff call',
        stage: 'onboarding',
        status: 'in_progress',
    }),
    task({ id: 'kitchen', title: 'Kitchen page', status: 'todo', dueDate: '2026-10-17' }),
    task({ id: 'gbp', title: 'GBP optimization', status: 'in_progress', dueDate: '2026-10-22' }),
    task({
        id: 'citations',
        title: 'Citations cleanup',
        status: 'done',
        completedAt: '2026-10-20T18:00:00.000Z',
    }),
    task({ id: 'yelp-sub', title: 'Yelp citation', parentTaskId: 'citations', status: 'todo' }),
    task({ id: 'bbb-sub', title: 'BBB citation', parentTaskId: 'citations', status: 'todo' }),
    task({ id: 'angi-sub', title: 'Angi citation', parentTaskId: 'citations', status: 'todo' }),
    task({ id: 'houzz-sub', title: 'Houzz citation', parentTaskId: 'citations', status: 'todo' }),
    task({ id: 'blog', title: 'Home addition blog', status: 'todo', dueDate: '2026-10-30' }),
    task({
        id: 'yelp',
        title: 'Yelp',
        status: 'done',
        completedAt: '2026-10-08T17:00:00.000Z',
        publishedUrl: 'https://yelp.com/biz/mayas-construction-austin',
    }),
    task({
        id: 'bbb',
        title: 'BBB',
        status: 'done',
        completedAt: '2026-10-09T17:00:00.000Z',
        publishedUrl: 'https://bbb.org/us/tx/austin/profile/mayas-construction',
    }),
    task({
        id: 'angi',
        title: 'Angi',
        status: 'done',
        completedAt: '2026-10-12T17:00:00.000Z',
        publishedUrl: 'https://angi.com/companylist/us/tx/austin/mayas-construction',
    }),
    task({
        id: 'bathroom',
        title: 'Bathroom page',
        status: 'done',
        completedAt: '2026-10-16T20:00:00.000Z',
        publishedUrl: 'https://mayasconstruction.com/bathroom-remodeling',
    }),
];

const exampleLogs: DoneThisMonthLog[] = [
    log({ hours: 0.25 }),
    log({ hours: 0.5 }),
    log({ hours: 0.75 }),
    log({ hours: 0.5 }),
    log({ hours: 0.25 }),
    log({ hours: 0.25 }),
    log({ hours: 0.25 }),
    log({ hours: 0.25 }),
    log({ hours: 0.5 }),
    log({ hours: 1 }),
];

test('SPEC §11 example: four leaves, four URLs, 4.5h billable', () => {
    const report = doneThisMonth({
        tasks: exampleTasks,
        logs: exampleLogs,
        month: MONTH,
        timeZone: ZONE,
        clientId: CLIENT,
    });
    assert.deepEqual(report.completed.map(item => item.id), ['yelp', 'bbb', 'angi', 'bathroom']);
    assert.equal(report.completedCount, 4);
    assert.equal(report.urlCount, 4);
    assert.equal(report.missingUrlCount, 0);
    assert.deepEqual(report.urls.map(item => item.id), ['yelp', 'bbb', 'angi', 'bathroom']);
    assert.equal(report.billableHours, 4.5);
    assert.equal(report.totalHours, 4.5);
    assert.equal(report.hoursTitle, '4.5h billable · 4.5h total logged (0.0h non-billable)');
    assert.equal(report.emptyCopy, null);
    assert.equal(report.monthTitle, 'October 2026');
    assert.equal(report.monthShort, 'Oct');
});

test('a pillar with children does not count, and a pillar with none does', () => {
    const lone = task({
        id: 'lone-pillar',
        title: 'Citations cleanup',
        status: 'done',
        completedAt: '2026-10-18T18:00:00.000Z',
        publishedUrl: 'https://example.com/citations',
    });
    const leaves = planLeafTasks([...exampleTasks, lone]);
    assert.equal(leaves.some(item => item.id === 'citations'), false);
    assert.equal(leaves.some(item => item.id === 'yelp-sub'), true);
    assert.equal(leaves.some(item => item.id === 'lone-pillar'), true);
    assert.equal(leaves.some(item => item.id === 'yelp'), true);

    const report = doneThisMonth({
        tasks: [...exampleTasks, lone],
        logs: [],
        month: MONTH,
        timeZone: ZONE,
    });
    assert.deepEqual(report.completed.map(item => item.id), ['yelp', 'bbb', 'angi', 'bathroom', 'lone-pillar']);
    assert.equal(report.completed.some(item => item.id === 'citations'), false);
});

test('onboarding leaves completed in the month count', () => {
    const tasks = [
        task({
            id: 'kickoff',
            title: 'Kickoff call recap',
            stage: 'onboarding',
            status: 'done',
            completedAt: '2026-10-03T16:00:00.000Z',
            publishedUrl: '   ',
        }),
        task({
            id: 'photos',
            title: 'Collect project photos',
            stage: 'onboarding',
            parentTaskId: 'kickoff',
            status: 'done',
            completedAt: '2026-10-04T16:00:00.000Z',
            publishedUrl: 'https://mayasconstruction.com/photos',
        }),
    ];
    const report = doneThisMonth({ tasks, logs: [], month: MONTH, timeZone: ZONE });
    assert.deepEqual(report.completed.map(item => item.id), ['photos']);
    assert.equal(report.urlCount, 1);
    assert.equal(report.missingUrlCount, 0);
    assert.equal(report.completedCount, 1);

    const openPillar = doneThisMonth({
        tasks: [
            task({
                id: 'kickoff',
                title: 'Kickoff',
                stage: 'onboarding',
                status: 'todo',
            }),
            task({
                id: 'recap',
                title: 'Send recap',
                stage: 'onboarding',
                status: 'done',
                completedAt: '2026-10-05T16:00:00.000Z',
            }),
        ],
        logs: [],
        month: MONTH,
        timeZone: ZONE,
    });
    assert.deepEqual(openPillar.completed.map(item => item.id), ['recap']);
    assert.equal(openPillar.missingUrlCount, 1);
    assert.equal(openPillar.urlCount, 0);
});

test('billable hours exclude non-billable logs and the running timer', () => {
    const logs = [
        ...exampleLogs,
        log({ hours: 0.5, countsTowardBudget: false, date: '2026-10-20' }),
        log({ hours: 2, status: 'in_progress', date: '2026-10-20' }),
        log({ hours: 3, status: 'needs_review', date: '2026-10-20' }),
        log({ hours: 8, date: '2026-09-30' }),
        log({ hours: 8, date: '2026-11-01' }),
        log({ hours: 4, clientId: 'other', date: '2026-10-10' }),
        log({ hours: 1, clientId: undefined, date: '2026-10-10' }),
    ];
    const hours = footerHours(logs, MONTH, ZONE, CLIENT);
    assert.equal(hours.billable, 4.5);
    assert.equal(hours.total, 5);
    const report = doneThisMonth({ tasks: exampleTasks, logs, month: MONTH, timeZone: ZONE, clientId: CLIENT });
    assert.equal(report.hoursTitle, '4.5h billable · 5.0h total logged (0.5h non-billable)');
    assert.equal(formatFooterHours(0), '0.0h');
    assert.equal(formatFooterHours(4.5), '4.5h');
});

test('month boundaries follow the org timezone', () => {
    const boundary = task({
        id: 'late',
        title: 'Late October',
        status: 'done',
        completedAt: '2026-11-01T06:30:00.000Z',
        publishedUrl: 'https://example.com/late',
    });
    const november = task({
        id: 'nov',
        title: 'November',
        status: 'done',
        completedAt: '2026-11-01T07:00:00.000Z',
    });
    const before = task({
        id: 'before',
        title: 'Still September',
        status: 'done',
        completedAt: '2026-10-01T06:59:00.000Z',
    });
    const open = task({
        id: 'open',
        title: 'Not done',
        status: 'done',
        completedAt: undefined,
    });
    const inOctober = completedLeavesInMonth([boundary, november, before, open], MONTH, ZONE);
    assert.deepEqual(inOctober.map(item => item.id), ['late']);
    assert.deepEqual(
        completedLeavesInMonth([boundary], MONTH, 'UTC').map(item => item.id),
        [],
    );
    assert.equal(logMonthKey('2026-10-31', ZONE), '2026-10');
    assert.equal(logMonthKey('2026-11-01', ZONE), '2026-11');
    assert.equal(logMonthKey('2026-11-01T06:30:00.000Z', ZONE), '2026-10');
    assert.equal(logMonthKey('2026-11-01T07:00:00.000Z', ZONE), '2026-11');
    assert.equal(logMonthKey('2026-11-01T06:30:00.000Z', 'UTC'), '2026-11');
    assert.equal(logMonthKey('2026-10-01T06:59:00.000Z', ZONE), '2026-09');

    const hours = footerHours([
        log({ hours: 1, date: '2026-11-01T06:30:00.000Z' }),
        log({ hours: 9, date: '2026-11-01T07:00:00.000Z' }),
    ], MONTH, ZONE, CLIENT);
    assert.equal(hours.billable, 1);
    assert.equal(footerHours([
        log({ hours: 1, date: '2026-11-01T06:30:00.000Z' }),
    ], MONTH, 'UTC', CLIENT).billable, 0);
});

test('nothing completed stays at zero with the empty sentence', () => {
    const report = doneThisMonth({
        tasks: [task({ id: 'open', title: 'Still open', status: 'todo' })],
        logs: [],
        month: MONTH,
        timeZone: ZONE,
        clientId: CLIENT,
    });
    assert.equal(report.completedCount, 0);
    assert.equal(report.urlCount, 0);
    assert.equal(report.billableHours, 0);
    assert.equal(report.totalHours, 0);
    assert.equal(report.emptyCopy, 'Nothing completed in October yet.');
    assert.equal(formatFooterHours(report.billableHours), '0.0h');
});
