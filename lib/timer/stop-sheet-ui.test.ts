import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { StopConfirmSheet } from '../../components/timer/StopConfirmSheet.tsx';
import { TimerContext } from '../../components/providers/timer-provider.tsx';
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

function attempt(overrides: Partial<TimerAttempt> = {}): TimerAttempt {
    return {
        id: 'attempt-1',
        organizationId: 'org-1',
        userId: 'user-1',
        date: '2026-10-21',
        hours: 0,
        description: '',
        billable: true,
        countsTowardBudget: true,
        status: 'in_progress',
        elapsedSeconds: 1504,
        sessionNotes: [{
            id: 'note-1',
            text: 'Drafted the roadmap',
            createdAt: '2026-10-21T18:02:57.000Z',
        }],
        segments: [],
        source: 'seo_pm',
        importStatus: 'mapped',
        clientName: 'Fixture',
        taskTitle: 'Roadmap',
        ...overrides,
    };
}

test('logging time stays on screen after the open attempt leaves the timer', async () => {
    const open = attempt();
    let gone = false;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
        root.render(createElement(
            TimerContext.Provider,
            {
                value: {
                    runningTimer: null,
                    pausedTimers: [open],
                    getElapsedSeconds: item => item.elapsedSeconds,
                    startTask: async () => true,
                    pause: async () => undefined,
                    resume: async () => true,
                    switchToTask: async () => true,
                    beginStop: async () => ({ running: null, paused: [] }),
                    finalize: async () => {
                        gone = true;
                        return { running: null, paused: [] };
                    },
                    discard: async () => undefined,
                    addNote: async () => undefined,
                    editNote: async () => undefined,
                    deleteNote: async () => undefined,
                    getAttemptById: () => gone ? null : open,
                },
            },
            createElement(StopConfirmSheet, { attemptId: 'attempt-1', onClose: () => undefined }),
        ));
    });

    const confirm = [...container.querySelectorAll('button')].find(button => button.textContent?.startsWith('Confirm'));
    assert.ok(confirm, 'confirm button');
    await act(async () => { confirm.click(); });

    const logged = container.querySelector('[data-timer-logged]');
    assert.match(logged?.textContent ?? '', /Time logged/);
    assert.match(logged?.textContent ?? '', /Fixture/);

    act(() => root.unmount());
    container.remove();
});
