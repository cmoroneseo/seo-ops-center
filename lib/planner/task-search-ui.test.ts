import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskDrawer } from '../../components/planner/TaskDrawer.tsx';
import type { PlannerSearchGroup } from './task-sessions.ts';
import type { Task } from '../types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function task(overrides: Partial<Task>): Task {
    return {
        id: 'task',
        organizationId: 'org-1',
        title: 'Task',
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [],
        clientName: 'Floor Co Design USA',
        ...overrides,
    };
}

function render(groups: PlannerSearchGroup[]) {
    return renderToStaticMarkup(createElement(TaskDrawer, {
        title: 'Search results',
        tasks: groups.map(group => group.task),
        groups,
        defaultOpen: true,
        showStatus: true,
        onTaskClick: () => undefined,
        onTaskDragStart: () => undefined,
    }));
}

test('a client match stays collapsed under the pillar, and only the pillar drags', () => {
    const html = render([{
        task: task({ id: 'setup', title: 'SEO Setup' }),
        children: [
            task({ id: 'keywords', parentTaskId: 'setup', title: 'Add keywords to Position tracking' }),
            task({ id: 'cookies', parentTaskId: 'setup', title: 'Set Up Empire Cookies' }),
        ],
        expandChildren: false,
    }]);

    assert.match(html, /aria-expanded="false" aria-controls="planner-subtasks-setup" aria-label="Show 2 subtasks of SEO Setup"/);
    assert.match(html, />2 subtasks</);
    assert.match(html, /data-planner-draggable="true"/);
    assert.match(html, /cursor-grab/);
    assert.doesNotMatch(html, /Add keywords to Position tracking/);
    assert.doesNotMatch(html, /Set Up Empire Cookies/);
    assert.match(html, /ml-auto text-xs text-muted-foreground">1</);
});

test('a child-title hit opens under its parent and the subtask is not a drag target', () => {
    const html = render([{
        task: task({ id: 'setup', title: 'SEO Setup' }),
        children: [task({ id: 'cookies', parentTaskId: 'setup', title: 'Set Up Empire Cookies' })],
        expandChildren: true,
    }]);

    assert.match(html, /aria-expanded="true" aria-controls="planner-subtasks-setup" aria-label="Hide 1 subtask of SEO Setup"/);
    assert.match(html, /aria-label="Subtasks of SEO Setup"/);
    assert.match(html, /Subtask of SEO Setup/);
    const child = html.slice(html.indexOf('Set Up Empire Cookies') - 500, html.indexOf('Set Up Empire Cookies'));
    assert.match(child, /data-planner-draggable="false"/);
    assert.doesNotMatch(child, /cursor-grab/);
    const parent = html.slice(html.indexOf('>SEO Setup<') - 500, html.indexOf('>SEO Setup<'));
    assert.match(parent, /data-planner-draggable="true"/);
});

test('a subtask with no loaded parent stays on its own row and can still be dragged', () => {
    const html = render([{
        task: task({ id: 'orphan', parentTaskId: 'missing', title: 'Set Up Empire Cookies' }),
        children: [],
        expandChildren: false,
        parentBreadcrumb: 'Under another task',
    }]);

    assert.match(html, /Under another task/);
    assert.match(html, /Set Up Empire Cookies/);
    assert.match(html, /data-planner-draggable="true"/);
    assert.doesNotMatch(html, /Show \d+ subtask/);
});

test('a completed pillar row does not drag', () => {
    const html = render([{
        task: task({ id: 'setup', title: 'SEO Setup', status: 'done' }),
        children: [task({ id: 'cookies', parentTaskId: 'setup', title: 'Set Up Empire Cookies' })],
        expandChildren: false,
    }]);

    assert.match(html, /data-planner-draggable="false"/);
    assert.doesNotMatch(html, /cursor-grab/);
    assert.match(html, />Completed</);
});
