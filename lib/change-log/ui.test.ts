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
    assert.match(markup, /<table/);
    assert.match(markup, /data-went-live="all"/);
    assert.match(markup, /aria-label="Went live: All time"/);
    assert.equal(markup.includes('type="date"'), false);
    assert.equal(markup.includes('From date'), false);
    assert.equal(markup.includes('To date'), false);
    const tableAt = markup.indexOf('<table');
    const captionAt = markup.indexOf('<caption');
    const headAt = markup.indexOf('<thead');
    assert.ok(tableAt >= 0 && captionAt > tableAt && headAt > captionAt);
    assert.match(markup, /What we(?:'|&#x27;|&apos;)re watching/);
    assert.match(markup, /Latest result/);
    assert.match(markup, /Next check/);
    assert.match(markup, /aria-sort="descending"/);
    assert.match(markup, /Clicks from Google/);
    assert.match(markup, /56-day check/);
    assert.match(markup, /Jan 5, 2027/);
    assert.match(markup, /of 2 changes/);
    assert.match(markup, /newest first/);
    assert.match(markup, /pages we didn(?:'|&#x27;|&apos;)t change/);
    assert.equal(markup.split('Improved').length - 1, 2);
    assert.match(markup, /No clear change/);
    assert.match(markup, /Too early to tell/);
    assert.match(markup, /Early estimate/);
    assert.match(markup, /Declined/);
    const visible = markup.replace(/<style>[\s\S]*?<\/style>/, '');
    assert.equal(visible.includes('Flat'), false);
    assert.equal(visible.includes('· Estimate'), false);
    assert.equal(visible.includes('/day'), false);
    assert.equal(visible.includes('0%'), false);
    assert.equal((markup.match(/data-result="/g) ?? []).length, 2);
    assert.equal((markup.match(/data-bucket="/g) ?? []).length, 5);
    assert.match(markup, /data-bucket="improved"[^>]*data-count="1"/);
    assert.match(markup, /data-bucket="flat"[^>]*data-count="1"/);
    assert.match(markup, /data-bucket="declined"[^>]*data-count="0"/);
    assert.match(markup, /data-result="improved"/);
    assert.match(markup, /data-result="flat"/);
    assert.match(markup, /<svg/);
    assert.match(markup, /Main page heading/);
    assert.match(markup, /Call-to-action section/);
    assert.equal(markup.includes('(H1)'), false);
    assert.equal(markup.includes('(CTR)'), false);
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
        headlineDays: null,
        headlinePct: null,
        checkpointDays: null,
        nextCheckOn: '2026-11-11',
        nextCheckDays: 7,
    };
    const estimated: TimelineItem = {
        ...board.items[0],
        id: 'estimated',
        title: 'Estimated change',
        verdict: 'improved',
        estimate: true,
        deltaText: '9/day → 10/day (+12%)',
        headlineDays: 7,
        headlinePct: 12,
        checkpointDays: 7,
        nextCheckOn: '2026-11-18',
        nextCheckDays: 14,
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
    assert.match(markup, /Too early to tell/);
    assert.match(markup, /Early estimate \+12%/);
    assert.match(markup, /7-day check/);
    assert.match(markup, /Not ready yet/);
    assert.match(markup, /data-result="early-estimate"/);
    assert.match(markup, /data-result="too_early"/);
    assert.equal(markup.split('Improved').length - 1, 1);
    assert.equal(markup.includes('· Estimate'), false);
    assert.equal(markup.includes('9/day'), false);
    assert.equal(markup.includes('(+12%)'), false);
    assert.equal(markup.replace(/<style>[\s\S]*?<\/style>/, '').includes('0%'), false);
    assert.equal((markup.match(/data-result="/g) ?? []).length, 2);
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
