import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ClientTable } from '../components/workspace/ClientTable.tsx';
import { TimesheetsShell } from '../components/timesheets/TimesheetsShell.tsx';
import { OrganizationContext } from '../components/providers/organization-provider.tsx';
import { TimerContext } from '../components/providers/timer-provider.tsx';
import { formatWeekRange } from './timesheets/format.ts';
import { weekStartFor } from './timesheets/ledger.ts';
import { manualLogDate } from './timesheets/manual-log.ts';
import { formatLocalDate, parseLocalDate } from './planner/local-date.ts';
import type { ClientProject, Organization } from './types.ts';

// CI provides public Supabase credentials. These screens look up the session
// and a client's Basecamp flags, and a live client keeps the process open.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.self = dom.window as unknown as typeof globalThis;
globalThis.Event = dom.window.Event as unknown as typeof Event;
globalThis.CustomEvent = dom.window.CustomEvent as unknown as typeof CustomEvent;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
globalThis.HTMLInputElement = dom.window.HTMLInputElement;
globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
globalThis.HTMLButtonElement = dom.window.HTMLButtonElement;
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

function buttonByText(container: ParentNode, text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(button => button.textContent?.includes(text));
    assert.ok(found instanceof HTMLButtonElement, text);
    return found;
}

function switchNamed(container: ParentNode, label: string): HTMLInputElement {
    const found = [...container.querySelectorAll('label')].find(item => item.textContent?.includes(label));
    const input = found?.querySelector('input');
    assert.ok(input instanceof HTMLInputElement, label);
    return input;
}

function shiftWeek(weekStart: string, weeks: number): string {
    const parsed = parseLocalDate(weekStart);
    assert.ok(parsed);
    parsed.setDate(parsed.getDate() + weeks * 7);
    return formatLocalDate(parsed);
}

const organization: Organization = {
    id: 'org-1',
    name: 'Demo Agency',
    slug: 'demo',
    subscriptionStatus: 'active',
    planType: 'starter',
    createdAt: '2026-10-01T00:00:00.000Z',
};

function client(name = 'Northwind'): ClientProject {
    return {
        id: 'client-1',
        organizationId: 'org-1',
        clientName: name,
        launchDate: '2026-01-15',
        accountManager: 'Abel Miranda',
        status: 'Active',
        tier: 1,
        engagementModel: 'Retainer',
        seoHours: 10,
        deliverables: 'Blog',
        blogsDuePerMonth: 4,
        blogProgress: { target: 4, dueToDate: 1, delivered: 1, pastDue: 0, isOnTrack: true },
        approvals: { pendingCount: 0, items: [] },
        tasks: [],
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

test('the workspace Log Time button stays visible and names the client', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(ClientTable, { clients: [client()] }));
    });

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Log time for Northwind"]');
    assert.ok(button);
    assert.equal(button.getAttribute('aria-label'), 'Log time for Northwind');
    assert.equal(button.disabled, false);
    assert.notEqual(button.tabIndex, -1);
    assert.doesNotMatch(button.className, /\bopacity-0\b/);
    assert.match(button.className, /text-muted-foreground/);
    assert.match(button.className, /group-hover:text-primary/);
    assert.match(button.className, /group-focus-within:text-primary/);
    const row = button.closest('tr');
    assert.match(row?.className ?? '', /\bgroup\b/);

    await act(async () => {
        button.click();
    });
    assert.equal(container.querySelector('h3')?.textContent, 'Log Time');

    act(() => root.unmount());
    container.remove();
});

test('Add time offers a timer and manual hours, and manual save syncs when the client can', async () => {
    const saved: Array<{
        clientId?: string;
        date?: string;
        syncToBasecamp?: boolean;
        waitForBasecampSync?: boolean;
    }> = [];
    const started: string[] = [];
    const onQuickStart = () => { started.push('timer'); };
    window.addEventListener('timer:open-quick-start', onQuickStart);

    const today = formatLocalDate(new Date());
    const thisWeek = weekStartFor(today);
    const nextWeek = shiftWeek(thisWeek, 1);

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(
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
                createElement(TimesheetsShell, {
                    manualLogClients: [client('Northwind')],
                    resolveTimesheetSync: async () => true,
                    saveTimeLog: async (log, options) => {
                        saved.push({
                            clientId: log.clientId,
                            date: log.date,
                            syncToBasecamp: options?.syncToBasecamp,
                            waitForBasecampSync: options?.waitForBasecampSync,
                        });
                        return { success: true, basecampSync: { success: false, error: 'Basecamp sync failed' } };
                    },
                }),
            ),
        ));
    });
    await act(async () => {
        await Promise.resolve();
    });

    assert.equal(container.textContent?.includes('Loading timesheet'), false);
    await act(async () => {
        buttonByText(container, 'Add time').click();
    });
    const menu = container.querySelector('[role="menu"]');
    assert.equal(menu?.getAttribute('aria-label'), 'Add time');
    assert.equal(buttonByText(menu!, 'Start timer').textContent?.includes('Start timer'), true);
    assert.equal(buttonByText(menu!, 'Log hours manually').textContent?.includes('Log hours manually'), true);

    await act(async () => {
        buttonByText(menu!, 'Start timer').click();
    });
    assert.deepEqual(started, ['timer']);
    assert.equal(container.querySelector('[role="menu"]'), null);

    await act(async () => {
        buttonByText(container, 'Add time').click();
    });
    await act(async () => {
        buttonByText(container, 'Log hours manually').click();
    });
    assert.equal(container.querySelector('h3')?.textContent, 'Log Time');
    const date = container.querySelector<HTMLInputElement>('#time-log-date');
    assert.equal(date?.value, manualLogDate(thisWeek, today));
    assert.equal(date?.value, today);

    const hours = container.querySelector<HTMLInputElement>('#time-log-hours');
    const description = container.querySelector<HTMLTextAreaElement>('textarea');
    const clientSelect = container.querySelector<HTMLSelectElement>('select');
    assert.ok(date && hours && description && clientSelect);
    await act(async () => {
        setValue(clientSelect, 'client-1');
    });
    await act(async () => {
        await Promise.resolve();
    });
    const send = switchNamed(container, 'Send to Basecamp');
    assert.equal(send.disabled, false);
    assert.equal(send.checked, true);

    await act(async () => {
        setValue(date, nextWeek);
        setValue(hours, '1.5');
        setValue(description, 'Manual hours from the timesheet');
    });
    await act(async () => {
        buttonByText(container, 'Log Time').click();
    });

    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.clientId, 'client-1');
    assert.equal(saved[0]?.date, nextWeek);
    assert.equal(saved[0]?.syncToBasecamp, true);
    assert.equal(saved[0]?.waitForBasecampSync, true);
    assert.equal(container.querySelector('h1')?.textContent, formatWeekRange(nextWeek));

    window.removeEventListener('timer:open-quick-start', onQuickStart);
    act(() => root.unmount());
    container.remove();
});

test('manual hours on another visible week prefill that week, not today', async () => {
    const today = formatLocalDate(new Date());
    const nextWeek = shiftWeek(weekStartFor(today), 1);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(
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
                createElement(TimesheetsShell, {
                    manualLogClients: [client()],
                    saveTimeLog: async () => ({ success: false, error: 'stopped' }),
                }),
            ),
        ));
    });
    await act(async () => {
        await Promise.resolve();
    });

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[aria-label="Next week"]')?.click();
    });
    await act(async () => {
        buttonByText(container, 'Add time').click();
    });
    await act(async () => {
        buttonByText(container, 'Log hours manually').click();
    });
    const date = container.querySelector<HTMLInputElement>('#time-log-date');
    assert.equal(date?.value, nextWeek);
    assert.notEqual(date?.value, today);

    act(() => root.unmount());
    container.remove();
});
