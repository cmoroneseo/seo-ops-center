import test from 'node:test';
import assert from 'node:assert/strict';
import { countMyOverdueTasks, filterTasks, groupMyTasks, localDateKey, myTasksSubtitle, resolveTaskFilter } from './my-tasks';
import type { Task } from '../types';

test('task filter defaults to the personal queue unless scoped to a client', () => {
    assert.equal(resolveTaskFilter(null, false), 'mine');
    assert.equal(resolveTaskFilter(null, true), 'all');
    assert.equal(resolveTaskFilter('mine', true), 'mine');
    assert.equal(resolveTaskFilter('invalid', false), 'mine');
});

test('the personal queue uses local dates and accepts current and legacy assignees', () => {
    const today = localDateKey(new Date(2026, 10, 20, 23, 59));
    assert.equal(today, '2026-11-20');
    const makeTask = (id: string, fields: Partial<Task> = {}) => ({
        id, status: 'todo', assigneeIds: ['me'], ...fields,
    } as Task);
    const tasks = [
        makeTask('undated'),
        makeTask('later', { dueDate: '2026-11-25' }),
        makeTask('overdue', { dueDate: '2026-11-19', assigneeIds: [], assignees: ['me'] }),
        makeTask('today', { dueDate: today }),
        makeTask('soon', { dueDate: '2026-11-21', status: 'in_progress' }),
        makeTask('done', { status: 'done', dueDate: today }),
        makeTask('theirs', { assigneeIds: ['someone-else'] }),
        makeTask('unassigned', { assigneeIds: [] }),
    ];
    const groups = groupMyTasks(filterTasks(tasks, 'mine', today, 'me'), today);
    assert.deepEqual(groups.upcoming.map(task => task.id), ['soon', 'later', 'undated']);
    assert.deepEqual(groups.completed.map(task => task.id), ['done']);
    assert.equal(myTasksSubtitle(groups), '1 due today · 1 overdue · 3 upcoming');
    for (const [filter, expected] of [
        ['overdue', ['overdue']], ['today', ['today']], ['in_progress', ['soon']],
        ['done', ['done']], ['unassigned', ['unassigned']], ['no_due_date', ['undated', 'theirs', 'unassigned']],
    ] as const) {
        assert.deepEqual(filterTasks(tasks, filter, today).map(task => task.id), expected);
    }
});

test('the overdue count includes only open past-due tasks assigned to the current user', () => {
    const today = '2026-11-20';
    const overdue = { status: 'todo', dueDate: '2026-11-19', assigneeIds: ['me'] } as Task;
    const tasks: Task[] = [
        overdue,
        { ...overdue, status: 'in_progress', assigneeIds: ['someone-else', 'me'] },
        { ...overdue, status: 'done' },
        { ...overdue, dueDate: today },
        { ...overdue, dueDate: '2026-11-21' },
        { ...overdue, assigneeIds: ['someone-else'] },
        { ...overdue, assigneeIds: [] },
    ];

    assert.equal(countMyOverdueTasks(tasks, today, 'me'), 2);
    assert.equal(countMyOverdueTasks(tasks, today), 0);
    assert.equal(countMyOverdueTasks(tasks, today, null), 0);
});
