import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlannerEvent, Task, TimerAttempt } from '../types';
import { groupPlannerSearchResults, searchPlannerTasks, shouldRenderTaskSession, taskSessionInput, taskSessionToItem } from './task-sessions.ts';
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

test('search groups pillar subtasks under the parent and schedules that parent', () => {
    const setup = { ...task, id: 'setup', title: 'SEO Setup', clientName: 'Floor Co Design USA', startDate: undefined };
    const keywords = { ...setup, id: 'keywords', parentTaskId: 'setup', title: 'Add keywords to Position tracking', sortOrder: 1 };
    const cookies = { ...setup, id: 'cookies', parentTaskId: 'setup', title: 'Set Up Empire Cookies', sortOrder: 4 };
    const platform = { ...setup, id: 'platform', parentTaskId: 'setup', title: 'Add Project to SEO platform', sortOrder: 5 };
    const roadmap = { ...setup, id: 'roadmap', title: 'Create SEO Roadmap', parentTaskId: undefined };
    const quiet = { ...setup, id: 'quiet', parentTaskId: 'setup', title: 'Quiet chore', clientName: 'Other Client', sortOrder: 0 };
    const catalog = [roadmap, setup, cookies, keywords, quiet, platform];

    const floor = groupPlannerSearchResults(searchPlannerTasks(catalog, 'floor'), catalog, 'floor');
    assert.deepEqual(floor.map(group => group.task.id), ['roadmap', 'setup']);
    assert.deepEqual(floor[1].children.map(child => child.id), ['keywords', 'cookies', 'platform']);
    assert.equal(floor[1].expandChildren, false);
    assert.equal(floor[0].children.length, 0);

    const empire = groupPlannerSearchResults(searchPlannerTasks(catalog, 'EMPIRE'), catalog, 'EMPIRE');
    assert.deepEqual(empire.map(group => group.task.id), ['setup']);
    assert.deepEqual(empire[0].children.map(child => child.id), ['cookies']);
    assert.equal(empire[0].expandChildren, true);
    assert.equal(
        taskSessionInput(empire[0].task, 'user-1', '2026-10-16T15:00:00.000Z', '2026-10-16T16:00:00.000Z').taskId,
        'setup',
    );

    const duplicated = groupPlannerSearchResults([cookies, cookies, setup], catalog, 'empire');
    assert.equal(duplicated.length, 1);
    assert.equal(duplicated[0].children.length, 1);

    const seo = groupPlannerSearchResults(searchPlannerTasks(catalog, 'seo'), catalog, 'seo');
    const setupGroup = seo.find(group => group.task.id === 'setup');
    assert.ok(setupGroup);
    assert.deepEqual(setupGroup.children.map(child => child.id), ['platform']);
    assert.equal(setupGroup.expandChildren, true);
});

test('a child hit promotes its parent, including a completed pillar left out of the matches', () => {
    const setup = { ...task, id: 'setup', title: 'SEO Setup', status: 'done' as const, clientName: 'Floor Co Design USA' };
    const cookies = { ...task, id: 'cookies', parentTaskId: 'setup', title: 'Set Up Empire Cookies', clientName: 'Floor Co Design USA' };
    const matches = searchPlannerTasks([setup, cookies], 'empire');
    assert.deepEqual(matches.map(item => item.id), ['cookies']);
    const groups = groupPlannerSearchResults(matches, [setup, cookies], 'empire');
    assert.equal(groups[0].task.id, 'setup');
    assert.equal(groups[0].task.status, 'done');
    assert.deepEqual(groups[0].children.map(child => child.id), ['cookies']);
    assert.equal(groups[0].expandChildren, true);
});

test('recurring successors stay top-level and a missing parent keeps the subtask draggable', () => {
    const parent = { ...task, id: 'parent', title: 'Monthly report' };
    const successor = {
        ...task,
        id: 'next',
        parentTaskId: 'parent',
        title: 'Monthly report',
        recurrence: { freq: 'monthly' as const },
    };
    const sameTitle = { ...task, id: 'copy', parentTaskId: 'parent', title: 'Monthly report' };
    const groups = groupPlannerSearchResults(
        [parent, successor, sameTitle],
        [parent, successor, sameTitle],
        'report',
    );
    assert.deepEqual(groups.map(group => group.task.id), ['parent', 'next', 'copy']);
    assert.deepEqual(groups[0].children, []);

    const orphan = { ...task, id: 'orphan', parentTaskId: 'missing', title: 'Set Up Empire Cookies' };
    const [row] = groupPlannerSearchResults([orphan, orphan], [orphan], 'empire');
    assert.equal(row.task.id, 'orphan');
    assert.equal(row.parentBreadcrumb, 'Under another task');
    assert.deepEqual(row.children, []);
    assert.equal(
        taskSessionInput(row.task, 'user-1', '2026-10-16T15:00:00.000Z', '2026-10-16T16:00:00.000Z').taskId,
        'orphan',
    );
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
