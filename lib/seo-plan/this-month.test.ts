import assert from 'node:assert/strict';
import test from 'node:test';

import { groupTasksByStage, type StageListTask } from './stage-list.ts';
import {
    calendarDay,
    formatDueDay,
    isOverdueTask,
    isThisMonthTask,
    selectThisMonthTasks,
    STAGE_LIST_TIME_ZONE,
} from './this-month.ts';

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

const octoberEnd = '2026-10-31';
const novemberStart = '2026-11-01';

test('the org calendar month follows Pacific time across a UTC month boundary', () => {
    const instant = new Date('2026-11-01T02:00:00Z');
    assert.equal(calendarDay(instant, STAGE_LIST_TIME_ZONE), '2026-10-31');
    assert.equal(calendarDay(instant, 'UTC'), '2026-11-01');
    assert.equal(calendarDay(new Date('2026-11-01T08:00:00Z'), STAGE_LIST_TIME_ZONE), '2026-11-01');
});

test('this month includes the open work due in the calendar month', () => {
    const today = octoberEnd;
    const dueToday = task({ id: 'today', title: 'Due today', dueDate: '2026-10-31' });
    const later = task({ id: 'later', title: 'Later this month', dueDate: '2026-10-01', status: 'in_progress' });
    const next = task({ id: 'next', title: 'Next month', dueDate: '2026-11-01' });
    const undated = task({ id: 'none', title: 'No date' });
    const blank = task({ id: 'blank', title: 'Blank date', dueDate: '' });
    const junk = task({ id: 'junk', title: 'Bad date', dueDate: '2026-10' });
    const done = task({ id: 'done', title: 'Finished', status: 'done', dueDate: '2026-10-15' });
    const approved = task({ id: 'approved', title: 'Approved', status: 'approved', dueDate: '2026-10-20' });

    assert.equal(isThisMonthTask(dueToday, today), true);
    assert.equal(isOverdueTask(dueToday, today), false);
    assert.equal(isThisMonthTask(later, today), true);
    assert.equal(isOverdueTask(later, today), true);
    for (const hidden of [next, undated, blank, junk, done, approved]) {
        assert.equal(isThisMonthTask(hidden, today), false, hidden.id);
        assert.equal(isOverdueTask(hidden, today), false, hidden.id);
    }
    assert.deepEqual(
        selectThisMonthTasks([next, undated, done, dueToday, later, approved], today).map(item => item.id),
        ['today', 'later'],
    );
});

test('the month boundary drops the next month and keeps the last day of this one', () => {
    const lastDay = task({ id: 'last', title: 'October 31', dueDate: '2026-10-31', position: 1 });
    const firstNext = task({ id: 'first', title: 'November 1', dueDate: '2026-11-01', position: 2 });
    const review = task({ id: 'review', title: 'In review', status: 'review', dueDate: '2026-10-02', position: 3 });
    const blocked = task({ id: 'blocked', title: 'Blocked', status: 'blocked', dueDate: '2026-11-15', position: 4 });

    const before = selectThisMonthTasks([firstNext, lastDay, review, blocked], octoberEnd);
    assert.deepEqual(before.map(item => item.id), ['last', 'review']);
    assert.equal(isOverdueTask(lastDay, octoberEnd), false);
    assert.equal(isOverdueTask(review, octoberEnd), true);

    const after = selectThisMonthTasks([firstNext, lastDay, review, blocked], novemberStart);
    assert.deepEqual(after.map(item => item.id), ['first', 'last', 'review', 'blocked']);
    assert.equal(isThisMonthTask(blocked, novemberStart), true);
    assert.equal(isOverdueTask(lastDay, novemberStart), true);
    assert.equal(isOverdueTask(firstNext, novemberStart), false);
    assert.equal(isThisMonthTask(review, novemberStart), true);
});

test('overdue work from an earlier month stays in the view and is marked', () => {
    const stale = task({ id: 'stale', title: 'September', dueDate: '2026-09-30' });
    const ancient = task({ id: 'ancient', title: 'Last year', dueDate: '2025-12-31', status: 'in_progress' });
    const finished = task({ id: 'finished', title: 'Done late', status: 'done', dueDate: '2026-09-01' });
    const selected = selectThisMonthTasks([finished, ancient, stale], novemberStart);
    assert.deepEqual(selected.map(item => item.id), ['ancient', 'stale']);
    assert.equal(isOverdueTask(stale, novemberStart), true);
    assert.equal(isOverdueTask(ancient, novemberStart), true);
    assert.equal(isOverdueTask(finished, novemberStart), false);
    assert.equal(formatDueDay('2026-09-30'), 'Sep 30');
    assert.equal(formatDueDay('2026-10-01'), 'Oct 1');
});

test('a not-done subtask due this month stays under its pillar', () => {
    const pillar = task({ id: 'setup', title: 'SEO Setup', stage: 'onboarding', position: 1 });
    const due = task({
        id: 'keywords',
        title: 'Add keywords',
        parentTaskId: 'setup',
        position: 1,
        dueDate: '2026-10-31',
    });
    const later = task({
        id: 'cookies',
        title: 'Set cookies',
        parentTaskId: 'setup',
        position: 2,
        dueDate: '2026-11-02',
        status: 'done',
    });
    const overdue = task({
        id: 'robots',
        title: 'Review robots',
        parentTaskId: 'setup',
        position: 3,
        dueDate: '2026-09-15',
        status: 'blocked',
    });
    const selected = selectThisMonthTasks([pillar, later, overdue, due], octoberEnd);
    const section = groupTasksByStage(selected, '').find(item => item.stage === 'onboarding');
    assert.deepEqual(section?.groups.map(group => group.task.id), ['setup']);
    assert.deepEqual(section?.groups[0].children.map(child => child.id), ['keywords', 'robots']);
    assert.equal(isThisMonthTask(pillar, octoberEnd), false);
    assert.equal(isOverdueTask(overdue, octoberEnd), true);
    assert.equal(isOverdueTask(due, octoberEnd), false);
});

test('a done pillar still holds an overdue subtask, and a recurring row does not pull its parent', () => {
    const donePillar = task({
        id: 'setup',
        title: 'SEO Setup',
        stage: 'onboarding',
        status: 'done',
        dueDate: '2026-09-01',
        position: 1,
    });
    const child = task({
        id: 'keywords',
        title: 'Add keywords',
        stage: 'onboarding',
        parentTaskId: 'setup',
        dueDate: '2026-10-04',
        position: 1,
    });
    const successor = task({
        id: 'next-setup',
        title: 'SEO Setup',
        stage: 'onboarding',
        parentTaskId: 'setup',
        recurring: true,
        dueDate: '2026-10-20',
        position: 2,
    });
    const selected = selectThisMonthTasks([donePillar, successor, child], octoberEnd);
    const sections = groupTasksByStage(selected, '');
    const onboarding = sections.find(item => item.stage === 'onboarding');
    assert.deepEqual(onboarding?.groups.map(group => group.task.id), ['setup', 'next-setup']);
    assert.deepEqual(onboarding?.groups[0].children.map(child => child.id), ['keywords']);
    assert.equal(isThisMonthTask(donePillar, octoberEnd), false);
    assert.equal(isThisMonthTask(successor, octoberEnd), true);
});

test('an invalid today matches nothing', () => {
    const row = task({ id: 'row', title: 'Row', dueDate: '2026-10-01' });
    assert.deepEqual(selectThisMonthTasks([row], '2026-10'), []);
    assert.equal(isOverdueTask(row, ''), false);
});
