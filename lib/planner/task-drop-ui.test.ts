import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrioritiesList } from '../../components/planner/PrioritiesList.tsx';
import { TaskDrawer } from '../../components/planner/TaskDrawer.tsx';
import { EventDetailPanel } from '../../components/planner/EventDetailPanel.tsx';
import { taskToDetailItem, taskToItem } from './items.ts';
import type { Task } from '../types.ts';

// These Planner components rely on Next's automatic JSX runtime in the app.
// The direct tsx test runner preserves JSX, so expose React for server rendering.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-7',
        organizationId: 'org-1',
        title: 'Directory submissions',
        assignees: [],
        assigneeIds: ['user-1'],
        dueDate: '2026-08-24',
        startDate: '2026-09-01T16:45:00.000Z',
        scheduledMinutes: 225,
        priority: 'medium',
        status: 'in_progress',
        tags: [],
        subtasks: [],
        ...overrides,
    };
}

test('Priorities announces and marks itself as an active task drop target', () => {
    const html = renderToStaticMarkup(createElement(PrioritiesList, {
        priorities: [],
        tasks: [task()],
        onAdd: () => undefined,
        onRemove: () => undefined,
        onReorder: () => undefined,
        dropTargetActive: true,
    } as Parameters<typeof PrioritiesList>[0]));

    assert.match(html, /data-planner-task-drop-target="priorities"/);
    assert.match(html, /aria-label="Drop task to add to priorities"/);
    assert.match(html, />Drop to prioritize</);
});

test('Backlog announces and marks itself as an active task drop target', () => {
    const html = renderToStaticMarkup(createElement(TaskDrawer, {
        title: 'Backlog',
        tasks: [task({ startDate: undefined, scheduledMinutes: undefined })],
        defaultOpen: true,
        onTaskClick: () => undefined,
        onTaskDragStart: () => undefined,
        taskDropTarget: 'backlog',
        dropTargetActive: true,
    } as Parameters<typeof TaskDrawer>[0]));

    assert.match(html, /data-planner-task-drop-target="backlog"/);
    assert.match(html, /aria-label="Drop task to move to Backlog"/);
    assert.match(html, />Drop to move to Backlog</);
});

test('a scheduled task offers a non-destructive Remove from calendar action', () => {
    const scheduled = task();
    const item = taskToItem(scheduled);
    assert.ok(item);
    const html = renderToStaticMarkup(createElement(EventDetailPanel, {
        item,
        members: [],
        organizationId: 'org-1',
        userId: 'user-1',
        onClose: () => undefined,
        onChanged: () => undefined,
        onDeleted: () => undefined,
        onUnscheduleTask: async () => true,
    } as Parameters<typeof EventDetailPanel>[0]));

    assert.match(html, />Remove from calendar</);
    assert.doesNotMatch(html, />Delete task</);
});

test('an unscheduled task does not offer Remove from calendar', () => {
    const unscheduled = task({ startDate: undefined, scheduledMinutes: undefined });
    const html = renderToStaticMarkup(createElement(EventDetailPanel, {
        item: taskToDetailItem(unscheduled),
        members: [],
        organizationId: 'org-1',
        userId: 'user-1',
        onClose: () => undefined,
        onChanged: () => undefined,
        onDeleted: () => undefined,
        onUnscheduleTask: async () => true,
    } as Parameters<typeof EventDetailPanel>[0]));

    assert.doesNotMatch(html, />Remove from calendar</);
});
