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
    item({ id: 'b', title: 'Connect Search Console', stepKey: 'technical', dueDate: '2026-04-02' }),
    item({ id: 'c', title: 'Hold kickoff', stepKey: 'setup', sortOrder: 1 }),
];

function render(view: 'step' | 'month', editable = true, openKey?: string) {
    const buckets = planFulfillmentBuckets(ITEMS, STEPS, view, { anchorDate: '2026-03-01' });
    return renderToStaticMarkup(createElement(MarketingPlanReportBody, {
        view,
        counts: fulfillmentCounts(ITEMS),
        buckets,
        openKey: openKey ?? buckets[0]?.key ?? null,
        editable,
        monthNote: view === 'month' && editable ? 'Month 1 is the launch month.' : null,
        onChangeView: () => {},
        onToggleBucket: () => {},
    }));
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

test('read-only render keeps the selected view and omits the toggle', () => {
    const html = render('month', false);
    assert.match(html, /Month 1/);
    assert.equal(html.includes('aria-pressed'), false);
    assert.equal(html.includes('>Step<'), false);
    assert.equal(html.includes('>Month<'), false);
});
