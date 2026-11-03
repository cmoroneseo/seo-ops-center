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

test('Send to Basecamp keeps the saved to-do id instead of falling back to Not in Basecamp', async () => {
    let reads = 0;
    const updates: Task[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: true, todoId: 77 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

    const readers = {
        async getClientBasecampConfig() {
            return { projectId: '202', todolistId: '44' };
        },
        async getTask() {
            reads += 1;
            // The drawer opens against a task prop that has no to-do id. The
            // reload after a successful send is what learns the id the route saved.
            return {
                task: reads === 1 ? openTask() : savedTask(),
                subtasks: [],
                loggedHours: 0,
            };
        },
        async getTaskComments() {
            return [];
        },
        async getTaskTimeLogs() {
            return [];
        },
    };

    function Host() {
        const [current, setCurrent] = useState(openTask);
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
                        updates.push(updated);
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

    act(() => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
});
