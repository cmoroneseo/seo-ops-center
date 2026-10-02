import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, dueDateMoveError, workOnDate, timelineWeeks } from './calendar';
import type { WorkCard } from './project';

const card = (patch: Partial<WorkCard>): WorkCard => ({ id: 'task:1', taskId: '1', source: 'task', title: 'Audit', statusLabel: 'In progress', badges: [], assignees: [], assigneeLabel: 'Unassigned', estimateLabel: '', subtasks: [], subtaskProgress: '', ...patch });

test('month grid includes every date, whole weeks, leap days and year boundaries', () => {
    for (const month of ['2026-10', '2024-02', '2026-02', '2026-12', '2027-01']) {
        const days = calendarDays(month);
        assert.equal(days.length % 7, 0);
        assert.equal(new Date(`${days[0]}T00:00:00Z`).getUTCDay(), 0);
        assert.equal(new Date(`${days.at(-1)}T00:00:00Z`).getUTCDay(), 6);
        assert.equal(new Set(days).size, days.length);
        assert.ok(days.includes(`${month}-01`));
    }
    assert.ok(calendarDays('2024-02').includes('2024-02-29'));
    assert.ok(!calendarDays('2026-02').includes('2026-02-29'));
    assert.equal(calendarDays('2026-10').length, 35);
    assert.equal(calendarDays('2026-08').length, 42);
});

test('calendar includes real task spans across month boundaries and retains completed work', () => {
    const work = [card({ startDate: '2026-09-29', dueDate: '2026-10-02' }), card({ id: 'done', title: 'Published', dueDate: '2026-10-01', statusLabel: 'Done' }), card({ id: 'undated' })];
    assert.deepEqual(workOnDate(work, '2026-10-01').map(item => item.id), ['task:1', 'done']);
    assert.equal(workOnDate(work, '2026-10-03').length, 0);
    assert.equal(workOnDate(work, '2026-09-29').length, 1);
});

test('date-only work occupies its real date and estimates never manufacture calendar duration', () => {
    const work = [card({ dueDate: '2026-10-15', estimateLabel: '8h' }), card({ id: 'start', startDate: '2026-10-16' })];
    assert.equal(workOnDate(work, '2026-10-14').length, 0);
    assert.deepEqual(workOnDate(work, '2026-10-15').map(item => item.id), ['task:1']);
    assert.deepEqual(workOnDate(work, '2026-10-16').map(item => item.id), ['start']);
});

test('dragging a due date cannot move it before the existing start date or mutate unlinked plan work', () => {
    assert.ok(dueDateMoveError(card({ startDate: '2026-10-10' }), '2026-10-09'));
    assert.equal(dueDateMoveError(card({ startDate: '2026-10-10' }), '2026-10-10'), null);
    assert.equal(dueDateMoveError(card({}), '2026-11-01'), null);
    assert.ok(dueDateMoveError(card({ source: 'plan', taskId: undefined }), '2026-10-10'));
});

test('timeline weeks align to Mondays and retain partial weeks without dropping dates', () => {
    const days = calendarDays('2026-10').filter(date => date.startsWith('2026-10'));
    const weeks = timelineWeeks(days);
    assert.deepEqual(weeks, [{ start: 0, end: 3 }, { start: 4, end: 10 }, { start: 11, end: 17 }, { start: 18, end: 24 }, { start: 25, end: 30 }]);
    assert.equal(weeks.reduce((total, week) => total + week.end - week.start + 1, 0), 31);
    assert.deepEqual(timelineWeeks([]), []);
});
