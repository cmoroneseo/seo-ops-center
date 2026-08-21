import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseTaskStart, taskToItem, taskBlockMinutes, overdueTaskToItem, TASK_DEFAULT_MINUTES,
    plannerSourceLabel, plannerTimeLabel, taskToDetailItem, eventToItem, reminderToItem,
} from './items.ts';
import type { PlannerEvent, Reminder, Task, TimerAttempt } from '../types';
import type { PlannerItem } from './items.ts';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 't1',
        organizationId: 'org1',
        title: 'Write blog post',
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [],
        ...overrides,
    } as Task;
}

function makeEvent(overrides: Partial<PlannerEvent> = {}): PlannerEvent {
    return {
        id: 'e1',
        organizationId: 'org1',
        userId: 'user1',
        title: 'Weekly sync',
        kind: 'event',
        startsAt: '2026-08-18T16:00:00.000Z',
        endsAt: '2026-08-18T17:00:00.000Z',
        allDay: false,
        attendeeIds: [],
        busy: true,
        visibility: 'default',
        ...overrides,
    } as PlannerEvent;
}

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
    return {
        id: 'r1',
        organizationId: 'org1',
        userId: 'user1',
        title: 'Send report',
        dueAt: '2026-08-18T16:00:00.000Z',
        status: 'pending',
        ...overrides,
    } as Reminder;
}

// --- parseTaskStart ---------------------------------------------------------

test('parseTaskStart reads a bare date as LOCAL midnight, not UTC', () => {
    const d = parseTaskStart('2026-07-30');
    assert.ok(d);
    // The whole point: the calendar day must survive in a negative-offset zone.
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 6); // July
    assert.equal(d.getDate(), 30);
    assert.equal(d.getHours(), 0);
});

test('parseTaskStart keeps the time of day from a full timestamp', () => {
    const iso = new Date(2026, 6, 30, 9, 15).toISOString();
    const d = parseTaskStart(iso);
    assert.ok(d);
    assert.equal(d.getDate(), 30);
    assert.equal(d.getHours(), 9);
    assert.equal(d.getMinutes(), 15);
});

test('parseTaskStart returns null for garbage', () => {
    assert.equal(parseTaskStart('not-a-date'), null);
});

// --- taskToItem -------------------------------------------------------------

test('taskToItem returns null for an unscheduled task (the backlog)', () => {
    assert.equal(taskToItem(makeTask()), null);
});

test('taskToItem sizes a block from estimatedHours', () => {
    const item = taskToItem(makeTask({
        startDate: new Date(2026, 6, 30, 9, 0).toISOString(),
        estimatedHours: 2,
    }));
    assert.ok(item);
    const mins = (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000;
    assert.equal(mins, 120);
});

test('taskToItem falls back to a one-hour block when estimatedHours is missing', () => {
    const item = taskToItem(makeTask({ startDate: new Date(2026, 6, 30, 9, 0).toISOString() }));
    assert.ok(item);
    const mins = (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000;
    assert.equal(mins, TASK_DEFAULT_MINUTES);
});

// --- block duration: schedule vs estimate ----------------------------------

test('taskBlockMinutes prefers scheduledMinutes over the estimate', () => {
    // A 3-hour job with only 1 hour blocked on this day.
    assert.equal(taskBlockMinutes(makeTask({ estimatedHours: 3, scheduledMinutes: 60 })), 60);
});

test('taskBlockMinutes falls back to the estimate when nothing is scheduled', () => {
    assert.equal(taskBlockMinutes(makeTask({ estimatedHours: 2 })), 120);
});

test('taskBlockMinutes falls back to one hour when neither is set', () => {
    assert.equal(taskBlockMinutes(makeTask()), TASK_DEFAULT_MINUTES);
});

test('taskBlockMinutes ignores a zero estimate rather than collapsing the card', () => {
    assert.equal(taskBlockMinutes(makeTask({ estimatedHours: 0 })), TASK_DEFAULT_MINUTES);
});

test('taskToItem sizes the block from scheduledMinutes, leaving the estimate alone', () => {
    const task = makeTask({
        startDate: new Date(2026, 6, 30, 9, 0).toISOString(),
        estimatedHours: 3,
        scheduledMinutes: 45,
    });
    const item = taskToItem(task);
    assert.ok(item);
    const mins = (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000;
    assert.equal(mins, 45);
    assert.equal(task.estimatedHours, 3); // untouched
});

// --- overdue roll-forward ---------------------------------------------------

test('overdueTaskToItem anchors the chip to today, not the original due date', () => {
    const today = new Date(2026, 6, 28);
    const item = overdueTaskToItem(makeTask({ dueDate: '2026-07-22' }), today);
    const at = new Date(item.startsAt);
    assert.equal(at.getDate(), 28);
    assert.equal(at.getMonth(), 6);
    assert.equal(item.allDay, true);
});

test('overdueTaskToItem keeps the real due date in the label', () => {
    const item = overdueTaskToItem(makeTask({ dueDate: '2026-07-22' }), new Date(2026, 6, 28));
    // The chip moved, so the title has to say when it was actually due.
    assert.match(item.title, /7\/22/);
    assert.match(item.title, /Write blog post/);
});

test('overdueTaskToItem is not draggable — moving it would imply a new due date', () => {
    assert.equal(overdueTaskToItem(makeTask({ dueDate: '2026-07-22' })).draggable, false);
});

test('taskToItem keeps a bare-date task on its own calendar day', () => {
    const item = taskToItem(makeTask({ startDate: '2026-07-30' }));
    assert.ok(item);
    assert.equal(new Date(item.startsAt).getDate(), 30);
});

// --- presentation semantics ------------------------------------------------

test('plannerSourceLabel identifies rolled-over work as an overdue task', () => {
    const item = overdueTaskToItem(
        makeTask({ dueDate: '2026-08-17' }),
        new Date(2026, 7, 18),
    );
    assert.equal(plannerSourceLabel(item), 'Overdue task');
});

test('plannerSourceLabel identifies reminders independently of event styling', () => {
    const item = reminderToItem(makeReminder());
    assert.equal(plannerSourceLabel(item), 'Reminder');
});

test('plannerSourceLabel describes task and event kinds without using card colors', () => {
    const scheduledTask = taskToItem(makeTask({ startDate: '2026-08-18T16:00:00.000Z' }));
    assert.ok(scheduledTask);
    assert.equal(plannerSourceLabel(scheduledTask), 'Task');

    const expected = [
        ['meeting', 'Meeting'],
        ['focus', 'Focus block'],
        ['ooo', 'OOO'],
        ['event', 'Event'],
        ['lunch', 'Event'],
    ] as const;
    for (const [kind, label] of expected) {
        assert.equal(plannerSourceLabel(eventToItem(makeEvent({ kind }))), label);
    }
});

test('actual work labels its source, actual range, and active duration', () => {
    const item = {
        id: 'actual:attempt-1:0',
        source: 'actual_time',
        title: 'Write launch brief',
        startsAt: '2026-08-18T16:00:00.000Z',
        endsAt: '2026-08-18T17:04:00.000Z',
        allDay: false,
        kind: 'focus',
        attendeeIds: [],
        draggable: false,
        raw: {} as TimerAttempt,
        attemptId: 'attempt-1',
        activeSeconds: 3_600,
        timerState: 'paused',
    } as PlannerItem;

    assert.equal(plannerSourceLabel(item), 'Actual work');
    assert.match(plannerTimeLabel(item), /1 hr active$/);
});

test('plannerTimeLabel displays all-day work as All day instead of midnight', () => {
    const item = reminderToItem(makeReminder({ dueAt: '2026-08-18T00:00:00.000Z' }));
    assert.equal(plannerTimeLabel(item), 'All day');
});

test('taskToDetailItem keeps an unscheduled task canonical and readable', () => {
    const task = makeTask({ id: 'unscheduled-1', title: 'Audit redirects' });
    const item = taskToDetailItem(task, new Date(2026, 7, 18));
    assert.equal(item.id, 'task:unscheduled-1');
    assert.equal(item.title, 'Audit redirects');
    assert.equal(item.raw, task);
});

test('taskToDetailItem preserves overdue source semantics for drawer selection', () => {
    const item = taskToDetailItem(
        makeTask({ dueDate: '2026-08-17' }),
        new Date(2026, 7, 18),
    );
    assert.equal(plannerSourceLabel(item), 'Overdue task');
});
