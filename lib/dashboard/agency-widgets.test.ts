import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    AgencyQuickStats, GlobalDeliverablesStats, GlobalNeedsAttention, GlobalTaskProgress, GlobalUpcomingTasks,
} from '../../components/dashboard/AgencyWidgets';
import type { Task } from '../types';
import { localDateKey } from '../tasks/my-tasks';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const makeTask = (id: string, fields: Partial<Task> = {}) => ({
    id, title: id, status: 'todo', priority: 'medium', tags: [], assigneeIds: ['me'], ...fields,
} as Task);

function assertStat(html: string, href: string, count: number) {
    const link = html.split(`href="${href}"`)[1]?.split('</a>')[0] ?? '';
    assert.ok(link, href);
    assert.ok(link.includes(`>${count}</span>`), `${href} should show ${count}`);
}

test('dashboard links show live counts and link to matching task filters', () => {
    const tasks = [
        makeTask('overdue', { dueDate: '2000-01-01' }),
        makeTask('finished', { dueDate: '2000-01-01', status: 'done' }),
        makeTask('today', { dueDate: localDateKey(), status: 'in_progress' }),
        makeTask('unassigned', { assigneeIds: [] }),
    ];
    const progress = renderToStaticMarkup(createElement(GlobalTaskProgress, { tasks }));
    assertStat(progress, '/tasks?filter=todo', 2);
    assertStat(progress, '/tasks?filter=in_progress', 1);
    assertStat(progress, '/tasks?filter=done', 1);
    assertStat(progress, '/tasks?filter=overdue', 1);
    const attention = renderToStaticMarkup(createElement(GlobalNeedsAttention, { tasks }));
    assertStat(attention, '/tasks?filter=unassigned', 1);
    assertStat(attention, '/tasks?filter=no_due_date', 1);
    const stats = renderToStaticMarkup(createElement(AgencyQuickStats, { tasks, teamMemberCount: 3 }));
    assertStat(stats, '/tasks?filter=overdue', 1);
    assertStat(stats, '/tasks?filter=today', 1);
    assertStat(stats, '/settings', 3);
    assertStat(renderToStaticMarkup(createElement(AgencyQuickStats, { tasks: [] })), '/settings', 0);
    assert.match(renderToStaticMarkup(createElement(GlobalDeliverablesStats, { tasks })), /href="\/deliverables"/);
});

test('upcoming tasks link only to the current user’s open tasks, undated last', () => {
    const tasks = [
        makeTask('no-date'),
        makeTask('later', { dueDate: '2030-03-02', assigneeIds: [], assignees: ['me'] }),
        makeTask('soon/1', { dueDate: '2030-03-01' }),
        makeTask('other', { assigneeIds: ['other'] }),
        makeTask('closed', { status: 'done' }),
    ];
    const html = renderToStaticMarkup(createElement(GlobalUpcomingTasks, { tasks, currentUserId: 'me' }));
    assert.match(html, /href="\/tasks\?filter=mine"/);
    assert.deepEqual([...html.matchAll(/href="\/tasks\?task=([^"]+)"/g)].map(match => match[1]), [
        'soon%2F1', 'later', 'no-date',
    ]);
});
