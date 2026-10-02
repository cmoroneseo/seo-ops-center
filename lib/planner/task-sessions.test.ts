import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerEvent, Task, TimerAttempt } from '../types';
import { searchPlannerTasks, shouldRenderTaskSession, taskSessionInput, taskSessionToItem } from './task-sessions.ts';
import { taskToItem, plannerSourceLabel } from './items.ts';
import { shouldRenderForecast } from './actual-items.ts';
import { taskBlockLogInput } from './task-block-log.ts';

const task: Task = {
    id: 'task-1', organizationId: 'org-1', clientId: 'client-1', clientName: 'Kentia Hospitality',
    title: 'Build SEO Roadmap', status: 'in_progress', assignees: [], assigneeIds: ['someone-else'],
    priority: 'medium', tags: [], subtasks: [],
    startDate: '2026-09-30T17:00:00.000Z', scheduledMinutes: 60,
};
const event: PlannerEvent = {
    ...taskSessionInput(task, 'user-1', '2026-10-02T17:00:00.000Z', '2026-10-02T18:00:00.000Z'),
    id: 'session-1', allDay: false, attendeeIds: [], busy: true, visibility: 'default', createdAt: '', updatedAt: '',
};

test('search finds previously scheduled work across client and task words regardless of assignment or due date', () => {
    assert.deepEqual(searchPlannerTasks([task], '  KENTIA roadmap  '), [task]);
    assert.deepEqual(searchPlannerTasks([task], 'not found'), []);
});

test('search includes subtasks, deduplicates tasks, and explicitly opts into completed work', () => {
    const subtask = { ...task, id: 'child', parentTaskId: task.id, title: 'Roadmap research' };
    const done = { ...task, id: 'done', status: 'done' as const };
    assert.deepEqual(searchPlannerTasks([task, task, subtask, done], 'roadmap').map(t => t.id), ['task-1', 'child']);
    assert.deepEqual(searchPlannerTasks([done], 'kentia', true), [done]);
});

test('two sidebar drops create independent session inputs without overwriting the original schedule', () => {
    const before = structuredClone(task);
    const next = taskSessionInput(task, 'user-1', '2026-10-03T17:00:00.000Z', '2026-10-03T17:30:00.000Z');
    assert.equal(next.taskId, task.id);
    assert.equal(next.kind, 'focus');
    assert.notEqual(next.startsAt, event.startsAt);
    assert.deepEqual(task, before);
    assert.equal('startDate' in next, false);
    const original = taskToItem(task)!;
    const session = taskSessionToItem(event, task, 'user-1');
    assert.notEqual(session.id, original.id);
    assert.equal(session.startsAt, event.startsAt);
    assert.equal(original.startsAt, before.startDate);
    assert.equal(plannerSourceLabel(session), 'Task session');
    assert.equal((session.raw as Task).id, task.id);
});

test('only the session owner can move its block', () => {
    assert.equal(taskSessionToItem(event, task, 'user-1').draggable, true);
    assert.equal(taskSessionToItem(event, task, 'someone-else').draggable, false);
});

test('tracked time consumes only its own session even when another block has the same schedule', () => {
    const attempt = {
        taskId: task.id, plannerEventId: event.id, status: 'logged', plannedStartsAt: task.startDate, plannedMinutes: 60,
    } as TimerAttempt;
    assert.equal(shouldRenderTaskSession(event, [attempt]), false);
    assert.equal(shouldRenderTaskSession({ ...event, id: 'session-2' }, [attempt]), true);
    assert.equal(shouldRenderForecast(task, [attempt]), true);
    assert.equal(shouldRenderTaskSession(event, []), true, 'discarding deletes the attempt, restoring its planned session');
});

test('manual time logging carries both task and session identities, without completing the task', () => {
    const input = taskBlockLogInput({
        organizationId: task.organizationId, userId: 'user-1', taskId: task.id, clientId: task.clientId!,
        taskTitle: task.title, date: '2026-10-02', plannedStartsAt: event.startsAt, plannedMinutes: 60, plannerEventId: event.id,
    }, { minutes: 45, note: 'Continued roadmap', countsTowardBudget: true });
    assert.equal(input.taskId, task.id);
    assert.equal(input.plannerEventId, event.id);
    assert.equal(input.hours, 0.75);
    assert.equal('status' in input, false);
});
