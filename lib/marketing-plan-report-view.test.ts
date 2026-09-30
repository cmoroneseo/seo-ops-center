/**
 * Run with: node --import tsx --test lib/marketing-plan-report-view.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarketingPlanReportBody } from '../components/reports/MarketingPlanReportBlock.tsx';
import {
    fulfillmentCounts, planFulfillmentBuckets,
} from './marketing-plan-logic.ts';
import type { MarketingPlanItem, MarketingPlanStep } from './types.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const STEPS: MarketingPlanStep[] = [
    { key: 'setup', name: 'Introduction & Setup', sortOrder: 0 },
    { key: 'technical', name: 'Technical SEO', sortOrder: 1 },
];

function item(over: Partial<MarketingPlanItem>): MarketingPlanItem {
    return {
        id: 'i1', marketingPlanId: 'p1', organizationId: 'o1', clientId: 'c1',
        stepKey: 'setup', title: 'Confirm access', status: 'todo', priority: 'medium',
        sortOrder: 0, comments: [], isCustom: false,
        createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z',
        ...over,
    };
}

const ITEMS = [
    item({ id: 'a', title: 'Confirm access', dueDate: '2026-03-10', status: 'done' }),
    item({
        id: 'b', title: 'Connect Search Console', stepKey: 'technical', dueDate: '2026-04-02',
        description: 'Verify the domain property.',
    }),
    item({ id: 'c', title: 'Hold kickoff', stepKey: 'setup', sortOrder: 1 }),
    item({ id: 'd', title: 'Skip this item', stepKey: 'setup', status: 'ignored', sortOrder: 2 }),
];

function render(view: 'step' | 'month', editable = true, openKey?: string, expanded = false) {
    const buckets = planFulfillmentBuckets(ITEMS, STEPS, view, { anchorDate: '2026-03-01' });
    return renderToStaticMarkup(createElement(MarketingPlanReportBody, {
        view,
        counts: fulfillmentCounts(ITEMS),
        buckets,
        openKey: openKey ?? buckets[0]?.key ?? null,
        expanded,
        editable,
        monthNote: view === 'month' && editable ? 'Month 1 is the launch month.' : null,
        onChangeView: () => {},
        onToggleBucket: () => {},
        onToggleExpanded: () => {},
    }));
}

function fullChecklist(html: string): string {
    const marker = 'data-plan-checklist="full"';
    const start = html.indexOf(marker);
    assert.notEqual(start, -1);
    return html.slice(start);
}

test('step view shows the per-step breakdown and the open step checklist', () => {
    const html = render('step');
    assert.match(html, /SEO Plan/);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, />Step</);
    assert.match(html, />Month</);
    assert.match(html, /print-hidden/);
    assert.match(html, /Step 1: Introduction &amp; Setup/);
    assert.match(html, /1\/2/);
    assert.match(html, /Step 2: Technical SEO/);
    assert.match(html, /Confirm access/);
    assert.equal(html.includes('Month 1'), false);
    assert.equal(html.includes('Unscheduled'), false);
});

test('month view groups by engagement month and keeps undated items', () => {
    const html = render('month', true, 'unscheduled');
    assert.match(html, /data-plan-view="month"/);
    assert.match(html, /Month 1/);
    assert.match(html, /Month 2/);
    assert.match(html, /Unscheduled/);
    assert.match(html, /Hold kickoff/);
    assert.match(html, /Month 1 is the launch month/);
    assert.equal(html.includes('Step 1:'), false);
});

test('read-only render keeps the selected view and omits the step/month toggle', () => {
    const html = render('month', false);
    assert.match(html, /Month 1/);
    assert.equal(html.includes('aria-pressed'), false);
    assert.equal(html.includes('>Step<'), false);
    assert.equal(html.includes('>Month<'), false);
});

test('collapsed screen peeks one item and print markup still lists every step', () => {
    const html = render('step');
    const previewEnd = html.indexOf('data-plan-checklist="full"');
    const preview = html.slice(0, previewEnd);
    assert.match(preview, /data-plan-checklist="preview"/);
    assert.match(preview, /Confirm access/);
    assert.equal(preview.includes('Hold kickoff'), false);
    assert.equal(preview.includes('Connect Search Console'), false);
    assert.equal(preview.includes('Verify the domain property'), false);
    assert.match(preview, /Show more/);
    assert.match(preview, /print-hidden/);
    assert.equal(html.includes('Show less'), false);

    const fullStart = html.indexOf('data-plan-checklist="full"');
    const fullTag = html.slice(html.lastIndexOf('<div', fullStart), html.indexOf('>', fullStart) + 1);
    assert.match(fullTag, /print-only/);
    const full = fullChecklist(html);
    assert.match(full, /Confirm access/);
    assert.match(full, /Hold kickoff/);
    assert.match(full, /Connect Search Console/);
    assert.match(full, /Verify the domain property/);
    assert.match(full, /Step 2: Technical SEO/);
    assert.equal(full.includes('Skip this item'), false);
    assert.equal(full.includes('Show more'), false);
    assert.equal(full.includes('Show less'), false);
});

test('expanded screen lists every item and the show-less control stays out of print', () => {
    const html = render('step', true, undefined, true);
    assert.equal(html.includes('data-plan-checklist="preview"'), false);
    const fullTag = html.match(/<div[^>]*data-plan-checklist="full"[^>]*>/)?.[0] ?? '';
    assert.equal(fullTag.includes('print-only'), false);
    const full = fullChecklist(html);
    assert.match(full, /Hold kickoff/);
    assert.match(full, /Connect Search Console/);
    assert.match(full, /Verify the domain property/);
    assert.match(full, /Show less/);
    assert.match(full, /print-hidden/);
    assert.equal(full.includes('Show more'), false);
    assert.equal(html.includes('Skip this item'), false);
});
