import assert from 'node:assert/strict';
import test from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ChangeLogView } from '../../components/change-log/ChangeLogView.tsx';
import { exampleBoard, exampleConfounders, exampleGroupBoard, ecoworkzH1Input } from './fixture.ts';
import type { TimelineItem } from './types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const board = exampleBoard();
const h1 = board.changes[0];

function html(mode: 'list' | 'form' | 'detail' | 'loading' | 'empty') {
    return renderToStaticMarkup(createElement(ChangeLogView, {
        clientName: 'Ecoworkz',
        mode,
        example: true,
        exampleNote: 'Example data. Not a live Google Search Console or Analytics pull.',
        items: board.items,
        detail: {
            change: h1,
            impact: board.impacts[h1.id],
            confounders: exampleConfounders(board, h1.id),
            baselineNote: 'Example starting point.',
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
    assert.match(markup, /Homepage main heading/);
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
    assert.match(markup, /Timeline/);
    assert.match(markup, /Overlay/);
    assert.match(markup, /Test progress/);
    assert.match(markup, /In progress/);
    assert.match(markup, /Numbers are final through/);
    assert.match(markup, /data-test-progress="59"/);
    assert.match(markup, /data-test-progress-window="56"/);
    assert.equal(markup.includes('>Day by day<'), false);
    assert.equal(markup.includes('Side by side'), false);
    assert.match(markup, /Compared with the rest of the site/);
    assert.match(markup, /data-chart-tab="daily"/);
    assert.match(markup, /aria-selected="true"/);
    assert.match(markup, /A gap is a day with no report/);
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
    assert.match(markup, /Section id/);
    assert.match(markup, /47eaa58/);
    assert.equal(/\bwidget\b/i.test(markup), false);
    assert.equal(/\bbaseline\b/i.test(markup), false);
    assert.match(markup, /All changes/);
    assert.match(markup, /Download/);
    assert.match(markup, /More actions/);
    assert.match(markup, /Before and after the change/);
    assert.match(markup, /When we check/);
    assert.match(markup, /What changed/);
    assert.match(markup, /Lower is better/);
    assert.match(markup, /<details class="change-log-record/);
    assert.equal(/<details[^>]*\sopen/.test(markup), false);
    assert.match(markup, /data-check-days="28"[^>]*data-due="2026-12-08"[^>]*data-ready="2026-12-11"/);
    assert.match(markup, /data-check-days="56"[^>]*data-due="2027-01-05"[^>]*data-ready="2027-01-08"/);
    assert.match(markup, /Data ready ~Dec 11/);
    assert.equal(markup.includes('Data ready ~Dec 10'), false);
    assert.equal(markup.includes('Remove from log'), false);
    const answerAt = markup.indexOf('Homepage main heading');
    const changedAt = markup.indexOf('What changed');
    const checksAt = markup.indexOf('When we check');
    const tableAt = markup.indexOf('Before and after the change');
    const chartAt = markup.indexOf('Clicks from Google, day by day');
    assert.ok(answerAt >= 0 && changedAt > answerAt && checksAt > changedAt && tableAt > checksAt && chartAt > tableAt);
    assert.match(markup, /Same day/);
    assert.match(markup, /hardscape contractors corona/);
    assert.match(markup, /Search terms people used/);
    assert.match(markup, /Google Search Console/);
    assert.match(markup, /Google(?:'|&#x27;|&apos;)s report on how your site shows up in search/);
});

test('viewers do not see Log a change or the add form', () => {
    const shared = {
        clientName: 'Ecoworkz',
        example: false,
        items: board.items,
        canEdit: false,
        onLog: () => undefined,
        onOpen: () => undefined,
        onBack: () => undefined,
        onSubmit: () => undefined,
        onRemove: () => undefined,
    };
    const list = renderToStaticMarkup(createElement(ChangeLogView, { ...shared, mode: 'list' }));
    const empty = renderToStaticMarkup(createElement(ChangeLogView, { ...shared, mode: 'empty', items: [] }));
    const form = renderToStaticMarkup(createElement(ChangeLogView, { ...shared, mode: 'form' }));
    assert.equal(list.includes('Log a change'), false);
    assert.equal(empty.includes('Log a change'), false);
    assert.match(empty, /after a teammate logs one/);
    assert.match(form, /can(?:'|&#x27;|&apos;)t add a change/);
    assert.equal(form.includes('aria-label="Page address"'), false);
});

test('a small sample says the chart is weekly, and an unmeasured term is not zero', () => {
    const impact = board.impacts[h1.id];
    const markup = renderToStaticMarkup(createElement(ChangeLogView, {
        clientName: 'Ecoworkz',
        mode: 'detail',
        example: true,
        items: board.items,
        detail: {
            change: h1,
            impact: {
                ...impact,
                headline: { ...impact.headline, lowData: true },
                queries: [{
                    query: 'cosmetic dentist denver',
                    beforeClicks: 4,
                    afterClicks: null,
                    beforeImpressions: 20,
                    afterImpressions: null,
                    beforePosition: 14.2,
                    afterPosition: null,
                    beforeCtr: 0.2,
                    afterCtr: null,
                    clicksDelta: null,
                    impressionsDelta: null,
                    positionDelta: null,
                }],
            },
            confounders: [],
            baselineNote: 'Example starting point.',
        },
        onLog: () => undefined,
        onOpen: () => undefined,
        onBack: () => undefined,
        onSubmit: () => undefined,
        onRemove: () => undefined,
    }));
    assert.match(markup, /week by week/);
    assert.match(markup, /Showing weekly totals/);
    assert.match(markup, /cosmetic dentist denver/);
    assert.match(markup, /— not reported yet/);
    assert.match(markup, /wasn(?:'|&#x27;|&apos;)t measured/);
    assert.match(markup, /4 → — not reported yet/);
});

test('empty and loading states are real screens', () => {
    assert.match(html('empty'), /No changes logged yet/);
    assert.match(html('loading'), /Loading changes/);
});

test('the log form is filled with the Ecoworkz H1', () => {
    const markup = html('form');
    assert.match(markup, /Hardscape &amp; Landscape Contractors in Corona, CA|Hardscape & Landscape Contractors in Corona, CA/);
    assert.match(markup, /2026-11-10T14:04/);
    assert.match(markup, /Saved copy of the old homepage heading/);
    assert.match(markup, /value="Carlos"/);
    assert.match(markup, /aria-label="Page address"/);
    assert.match(markup, /aria-label="Section id"/);
    assert.match(markup, /Add another page/);
    assert.equal(markup.includes('aria-label="Page URL"'), false);
    assert.equal(markup.includes('placeholder="Widget"'), false);
    assert.equal(markup.includes('Add another URL'), false);
});

test('the closed chart does not print a No comparison legend', () => {
    const markup = renderToStaticMarkup(createElement(ChangeLogView, {
        clientName: 'Ecoworkz',
        mode: 'detail',
        example: true,
        items: board.items,
        detail: {
            change: h1,
            impact: { ...board.impacts[h1.id], controlLabel: 'No comparison' },
            confounders: [],
            baselineNote: 'Example starting point.',
        },
        onLog: () => undefined,
        onOpen: () => undefined,
        onBack: () => undefined,
        onSubmit: () => undefined,
        onRemove: () => undefined,
    }));
    assert.equal(markup.includes('No comparison'), false);
    assert.equal(markup.includes('data-chart-caption'), false);
});

test('a group test shows the summary, each page, and a finished gauge', () => {
    const grouped = exampleGroupBoard();
    const change = grouped.changes[0];
    const markup = renderToStaticMarkup(createElement(ChangeLogView, {
        clientName: 'Example',
        mode: 'detail',
        example: true,
        items: grouped.items,
        detail: {
            change,
            impact: grouped.impacts[change.id],
            confounders: [],
            baselineNote: 'Example starting point.',
        },
        onLog: () => undefined,
        onOpen: () => undefined,
        onBack: () => undefined,
        onSubmit: () => undefined,
        onRemove: () => undefined,
    }));
    assert.match(markup, /Group test/);
    assert.match(markup, /Title and meta description format/);
    assert.match(markup, /Control period/);
    assert.match(markup, /Test period/);
    assert.match(markup, /Rest of the site clicks per day/);
    assert.match(markup, /Sitewide clicks minus the pages in this test/);
    assert.equal(markup.includes('including these pages'), false);
    assert.equal(markup.includes('Whole site'), false);
    assert.match(markup, /data-group-metric="site_clicks"/);
    assert.match(markup, /Hardscape/);
    assert.match(markup, /Landscape/);
    assert.match(markup, /Pavers/);
    assert.match(markup, /data-group-pages="3"/);
    assert.match(markup, /data-test-progress="100"/);
    assert.match(markup, /data-test-progress-status="finished"/);
    assert.match(markup, /Finished/);
    assert.match(markup, /Timeline/);
    assert.match(markup, /Overlay/);
    assert.equal(markup.includes('Split test'), false);
    const pages = markup.slice(markup.indexOf('data-group-pages'));
    assert.equal(pages.includes('Improved'), false);
});
