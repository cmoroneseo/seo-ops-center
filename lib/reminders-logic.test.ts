import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDueDate, notifyAtMs, groupReminders, dueLabel } from './reminders-logic.ts';
import { Reminder } from './types.ts';

function mkReminder(overrides: Partial<Reminder>): Reminder {
    return {
        id: 'r1',
        organizationId: 'org1',
        userId: 'u1',
        title: 'Test',
        dueAt: '2026-07-22T15:00:00.000Z',
        recurrence: 'none',
        status: 'pending',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

test('nextDueDate: none returns null', () => {
    assert.equal(nextDueDate('2026-07-22T15:00:00.000Z', 'none'), null);
});

test('nextDueDate: daily adds one day', () => {
    assert.equal(nextDueDate('2026-07-22T15:00:00.000Z', 'daily'), '2026-07-23T15:00:00.000Z');
});

test('nextDueDate: weekly adds seven days', () => {
    assert.equal(nextDueDate('2026-07-22T15:00:00.000Z', 'weekly'), '2026-07-29T15:00:00.000Z');
});

test('nextDueDate: monthly clamps to end of shorter month', () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year)
    assert.equal(nextDueDate('2026-01-31T09:00:00.000Z', 'monthly'), '2026-02-28T09:00:00.000Z');
});

test('notifyAtMs: offset 0 fires at due time', () => {
    assert.equal(notifyAtMs('2026-07-22T15:00:00.000Z', 0), Date.parse('2026-07-22T15:00:00.000Z'));
});

test('notifyAtMs: offset 60 fires an hour before', () => {
    assert.equal(notifyAtMs('2026-07-22T15:00:00.000Z', 60), Date.parse('2026-07-22T14:00:00.000Z'));
});

test('notifyAtMs: undefined offset means no notification', () => {
    assert.equal(notifyAtMs('2026-07-22T15:00:00.000Z', undefined), null);
});

test('groupReminders: buckets overdue, today, upcoming, done', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const overdue = mkReminder({ id: 'a', dueAt: '2026-07-21T09:00:00.000Z' });
    const today = mkReminder({ id: 'b', dueAt: '2026-07-22T18:00:00.000Z' });
    const upcoming = mkReminder({ id: 'c', dueAt: '2026-07-25T09:00:00.000Z' });
    const done = mkReminder({ id: 'd', status: 'done', dueAt: '2026-07-20T09:00:00.000Z' });
    const groups = groupReminders([upcoming, done, overdue, today], now);
    assert.deepEqual(groups.overdue.map((r) => r.id), ['a']);
    assert.deepEqual(groups.today.map((r) => r.id), ['b']);
    assert.deepEqual(groups.upcoming.map((r) => r.id), ['c']);
    assert.deepEqual(groups.done.map((r) => r.id), ['d']);
});

test('groupReminders: earlier-today but past due counts as overdue', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const r = mkReminder({ dueAt: '2026-07-22T09:00:00.000Z' });
    const groups = groupReminders([r], now);
    assert.equal(groups.overdue.length, 1);
    assert.equal(groups.today.length, 0);
});

test('groupReminders: sections sorted by due date ascending, done by completion desc', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const late = mkReminder({ id: 'late', dueAt: '2026-07-24T09:00:00.000Z' });
    const soon = mkReminder({ id: 'soon', dueAt: '2026-07-23T09:00:00.000Z' });
    const groups = groupReminders([late, soon], now);
    assert.deepEqual(groups.upcoming.map((r) => r.id), ['soon', 'late']);
});

test('dueLabel: future same-day shows relative time', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    assert.equal(dueLabel('2026-07-22T14:00:00.000Z', now), 'in 2 hrs');
});

test('dueLabel: overdue shows how long ago', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    assert.equal(dueLabel('2026-07-19T12:00:00.000Z', now), '3 days overdue');
});

test('dueLabel: future beyond a week shows date', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const label = dueLabel('2026-08-10T15:30:00.000Z', now);
    assert.match(label, /Aug 10/);
});
