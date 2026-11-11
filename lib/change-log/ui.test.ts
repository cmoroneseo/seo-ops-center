import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChangeLogView } from '../../components/change-log/ChangeLogView.tsx';
import { exampleBoard, exampleConfounders, ecoworkzH1Input } from './fixture.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const board = exampleBoard();
const h1 = board.changes[0];

function html(mode: 'list' | 'form' | 'detail' | 'loading' | 'empty') {
    return renderToStaticMarkup(createElement(ChangeLogView, {
        clientName: 'Ecoworkz',
        mode,
        example: true,
        exampleNote: 'Example data. Not a live Search Console or Analytics pull.',
        items: board.items,
        detail: {
            change: h1,
            impact: board.impacts[h1.id],
            confounders: exampleConfounders(board, h1.id),
            baselineNote: 'Example baseline.',
        },
        formInitial: ecoworkzH1Input(),
        onLog: () => undefined,
        onOpen: () => undefined,
        onBack: () => undefined,
        onSubmit: () => undefined,
        onRemove: () => undefined,
    }));
}

test('the example timeline shows an impact badge and the example label', () => {
    const markup = html('list');
    assert.match(markup, /Example data/);
    assert.match(markup, /Homepage H1/);
    assert.match(markup, /Improved/);
    assert.match(markup, /El Niño promo banner/);
    assert.match(markup, /Flat/);
});

test('the detail names the live marker, the control, and the revert path', () => {
    const markup = html('detail');
    assert.match(markup, /Marker on Nov 10/);
    assert.match(markup, /Untouched pages|untouched pages/);
    assert.match(markup, /Does not show the change caused it/);
    assert.match(markup, /widget 47eaa58/);
    assert.match(markup, /Same day/);
    assert.match(markup, /hardscape contractors corona/);
});

test('empty and loading states are real screens', () => {
    assert.match(html('empty'), /No changes logged yet/);
    assert.match(html('loading'), /Loading changes/);
});

test('the log form is filled with the Ecoworkz H1', () => {
    const markup = html('form');
    assert.match(markup, /Hardscape &amp; Landscape Contractors in Corona, CA|Hardscape & Landscape Contractors in Corona, CA/);
    assert.match(markup, /2026-11-10T14:04/);
    assert.match(markup, /Elementor template 11115/);
    assert.match(markup, /value="Carlos"/);
});
