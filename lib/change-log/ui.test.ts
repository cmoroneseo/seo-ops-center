import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChangeLogView } from '../../components/change-log/ChangeLogView.tsx';
import { exampleBoard, exampleConfounders, ecoworkzH1Input } from './fixture.ts';
import type { TimelineItem } from './types.ts';

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

test('the example list shows one result pill per row', () => {
    const markup = html('list');
    assert.match(markup, /Example data/);
    assert.match(markup, /Homepage H1/);
    assert.match(markup, /El Niño promo banner/);
    assert.equal(markup.split('Improved').length - 1, 1);
    assert.match(markup, /No clear change/);
    assert.equal(markup.includes('Flat'), false);
    assert.equal(markup.includes('· Estimate'), false);
    assert.equal(markup.includes('/day'), false);
    assert.equal((markup.match(/data-result=/g) ?? []).length, 2);
    assert.match(markup, /data-result="improved"/);
    assert.match(markup, /data-result="flat"/);
    assert.match(markup, /<svg/);
    assert.match(markup, /Main page heading/);
    assert.equal(markup.includes('(H1)'), false);
    assert.match(markup, /Nov 10, 2026/);
    assert.equal(markup.includes('2:04'), false);
});

test('an estimate or an early row does not repeat the verdict beside the pill', () => {
    const early: TimelineItem = {
        ...board.items[0],
        id: 'early',
        title: 'Early change',
        verdict: 'too_early',
        estimate: false,
        deltaText: 'Too early',
    };
    const estimated: TimelineItem = {
        ...board.items[0],
        id: 'estimated',
        title: 'Estimated change',
        verdict: 'improved',
        estimate: true,
        deltaText: '9/day → 10/day (+12%)',
    };
    const markup = renderToStaticMarkup(createElement(ChangeLogView, {
        clientName: 'Ecoworkz',
        mode: 'list',
        example: true,
        items: [early, estimated],
        onLog: () => undefined,
        onOpen: () => undefined,
        onBack: () => undefined,
        onSubmit: () => undefined,
        onRemove: () => undefined,
    }));
    assert.equal(markup.split('Too early').length - 1, 1);
    assert.match(markup, /Too early to tell/);
    assert.match(markup, /Early estimate/);
    assert.match(markup, /data-result="early-estimate"/);
    assert.equal(markup.includes('Improved'), false);
    assert.equal(markup.includes('· Estimate'), false);
    assert.equal(markup.includes('9/day'), false);
    assert.equal(markup.includes('(+12%)'), false);
    assert.equal((markup.match(/data-result=/g) ?? []).length, 2);
});

test('the detail uses the plain chart title, the rest of the site, and the honesty line', () => {
    const markup = html('detail');
    assert.match(markup, /Clicks from Google, day by day/);
    assert.match(markup, /Compared with the rest of the site\. Other changes on this page are listed below\./);
    assert.match(markup, /100 = the page(?:'|&#x27;|&apos;)s normal level before the change/);
    assert.match(markup, /Marker on Nov 10/);
    assert.match(markup, /Rest of the site/);
    assert.match(markup, /prove the change caused it/);
    assert.equal(markup.includes('Does not show the change caused it'), false);
    assert.equal(/untouched/i.test(markup), false);
    assert.equal(markup.includes('page vs'), false);
    assert.equal(markup.includes('The control is'), false);
    assert.match(markup, /Main page heading/);
    assert.match(markup, /\(H1\)/);
    assert.match(markup, /What we(?:'|&#x27;|&apos;)re watching/);
    assert.match(markup, /Nov 10, 2026 · 2:04 PM PT \(Pacific time\)/);
    assert.match(markup, /How to undo/);
    assert.match(markup, /Starting point/);
    assert.match(markup, /Not ready yet/);
    assert.match(markup, /widget 47eaa58/);
    assert.match(markup, /Same day/);
    assert.match(markup, /hardscape contractors corona/);
    assert.match(markup, /Search terms people used/);
    assert.match(markup, /Google Search Console/);
    assert.match(markup, /Google(?:'|&#x27;|&apos;)s report on how your site shows up in search/);
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
