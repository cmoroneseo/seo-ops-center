import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PlanSyncDot } from '../../components/seo-plan/PlanSyncFailure.tsx';
import { StagePlanListView } from '../../components/seo-plan/StagePlanListView.tsx';
import type { StageListTask } from './stage-list.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

function task(overrides: Partial<StageListTask> & Pick<StageListTask, 'id' | 'title'>): StageListTask {
    return {
        status: 'todo',
        stage: 'backlog',
        position: null,
        parentTaskId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        category: null,
        basecamp: false,
        recurring: false,
        ...overrides,
    };
}

const tasks: StageListTask[] = [
    task({ id: 'setup', title: 'SEO Setup', stage: 'onboarding', position: 1, category: 'admin' }),
    task({
        id: 'keywords',
        title: 'Add keywords to Position tracking',
        stage: 'onboarding',
        position: 2,
        parentTaskId: 'setup',
        basecamp: true,
    }),
    task({
        id: 'cookies',
        title: 'Set Up Empire Cookies',
        stage: 'backlog',
        position: 1,
        parentTaskId: 'setup',
        basecamp: true,
        status: 'done',
    }),
    task({ id: 'roadmap', title: 'Create SEO Roadmap', stage: 'onboarding', position: 2, basecamp: true }),
    task({ id: 'robots', title: 'Review robots.txt and XML sitemap', stage: 'backlog', position: 1, category: 'technical' }),
];

function render(query = '', extraTasks: StageListTask[] = []) {
    return renderToStaticMarkup(createElement(StagePlanListView, {
        tasks: [...tasks, ...extraTasks],
        query,
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        clientName: 'Floor Co Design USA',
        today: '2026-10-19',
        initialMonth: '2026-10',
    }));
}

test('the list renders Onboarding, This month, and Backlog, including empty ones', () => {
    const html = render();
    const sections = ['onboarding', 'this_month', 'backlog'];
    let cursor = 0;
    for (const section of sections) {
        const index = html.indexOf(`data-plan-section="${section}"`, cursor);
        assert.ok(index > cursor, section);
        cursor = index + 1;
    }
    assert.doesNotMatch(html, /Month 1|Month 2|Month 3|data-stage="month_|SEO Plan sections/);
    assert.doesNotMatch(html, /emerald|text-green|#22c55e|#16a34a|Basecamp/);
    assert.doesNotMatch(html, /Floor Co Design USA/);
    assert.match(html, /data-plan-section="onboarding"[\s\S]*data-count="4"/);
    assert.match(html, /data-plan-section="this_month"[\s\S]*data-count="0"/);
    assert.match(html, /data-plan-section="backlog"[\s\S]*data-count="1"/);
    assert.match(html, /data-plan-section="backlog"[^>]*data-plan-collapsed="true"/);
    assert.match(html, /Nothing due in October\. Add a task above, or give a Backlog task a date\./);
    assert.match(html, /placeholder="Search tasks"/);
    assert.match(html, />Search tasks</);
});

test('subtasks render under the pillar and a done subtask stays folded', () => {
    const html = render();
    const children = html.slice(html.indexOf('data-stage-children="setup"'), html.indexOf('data-task-id="roadmap"'));
    assert.match(children, /data-stage-role="subtask" data-task-id="keywords"/);
    assert.match(children, /Subtask of SEO Setup/);
    assert.doesNotMatch(children, /data-task-id="cookies"/);
    assert.doesNotMatch(html, /data-stage-role="task" data-task-id="keywords"/);
    assert.match(html, />1\/2</);
    assert.doesNotMatch(html, /Pillar · 1\/2/);
    assert.match(html, /aria-expanded="true"[^>]*aria-label="Hide 2 subtasks of SEO Setup"/);
    assert.match(html, /Show 1 done/);
    assert.doesNotMatch(html, /Set Up Empire Cookies/);
});

test('a subtask-only match expands the parent and hides the other subtask', () => {
    const html = render('cookies');
    assert.match(html, /data-stage-role="task" data-task-id="setup"/);
    assert.match(html, /aria-expanded="true" aria-controls="[^"]+" aria-label="Hide 2 subtasks of SEO Setup"/);
    assert.match(html, /Set Up Empire /);
    assert.match(html, /<mark[^>]*>Cookies<\/mark>/);
    assert.doesNotMatch(html, /Add keywords to Position tracking/);
    assert.doesNotMatch(html, /Create SEO Roadmap/);
    assert.doesNotMatch(html, /Review robots\.txt/);
    assert.match(html, /No tasks match (?:&quot;|")cookies(?:&quot;|") in October\./);
    assert.match(html, /data-plan-section="backlog"[^>]*data-plan-collapsed="true"/);
});

test('a failed push shows one red dot and the popover, and a client-wide failure is one line', () => {
    const failed = task({
        id: 'robots',
        title: 'Review robots.txt and XML sitemap',
        stage: 'backlog',
        position: 1,
        category: 'technical',
        dueDate: '2026-10-22',
        basecampSync: {
            state: 'failed',
            error: 'Basecamp returned 404: the to-do list "SEO: October" no longer exists in project "Maya\'s Construction".',
            attemptedAt: '2026-10-20T18:14:00.000Z',
        },
    });
    const dot = renderToStaticMarkup(createElement(StagePlanListView, {
        tasks: [failed],
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        today: '2026-10-19',
        initialMonth: '2026-10',
        basecamp: { connected: true, failure: null },
        integrationsHref: '/workspace/client-1?tab=integrations',
    }));
    assert.match(dot, /data-plan-sync-dot="robots"/);
    assert.match(dot, /aria-label="Didn(?:'|&#x27;)t reach Basecamp"/);
    assert.match(dot, /h-\[7px\] w-\[7px\]/);
    assert.doesNotMatch(dot, /data-plan-basecamp-banner/);
    assert.doesNotMatch(dot, /auto-retries/);

    const popover = renderToStaticMarkup(createElement(PlanSyncDot, {
        taskId: 'robots',
        error: failed.basecampSync?.error ?? null,
        attemptedAt: '2026-10-20T18:14:00.000Z',
        integrationsHref: '/workspace/client-1?tab=integrations',
        defaultOpen: true,
    }));
    assert.match(popover, /Didn(?:'|&#x27;)t reach Basecamp/);
    assert.match(popover, /The last change to this task wasn(?:'|&#x27;)t pushed/);
    assert.match(popover, /SEO: October/);
    assert.match(popover, /Maya(?:'|&#x27;)s Construction/);
    assert.match(popover, />Retry</);
    assert.match(popover, /Open Integrations/);
    assert.match(popover, /href="\/workspace\/client-1\?tab=integrations"/);
    assert.match(popover, /Last try /);
    assert.doesNotMatch(popover, /auto-retries/);

    const banner = renderToStaticMarkup(createElement(StagePlanListView, {
        tasks: [failed],
        query: '',
        onQueryChange: () => undefined,
        onOpenTask: () => undefined,
        onAddTasks: async () => undefined,
        onReorder: async () => undefined,
        today: '2026-10-19',
        initialMonth: '2026-10',
        basecamp: { connected: true, failure: 'revoked' },
        integrationsHref: '/workspace/client-1?tab=integrations',
    }));
    assert.match(banner, /data-plan-basecamp-banner/);
    assert.match(banner, /Basecamp isn(?:'|&#x27;)t accepting pushes for this client/);
    assert.match(banner, /Fix in Integrations/);
    assert.doesNotMatch(banner, /data-plan-sync-dot/);
});

test('a pillar-only match stays collapsed', () => {
    const html = render('seo setup');
    assert.match(html, /aria-expanded="false" aria-controls="[^"]+" aria-label="Show 2 subtasks of SEO Setup"/);
    assert.doesNotMatch(html, /Set Up Empire Cookies/);
    assert.doesNotMatch(html, /Add keywords to Position tracking/);
    assert.match(html, /SEO Setup/);
});
