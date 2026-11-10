import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

import { OpportunitiesTab } from '../../components/opportunities/OpportunitiesTab.tsx';

const noop = () => {};

function render(view: 'performance' | 'backlog' | 'rankings' | 'health', range: 7 | 28 | 90 = 28) {
    return renderToStaticMarkup(createElement(OpportunitiesTab, {
        organizationId: 'org',
        clientId: 'client',
        clientName: 'Kentina',
        view,
        range,
        showFreshness: false,
        onView: noop,
        onRange: noop,
        onConnections: noop,
    }));
}

function pressed(html: string, label: string): boolean {
    const button = html.match(new RegExp(`<button[^>]*aria-pressed="(true|false)"[^>]*>${label}</button>`));
    return button?.[1] === 'true';
}

test('performance is the default sub-view and the range control is 7, 28, and 90', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    try {
        const html = render('performance', 28);
        assert.match(html, /aria-label="Opportunities"/);
        assert.match(html, />Performance</);
        assert.match(html, />Backlog</);
        assert.match(html, />Site health</);
        assert.equal(html.includes('>Rankings<'), false);
        assert.equal(pressed(html, '7d'), false);
        assert.equal(pressed(html, '28d'), true);
        assert.equal(pressed(html, '90d'), false);
        assert.match(html, /data-search-dashboard/);
        assert.equal(html.includes('Search investigations'), false);
        assert.equal(html.includes('aria-label="Site Inventory"'), false);
        const week = render('performance', 7);
        assert.equal(pressed(week, '7d'), true);
        assert.equal(pressed(week, '28d'), false);
        assert.match(week, /Last 7 days/);
        const quarter = render('performance', 90);
        assert.equal(pressed(quarter, '90d'), true);
        assert.match(quarter, /Last 90 days/);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('backlog, site health, and flagged rankings each mount only that surface', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    try {
        const backlog = render('backlog');
        assert.match(backlog, /aria-label="Search investigations"/);
        assert.equal(backlog.includes('data-search-dashboard'), false);
        assert.equal(backlog.includes('aria-label="Date range"'), false);
        assert.match(backlog, /aria-selected="true"[^>]*>Backlog/);

        const health = render('health');
        assert.match(health, /aria-label="Site Inventory"/);
        assert.equal(health.includes('data-search-dashboard'), false);
        assert.match(health, /aria-selected="true"[^>]*>Site health/);

        const rankings = render('rankings');
        assert.match(rankings, /data-keyword-tracking="rankings"/);
        assert.equal(rankings.includes('data-search-dashboard'), false);
        assert.match(rankings, />Rankings</);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('keyword tracking must be exactly true before Rankings is listed', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    try {
        for (const value of ['false', '1', 'TRUE', '']) {
            process.env.NEXT_PUBLIC_KEYWORD_TRACKING = value;
            const html = render('performance');
            assert.equal(html.includes('>Rankings<'), false, value);
        }
        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
        assert.match(render('performance'), />Rankings</);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('the workspace page routes the old tabs through Opportunities and drops the stacked report', () => {
    const page = readFileSync(new URL('../../app/(dashboard)/workspace/[id]/page.tsx', import.meta.url), 'utf8');
    assert.match(page, /OpportunitiesTab/);
    assert.match(page, /readOpportunityRoute/);
    assert.equal(page.includes('SearchReporting'), false);
    assert.equal(page.includes('<SearchInsightsTab'), false);
    assert.equal(page.includes('<SiteInventoryTab'), false);
    assert.equal(page.includes('<RankingsTab'), false);
});
