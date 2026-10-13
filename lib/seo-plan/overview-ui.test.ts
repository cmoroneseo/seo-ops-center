/**
 * Run with: node --import tsx --test lib/seo-plan/overview-ui.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverviewCommand } from '../../components/seo-plan/OverviewCommand.tsx';
import { TaskToolbar } from '../../components/seo-plan/TaskToolbar.tsx';
import { WorkspaceNav } from '../../components/seo-plan/WorkspaceNav.tsx';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('overview renders an em dash for a failed hour load and does not invent an onboarding zero', () => {
    const html = renderToStaticMarkup(createElement(OverviewCommand, {
        domain: 'sandbox.example',
        hoursLabel: '—',
        agreement: 'unknown',
        monthLabel: 'October 2026',
        onboarding: { status: 'failed' },
        tasks: { status: 'failed' },
        onOpenPlan: () => {},
        onOpenTasks: () => {},
    }));
    assert.match(html, /—/);
    assert.match(html, /sandbox\.example/);
    assert.equal(html.includes('0 of 0'), false);
    assert.equal(html.includes('0h'), false);
    assert.equal(html.includes('Agreement not recorded'), false);
});

test('overview counts selected onboarding work and undated tasks without a due count', () => {
    const html = renderToStaticMarkup(createElement(OverviewCommand, {
        hoursLabel: 'Hours start after launch',
        agreement: 'missing',
        monthLabel: 'October 2026',
        onboarding: {
            status: 'ready',
            done: 1,
            total: 3,
            items: [
                { id: 'a', title: 'Strategy', done: true },
                { id: 'b', title: 'Google Business Profile', done: false },
            ],
        },
        tasks: { status: 'ready', due: [], needDate: 3 },
        onOpenPlan: () => {},
        onOpenTasks: () => {},
    }));
    assert.match(html, /1 of 3/);
    assert.match(html, /Google Business Profile/);
    assert.match(html, /3 need a date/);
    assert.match(html, /Nothing due this month/);
    assert.match(html, /Agreement not recorded/);
    assert.match(html, /These hours start after launch|Hours start after launch/);
});

test('v2 navigation is Overview, Plan, Tasks, Search, and More', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceNav, {
        active: 'overview',
        vault: true,
        onSelect: () => {},
    }));
    assert.match(html, /Overview/);
    assert.match(html, />Plan</);
    assert.match(html, />Tasks</);
    assert.match(html, />Search</);
    assert.match(html, />More</);
    assert.equal(html.includes('SEO Plan'), false);
    assert.equal(html.includes('Full plan'), false);
    assert.equal(html.includes('Site Inventory'), false);
});

test('flagged workspaces hide Basecamp import behind task actions', () => {
    const flagged = renderToStaticMarkup(createElement(TaskToolbar, {
        clientName: 'Sandbox Client A',
        activeCount: 2,
        completedCount: 0,
        overflowImport: true,
        onImport: () => {},
        onCreate: () => {},
    }));
    assert.match(flagged, /Task actions/);
    assert.equal(flagged.includes('Import from Basecamp'), false);
    const classic = renderToStaticMarkup(createElement(TaskToolbar, {
        clientName: 'Sandbox Client A',
        activeCount: 2,
        completedCount: 0,
        overflowImport: false,
        onImport: () => {},
        onCreate: () => {},
    }));
    assert.match(classic, /Import from Basecamp/);
});
