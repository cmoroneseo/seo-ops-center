import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { FloatingTimer } from '../../components/timer/FloatingTimer.tsx';
import { TimerContext } from '../../components/providers/timer-provider.tsx';
import { formatTimerStartClock } from './widget-label.ts';
import type { TimerAttempt } from '../types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window as unknown as Window & typeof globalThis;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Element = dom.window.Element;
globalThis.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver. The timer publishes toast clearance with one.
globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

function attempt(overrides: Partial<TimerAttempt> = {}): TimerAttempt {
    return {
        id: 'attempt-1',
        organizationId: 'org-1',
        userId: 'user-1',
        date: '2026-10-20',
        hours: 0,
        description: '',
        billable: true,
        countsTowardBudget: true,
        status: 'in_progress',
        elapsedSeconds: 0,
        sessionNotes: [],
        segments: [],
        source: 'seo_pm',
        importStatus: 'mapped',
        ...overrides,
    };
}

test('the floating timer shows the running task and start time, and resumes a paused one', async () => {
    const started = new Date();
    started.setSeconds(0, 0);
    const running = attempt({
        id: 'run',
        clientName: 'Maya',
        taskTitle: 'Submit sitemap',
        timerStartedAt: new Date(started.getTime() - 60 * 60 * 1000).toISOString(),
        segments: [{
            id: 'seg',
            timeLogId: 'run',
            organizationId: 'org-1',
            userId: 'user-1',
            startedAt: started.toISOString(),
        }],
    });
    const paused = attempt({
        id: 'pause',
        clientName: 'Northwind',
        taskTitle: '',
        description: 'Keyword map',
        elapsedSeconds: 600,
    });
    const resumed: string[] = [];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(
            TimerContext.Provider,
            {
                value: {
                    runningTimer: running,
                    pausedTimers: [paused],
                    getElapsedSeconds: item => item.id === 'run' ? 125 : item.elapsedSeconds,
                    startTask: async () => true,
                    pause: async () => undefined,
                    resume: async item => {
                        resumed.push(item.id);
                        return true;
                    },
                    switchToTask: async () => true,
                    beginStop: async () => ({ running: null, paused: [] }),
                    finalize: async () => ({ running: null, paused: [] }),
                    discard: async () => undefined,
                    addNote: async () => undefined,
                    editNote: async () => undefined,
                    deleteNote: async () => undefined,
                    getAttemptById: () => running,
                },
            },
            createElement(FloatingTimer, { clients: [] }),
        ));
    });

    const task = container.querySelector('[data-timer-task]');
    const clock = container.querySelector('[data-timer-started]');
    assert.equal(task?.textContent, 'Submit sitemap');
    assert.equal(clock?.textContent, formatTimerStartClock(started.toISOString()));
    assert.equal(container.querySelector('[data-timer-paused="pause"]')?.textContent?.includes('Keyword map'), true);
    assert.equal(container.querySelector('[data-timer-short]'), null);
    assert.equal(container.querySelector('[data-timer-discard]'), null);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-timer-resume="pause"]')?.click();
    });
    assert.deepEqual(resumed, ['pause']);

    await act(async () => {
        container.querySelector<HTMLButtonElement>('[aria-label="Collapse timer"]')?.click();
    });
    const chip = container.querySelector('button');
    assert.equal(chip?.querySelector('[data-timer-task]')?.textContent, 'Submit sitemap');
    assert.match(chip?.getAttribute('title') ?? '', /Submit sitemap/);
    assert.match(chip?.getAttribute('title') ?? '', /Started /);

    act(() => root.unmount());
    container.remove();
});

test('a paused entry under a minute can be discarded in one click and is not deleted otherwise', async () => {
    const discarded: string[] = [];
    const paused = attempt({
        id: 'short',
        clientName: 'Fixture',
        taskTitle: 'Check the homepage',
        elapsedSeconds: 7,
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(
            TimerContext.Provider,
            {
                value: {
                    runningTimer: null,
                    pausedTimers: [paused],
                    getElapsedSeconds: item => item.elapsedSeconds,
                    startTask: async () => true,
                    pause: async () => undefined,
                    resume: async () => true,
                    switchToTask: async () => true,
                    beginStop: async () => ({ running: null, paused: [] }),
                    finalize: async () => ({ running: null, paused: [] }),
                    discard: async item => { discarded.push(item.id); },
                    addNote: async () => undefined,
                    editNote: async () => undefined,
                    deleteNote: async () => undefined,
                    getAttemptById: () => paused,
                },
            },
            createElement(FloatingTimer, { clients: [] }),
        ));
    });

    assert.match(container.querySelector('[data-timer-short="short"]')?.textContent ?? '', /Under 1 minute/);
    await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-timer-discard="short"]')?.click();
    });
    assert.deepEqual(discarded, ['short']);

    act(() => root.unmount());
    container.remove();
});
