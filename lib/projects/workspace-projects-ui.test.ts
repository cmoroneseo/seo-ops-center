import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceProjects } from '@/components/projects/WorkspaceProjects';
import { createClient } from '@/lib/supabase/client';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

test('project cards appear while their task progress is still pending', async t => {
    const { window } = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://sidebar-test.invalid';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-key';
    const { promise: tasks, resolve: resolveTasks } = Promise.withResolvers<Response>();
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
        const pathname = new URL(input instanceof Request ? input.url : input).pathname;
        if (pathname === '/rest/v1/tasks') return tasks;
        if (pathname === '/rest/v1/campaign_initiatives') {
            return Response.json([{
                id: 'project', client_id: 'client', organization_id: 'org',
                title: 'City pages', state: 'planned', priority: 2,
            }]);
        }
        if (pathname === '/rest/v1/campaign_initiative_items') return Response.json([]);
        assert.fail(`Unexpected request: ${pathname}`);
    });
    createClient();
    Object.assign(globalThis, { window, document: window.document, self: window });
    const container = window.document.getElementById('root')!;
    const root = createRoot(container);
    try {
        await act(async () => root.render(createElement(WorkspaceProjects, {
            clientId: 'client', clientName: 'Client', organizationId: 'org',
            projectId: null, create: false, stageListOn: false, onCreated() {},
        })));
        assert.equal(container.querySelector('h3')?.textContent, 'City pages');
        assert.doesNotMatch(container.textContent ?? '', /tasks done/);
        await act(async () => resolveTasks(Response.json([])));
        assert.match(container.textContent ?? '', /0 of 0 tasks done/);
    } finally {
        await act(async () => root.unmount());
        window.close();
    }
});
