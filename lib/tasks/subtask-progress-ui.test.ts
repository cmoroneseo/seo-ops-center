import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SubtaskProgressText } from '../../components/tasks/SubtaskProgressText.tsx';
import { listedSubtaskProgress, progressOf } from './subtask-progress.ts';
import { workCardSubtaskProgress } from '../workspace-canvas/project.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('a loading counter renders loading text and never 0/N', () => {
    const loading = progressOf(null);
    const html = renderToStaticMarkup(createElement(SubtaskProgressText, { progress: loading }));
    assert.match(html, /Loading subtasks/);
    assert.equal(html.includes('0/'), false);
    assert.equal(loading.label, null);
});

test('a card with placeholder chores still says it is loading', () => {
    const label = workCardSubtaskProgress({
        subtasksState: 'loading',
        subtasks: [
            { id: 'a', title: 'One', completed: false },
            { id: 'b', title: 'Two', completed: false },
            { id: 'c', title: 'Three', completed: false },
            { id: 'd', title: 'Four', completed: false },
            { id: 'e', title: 'Five', completed: false },
        ],
    });
    assert.equal(label, 'Loading subtasks');
    assert.equal(listedSubtaskProgress({
        subtasksState: 'ready',
        subtasks: [
            { id: 'a', title: 'One', completed: true },
            { id: 'b', title: 'Two', completed: true },
            { id: 'c', title: 'Three', completed: true },
            { id: 'd', title: 'Four', completed: false },
        ],
    }).label, '3/4');
});
