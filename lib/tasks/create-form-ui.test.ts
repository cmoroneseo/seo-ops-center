import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { CreateTaskModal } from '../../components/tasks/CreateTaskModal.tsx';
import { TimeLogModal } from '../../components/workspace/TimeLogModal.tsx';
import { TaskDetailModal } from '../../components/tasks/TaskDetailModal.tsx';
import { OrganizationContext } from '../../components/providers/organization-provider.tsx';
import { TimerContext } from '../../components/providers/timer-provider.tsx';
import type { ClientProject, Organization, Task, TaskInsert } from '../types.ts';

// CI provides public Supabase credentials. These forms look up the signed-in
// user and the client's Basecamp flags, and a live client keeps the process open.
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

function setValue(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
    const prototype = element instanceof dom.window.HTMLTextAreaElement
        ? dom.window.HTMLTextAreaElement.prototype
        : element instanceof dom.window.HTMLSelectElement
            ? dom.window.HTMLSelectElement.prototype
            : dom.window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    element.focus();
    setter?.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    element.dispatchEvent(new dom.window.KeyboardEvent('keyup', { bubbles: true }));
}

function switchNamed(container: ParentNode, label: string): HTMLInputElement {
    const found = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(label));
    const input = found?.querySelector('input');
    assert.ok(input instanceof HTMLInputElement, label);
    return input;
}

const organization: Organization = {
    id: 'org-1',
    name: 'Demo Agency',
    slug: 'demo',
    subscriptionStatus: 'active',
    planType: 'starter',
    createdAt: '2026-10-01T00:00:00.000Z',
};

function task(): Task {
    return {
        id: 'task-1',
        organizationId: 'org-1',
        clientId: 'client-1',
        clientName: 'Maya',
        title: 'Submit sitemap',
        assignees: [],
        priority: 'medium',
        status: 'todo',
        tags: [],
        subtasks: [],
    };
}

test('a new task defaults to backlog and saves the stage that was chosen', async () => {
    const created: TaskInsert[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(CreateTaskModal, {
            isOpen: true,
            onClose: () => undefined,
            onCreated: () => undefined,
            organizationId: 'org-1',
            createTask: async (draft) => {
                created.push(draft);
                return { success: false, error: 'stopped' };
            },
        }));
    });

    const stage = container.querySelector<HTMLSelectElement>('#create-task-stage');
    assert.equal(stage?.value, 'backlog');
    const title = container.querySelector<HTMLInputElement>('input[placeholder="Task title…"]');
    assert.ok(title);
    await act(async () => {
        setValue(title, 'Write the brief');
        setValue(stage!, 'onboarding');
    });
    await act(async () => {
        container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    assert.equal(created[0]?.title, 'Write the brief');
    assert.equal(created[0]?.stage, 'onboarding');

    act(() => root.unmount());
    container.remove();
});

test('manual log forms default billable and SEO hours on, and save the toggles', async () => {
    const saved: Array<{ billable?: boolean; countsTowardBudget?: boolean; syncToBasecamp?: boolean }> = [];
    const saveTimeLog = async (
        log: { billable?: boolean; countsTowardBudget?: boolean },
        options?: { syncToBasecamp?: boolean },
    ) => {
        saved.push({
            billable: log.billable,
            countsTowardBudget: log.countsTowardBudget,
            syncToBasecamp: options?.syncToBasecamp,
        });
        return { success: false, error: 'stopped' };
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const client = { id: 'client-1', clientName: 'Maya', tasks: [] } as ClientProject;
    await act(async () => {
        root.render(createElement(TimeLogModal, {
            isOpen: true,
            onClose: () => undefined,
            clients: [client],
            organizationId: 'org-1',
            initialClientId: 'client-1',
            saveTimeLog,
        }));
    });

    assert.equal(switchNamed(container, 'Billable').checked, true);
    assert.equal(switchNamed(container, 'Counts toward SEO hours').checked, true);
    assert.equal(switchNamed(container, 'Send to Basecamp').disabled, true);

    const hours = container.querySelector<HTMLInputElement>('#time-log-hours');
    const description = container.querySelector<HTMLTextAreaElement>('textarea');
    assert.ok(hours && description);
    await act(async () => {
        switchNamed(container, 'Billable').click();
        switchNamed(container, 'Counts toward SEO hours').click();
        setValue(hours, '1.5');
        setValue(description, 'Outreach');
    });
    await act(async () => {
        container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    });
    assert.deepEqual(saved[0], { billable: false, countsTowardBudget: false, syncToBasecamp: false });
    act(() => root.unmount());
    container.remove();

    const detail = document.createElement('div');
    document.body.appendChild(detail);
    const detailRoot: Root = createRoot(detail);
    const detailSaved: typeof saved = [];
    await act(async () => {
        detailRoot.render(createElement(
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
                {
                    value: {
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
                    },
                },
                createElement(TaskDetailModal, {
                    task: task(),
                    isOpen: true,
                    onClose: () => undefined,
                    saveTimeLog: async (log, options) => {
                        detailSaved.push({
                            billable: log.billable,
                            countsTowardBudget: log.countsTowardBudget,
                            syncToBasecamp: options?.syncToBasecamp,
                        });
                        return { success: false, error: 'stopped' };
                    },
                }),
            ),
        ));
    });
    await act(async () => {
        [...detail.querySelectorAll('button')].find(button => button.textContent?.includes('Log time manually'))?.click();
    });
    assert.equal(switchNamed(detail, 'Billable').checked, true);
    assert.equal(switchNamed(detail, 'Counts toward SEO hours').checked, true);
    const taskHours = detail.querySelector<HTMLInputElement>('#task-log-hours');
    assert.ok(taskHours);
    await act(async () => {
        setValue(taskHours, '2');
    });
    await act(async () => {
        [...detail.querySelectorAll('button')].find(button => button.textContent?.includes('Save Entry'))?.click();
    });
    assert.deepEqual(detailSaved[0], { billable: true, countsTowardBudget: true, syncToBasecamp: false });

    act(() => detailRoot.unmount());
    detail.remove();
});
