import assert from 'node:assert/strict';
import test from 'node:test';

import {
    completionDay,
    endOfPlanMonth,
    formatPlanDue,
    formatPlanHours,
    groupTasksByPlanMonth,
    isPlanDone,
    isPlanLate,
    planEmptyCopy,
    planHourRollup,
    planMonthSpan,
    planSearchMissCopy,
    shiftPlanMonth,
    type PlanSectionId,
} from './plan-sections.ts';
import type { StageListTask } from './stage-list.ts';

const TODAY = '2026-10-19';
const MONTH = '2026-10';

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: 1,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

function ids(section: PlanSectionId, month = MONTH, today = TODAY, extra: StageListTask[] = [], query = '') {
    const found = groupTasksByPlanMonth(extra, { month, today, query }).find(item => item.id === section);
    if (!found) throw new Error(section);
    return found;
}

const onboardingOpen = task({ id: 'kickoff', title: 'Kickoff call', stage: 'onboarding', position: 1, dueDate: '2026-10-14' });
const onboardingDone = task({
    id: 'photos',
    title: 'Collect photos',
    stage: 'onboarding',
    position: 2,
    status: 'done',
    completedAt: '2026-10-02T18:00:00.000Z',
});
const dueThisMonth = task({ id: 'gbp', title: 'GBP optimization', stage: 'backlog', position: 2, dueDate: '2026-10-22' });
const late = task({ id: 'kitchen', title: 'Kitchen page', stage: 'backlog', position: 1, dueDate: '2026-10-17' });
const carried = task({ id: 'stale', title: 'September citation', stage: 'backlog', position: 3, dueDate: '2026-09-30' });
const future = task({ id: 'november', title: 'November audit', stage: 'backlog', position: 4, dueDate: '2026-11-12' });
const undated = task({ id: 'someday', title: 'Someday task', stage: 'backlog', position: 5 });
const doneThisMonth = task({
    id: 'bathroom',
    title: 'Bathroom page',
    stage: 'backlog',
    position: 6,
    status: 'done',
    dueDate: '2026-10-10',
    completedAt: '2026-10-16T20:00:00.000Z',
    publishedUrl: 'https://mayasconstruction.com/bathroom-remodeling',
});
const doneEarlier = task({
    id: 'august',
    title: 'August recap',
    stage: 'backlog',
    position: 7,
    status: 'done',
    completedAt: '2026-08-20T12:00:00.000Z',
    dueDate: '2026-08-20',
});
const pillar = task({ id: 'citations', title: 'Citations cleanup', stage: 'backlog', position: 8 });
const yelp = task({
    id: 'yelp',
    title: 'Fix NAP on Yelp',
    parentTaskId: 'citations',
    position: 1,
    status: 'done',
    completedAt: '2026-10-12T15:00:00.000Z',
    publishedUrl: 'https://yelp.com/biz/mayas-construction-austin',
    dueDate: '2026-10-12',
});
const houzz = task({ id: 'houzz', title: 'Houzz profile', parentTaskId: 'citations', position: 2, dueDate: '2026-10-23' });
const laterChild = task({ id: 'apple', title: 'Apple listing', parentTaskId: 'citations', position: 3, dueDate: '2026-12-01' });

const floor = [
    onboardingOpen, onboardingDone, dueThisMonth, late, carried, future, undated,
    doneThisMonth, doneEarlier, pillar, yelp, houzz, laterChild,
];

test('the current month keeps open work due in it, late carry-over, and work completed in it', () => {
    const month = ids('this_month', MONTH, TODAY, floor);
    assert.deepEqual(month.groups.map(group => group.task.id), ['kitchen', 'gbp', 'stale', 'citations', 'bathroom']);
    assert.equal(month.title, 'This month');
    assert.equal(month.groups.at(-1)?.task.id, 'bathroom');
    assert.equal(isPlanLate(late, TODAY), true);
    assert.equal(isPlanLate(dueThisMonth, TODAY), false);
    const citations = month.groups.find(group => group.task.id === 'citations');
    assert.deepEqual(citations?.children.map(child => child.id), ['houzz', 'yelp']);
    assert.equal(citations?.hiddenChildren, 1);
    assert.deepEqual(citations?.rollupChildIds, ['yelp', 'houzz', 'apple']);
    assert.equal(citations?.childCount, 3);
    assert.equal(citations?.childDone, 1);
    assert.equal(citations?.urlCount, 1);
    assert.equal(month.meta.includes('late'), true);
    assert.equal(ids('backlog', MONTH, TODAY, floor).groups.map(group => group.task.id).includes('stale'), false);
    assert.equal(ids('this_month', MONTH, TODAY, floor).groups.some(group => group.task.id === 'august'), false);
    assert.equal(ids('this_month', MONTH, TODAY, floor).groups.some(group => group.task.id === 'november'), false);
});

test('backlog is undated work and work due after the later of the selected month and today', () => {
    const backlog = ids('backlog', MONTH, TODAY, floor);
    assert.deepEqual(backlog.groups.map(group => group.task.id), ['november', 'someday']);
    assert.equal(backlog.defaultCollapsed, true);
    assert.equal(backlog.meta, '2 · no date or due after Oct');
    assert.equal(backlog.empty, 'Backlog is empty.');
});

test('onboarding ignores the month, lists open rows first, and collapses when every row is done', () => {
    const open = ids('onboarding', MONTH, TODAY, floor);
    assert.deepEqual(open.groups.map(group => group.task.id), ['kickoff', 'photos']);
    assert.equal(open.collapsedComplete, false);
    assert.equal(open.defaultCollapsed, false);
    assert.match(open.meta, /1 open · 1 late · 1\/2 done/);

    const doneOnly = [
        task({ id: 'a', title: 'A', stage: 'onboarding', position: 2, status: 'done', completedAt: '2026-09-01T00:00:00.000Z' }),
        task({ id: 'b', title: 'B', stage: 'onboarding', position: 1, status: 'done', completedAt: '2026-09-02T00:00:00.000Z' }),
    ];
    const complete = ids('onboarding', MONTH, TODAY, doneOnly);
    assert.equal(isPlanDone('done'), true);
    assert.equal(isPlanDone('approved'), false);
    assert.equal(isPlanDone('review'), false);
    assert.equal(isPlanDone('blocked'), false);
    assert.equal(complete.collapsedComplete, true);
    assert.equal(complete.defaultCollapsed, true);
    assert.equal(complete.meta, 'Complete · 2/2');
    assert.deepEqual(complete.groups.map(group => group.task.id), ['b', 'a']);
    assert.equal(complete.empty, planEmptyCopy('onboarding', MONTH, TODAY, ''));
});

test('a past month is a look-back: completions stay, open work does not', () => {
    const september = ids('this_month', '2026-09', TODAY, floor);
    assert.equal(september.title, 'September 2026');
    assert.deepEqual(september.groups.map(group => group.task.id), []);
    assert.equal(september.empty, 'Nothing was due or completed in September.');
    const completedThen = task({
        id: 'sep-done',
        title: 'September blog',
        status: 'done',
        completedAt: '2026-09-18T12:00:00.000Z',
        position: 1,
    });
    const lookback = ids('this_month', '2026-09', TODAY, [completedThen, carried, late]);
    assert.deepEqual(lookback.groups.map(group => group.task.id), ['sep-done']);
    assert.equal(ids('backlog', '2026-09', TODAY, [future, undated, carried]).groups.map(group => group.task.id).join(), 'november,someday');
    assert.equal(ids('this_month', MONTH, TODAY, [carried]).groups[0]?.task.id, 'stale');
});

test('a future month shows what is due then, and backlog shrinks to the months after it', () => {
    const november = ids('this_month', '2026-11', TODAY, floor);
    assert.equal(november.title, 'November 2026');
    assert.deepEqual(november.groups.map(group => group.task.id), ['november']);
    assert.equal(november.groups.some(group => group.task.id === 'kitchen'), false);
    const backlog = ids('backlog', '2026-11', TODAY, floor);
    assert.deepEqual(backlog.groups.map(group => group.task.id), ['someday', 'citations']);
    assert.equal(backlog.meta, '3 · no date or due after Nov');
    const decemberChild = ids('this_month', '2026-12', TODAY, floor).groups.find(group => group.task.id === 'citations');
    assert.equal(decemberChild?.task.id, 'citations');
    assert.deepEqual(decemberChild?.children.map(child => child.id), ['apple']);
    assert.ok((decemberChild?.hiddenChildren ?? 0) >= 1);
});

test('an onboarding subtask under a backlog pillar is listed in onboarding', () => {
    const parent = task({ id: 'setup', title: 'Setup', stage: 'backlog', position: 1 });
    const child = task({ id: 'logins', title: 'Collect logins', stage: 'onboarding', parentTaskId: 'setup', position: 1 });
    const sections = groupTasksByPlanMonth([parent, child], { month: MONTH, today: TODAY });
    assert.deepEqual(sections.map(section => section.id), ['onboarding', 'this_month', 'backlog']);
    assert.deepEqual(sections[0].groups.map(group => group.task.id), ['logins']);
    assert.equal(sections[0].groups[0].parentBreadcrumb, 'Under another task');
    assert.equal(sections[2].groups.some(group => group.task.id === 'logins'), false);
});

test('search ignores the month, opens a matching subtask, and opens backlog', () => {
    const sections = groupTasksByPlanMonth(floor, { month: MONTH, today: TODAY, query: 'apple' });
    const someday = groupTasksByPlanMonth(floor, { month: MONTH, today: TODAY, query: 'someday' });
    assert.equal(someday.find(section => section.id === 'backlog')?.defaultCollapsed, false);
    const citations = sections.flatMap(section => section.groups).find(group => group.task.id === 'citations');
    assert.equal(citations?.expandChildren, true);
    assert.deepEqual(citations?.children.map(child => child.id), ['apple']);
    assert.equal(planSearchMissCopy('citations'), 'No tasks match "citations".');
    assert.equal(planEmptyCopy('this_month', MONTH, TODAY, 'citations'), 'No tasks match "citations" in October.');
    assert.equal(planEmptyCopy('backlog', MONTH, TODAY, 'citations'), 'No Backlog tasks match "citations".');
    const missed = groupTasksByPlanMonth(floor, { month: MONTH, today: TODAY, query: 'zzzz-not-a-task' });
    assert.equal(missed.every(section => section.groups.length === 0), true);
});

test('due labels, month math, and hour rollups', () => {
    assert.equal(formatPlanDue(late, TODAY).text, 'Oct 17 2d late');
    assert.equal(formatPlanDue(late, TODAY).late, true);
    assert.equal(formatPlanDue(doneThisMonth, TODAY).text, 'Done Oct 16');
    assert.equal(formatPlanDue(undated, TODAY).text, 'No date');
    assert.equal(formatPlanDue(dueThisMonth, TODAY).text, 'Oct 22');
    assert.equal(endOfPlanMonth('2026-10'), '2026-10-31');
    assert.equal(shiftPlanMonth('2026-12', 1), '2027-01');
    assert.equal(planMonthSpan('2026-10'), 'Oct 1–31');
    assert.equal(formatPlanHours(0), '0h');
    assert.equal(formatPlanHours(0.25), '15m');
    assert.equal(formatPlanHours(1.5), '1.5h');
    assert.equal(completionDay('2026-10-16T20:00:00.000Z', 'America/Los_Angeles'), '2026-10-16');
    const rollup = planHourRollup('citations', ['yelp', 'houzz'], { citations: 0.5, yelp: 0.25, houzz: 0.25 });
    assert.equal(rollup.total, 1);
    assert.equal(rollup.tooltip, '30m on pillar + 30m across subtasks');
});
