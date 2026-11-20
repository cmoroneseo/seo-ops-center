import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { TaskDetailModal } from '../../components/tasks/TaskDetailModal.tsx';
import { OrganizationContext } from '../../components/providers/organization-provider.tsx';
import { TimerContext } from '../../components/providers/timer-provider.tsx';
import type { Organization, Task } from '../types.ts';

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const elementPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
elementPrototype.attachEvent ??= () => undefined;
elementPrototype.detachEvent ??= () => undefined;

const organization: Organization = {
    id: 'org-1',
    name: 'Demo Agency',
    slug: 'demo',
    subscriptionStatus: 'active',
    planType: 'starter',
    createdAt: '2026-10-01T00:00:00.000Z',
};

function openTask(): Task {
    return {
        id: 'task-1',
        organizationId: 'org-1',
        clientId: 'client-1',
        clientName: 'Ecoworkz',
        title: 'Write the brief',
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [],
    };
}

function savedTask(): Task {
    return {
        ...openTask(),
        basecampTodoId: '77',
        basecampProjectId: '202',
        lastSyncedAt: '2026-11-03T01:00:00.000Z',
        subtasks: [],
        subtasksState: 'ready',
    };
}

const timerValue = {
    runningTimer: null,
    pausedTimers: [],
    getElapsedSeconds: () => 0,
    startTask: async () => false,
    pause: async () => undefined,
    resume: async () => false,
    switchToTask: async () => false,
    beginStop: async () => null,
    finalize: async () => ({ running: null, paused: [] }),
    discard: async () => undefined,
    addNote: async () => undefined,
    editNote: async () => undefined,
    deleteNote: async () => undefined,
    getAttemptById: () => null,
};

function textIncludes(container: ParentNode, text: string): boolean {
    return [...container.querySelectorAll('span, button')].some(node => node.textContent?.includes(text));
}

async function mountDrawer(
    initialTask: Task,
    readTask: () => { task: Task; subtasks: Task[]; loggedHours: number },
    onUpdate?: (task: Task) => void,
) {
    const readers = {
        async getClientBasecampConfig() {
            return { projectId: '202', todolistId: '44' };
        },
        async getTask() {
            return readTask();
        },
        async getTaskComments() {
            return [];
        },
        async getTaskTimeLogs() {
            return [];
        },
    };

    function Host() {
        const [current, setCurrent] = useState(initialTask);
        return createElement(
            OrganizationContext.Provider,
            {
                value: {
                    organization,
                    memberships: [],
                    isLoading: false,
                    setOrganization: () => undefined,
                },
            },
            createElement(
                TimerContext.Provider,
                { value: timerValue },
                createElement(TaskDetailModal, {
                    task: current,
                    isOpen: true,
                    onClose: () => undefined,
                    taskReaders: readers,
                    onUpdate: updated => {
                        onUpdate?.(updated);
                        setCurrent(updated);
                    },
                }),
            ),
        );
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(Host));
    });
    await act(async () => {
        await Promise.resolve();
    });
    return {
        container,
        close() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

test('Send to Basecamp keeps the saved to-do id instead of falling back to Not in Basecamp', async t => {
    let reads = 0;
    const updates: Task[] = [];
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async (_input, init) => Response.json(init?.method === 'POST'
        ? { success: true, todoId: 77 }
        : { canRefresh: true });

    const { container, close } = await mountDrawer(openTask(), () => ({
        task: ++reads === 1 ? openTask() : savedTask(),
        subtasks: [],
        loggedHours: 0,
    }), updated => updates.push(updated));
    t.after(close);

    assert.equal(textIncludes(container, 'Not in Basecamp'), true);
    const button = [...container.querySelectorAll('button')].find(item => item.textContent?.includes('Send to Basecamp'));
    assert.ok(button);

    await act(async () => {
        button.click();
        await Promise.resolve();
        await Promise.resolve();
    });

    assert.equal(textIncludes(container, 'Not in Basecamp'), false);
    assert.equal(textIncludes(container, 'Sending'), false);
    const last = updates.at(-1);
    assert.equal(last?.basecampTodoId, 77);
    assert.equal(last?.basecampProjectId, 202);
});

test('the drawer refreshes subtasks and reports the number imported', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    let posts = 0;
    let subtasks: Task[] = [];
    globalThis.fetch = async (input, init) => {
        if (init?.method !== 'POST') {
            assert.equal(input, '/api/integrations/basecamp/refresh-steps?taskId=task-1');
            return Response.json({ canRefresh: true });
        }
        assert.equal(input, '/api/integrations/basecamp/refresh-steps');
        assert.deepEqual(JSON.parse(String(init.body)), { taskId: 'task-1' });
        posts += 1;
        subtasks = [{ ...openTask(), id: 'step-1', parentTaskId: 'task-1', title: 'New Basecamp step' }];
        return Response.json({ todoId: '77', projectId: '202', imported: posts === 1 ? 1 : 0, linked: 0 });
    };
    const { container, close } = await mountDrawer(savedTask(), () => ({
        task: savedTask(), subtasks, loggedHours: 0,
    }));
    t.after(close);

    const refresh = [...container.querySelectorAll('button')].find(item => item.textContent?.includes('Refresh steps from Basecamp'));
    assert.ok(refresh);
    await act(async () => refresh.click());
    assert.match(container.querySelector('[role=status]')?.textContent ?? '', /Imported 1 new step/);
    assert.ok(container.textContent?.includes('New Basecamp step'));
    await act(async () => refresh.click());
    assert.equal(container.querySelector('[role=status]')?.textContent, 'Steps are up to date.');
});

test('the drawer keeps the pasted to-do on a link error and can retry successfully', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    const url = 'https://3.basecamp.com/10/buckets/202/todos/77';
    let posts = 0;
    globalThis.fetch = async (input, init) => {
        if (input !== '/api/integrations/basecamp/link') return Response.json([]);
        assert.deepEqual(JSON.parse(String(init?.body)), { taskId: 'task-1', basecampTodoId: url });
        posts += 1;
        return posts === 1
            ? Response.json({ error: 'This to-do already has a conflicting link.' }, { status: 409 })
            : Response.json({ todoId: '77', projectId: '202', imported: 0, linked: 0 });
    };
    const { container, close } = await mountDrawer(openTask(), () => ({
        task: posts > 1 ? savedTask() : openTask(), subtasks: [], loggedHours: 0,
    }));
    t.after(close);
    const link = [...container.querySelectorAll('button')].find(item => item.textContent?.includes('Link existing Basecamp to-do'));
    assert.ok(link);
    await act(async () => link.click());
    const basecamp = link.closest('section');
    assert.ok(basecamp);
    const field = basecamp.querySelector<HTMLInputElement>('form input');
    assert.ok(field);
    field.value = url;
    const submit = field.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
    assert.ok(submit);
    await act(async () => submit.click());
    assert.equal(posts, 1);
    assert.equal(basecamp.querySelector('[role=alert]')?.textContent, 'This to-do already has a conflicting link.');
    assert.equal(field.value, url);
    await act(async () => submit.click());
    assert.equal(basecamp.querySelector('[role=status]')?.textContent, 'Basecamp to-do linked. Steps are up to date.');
    assert.equal(textIncludes(container, 'Refresh steps from Basecamp'), true);
});

test('the drawer omits refresh for a step even when it has no local parent', async t => {
    const originalFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async () => Response.json({ canRefresh: false });
    const { container, close } = await mountDrawer(savedTask(), () => ({
        task: savedTask(), subtasks: [], loggedHours: 0,
    }));
    t.after(close);
    assert.equal(textIncludes(container, 'Refresh steps from Basecamp'), false);
    assert.equal(textIncludes(container, 'Link existing Basecamp to-do'), false);
});
