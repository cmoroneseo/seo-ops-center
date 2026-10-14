import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgencyDashboardView } from '../../components/agency-dashboard/AgencyDashboard.tsx';
import { exampleDashboard } from './fixture.ts';
import { assembleDashboard } from './portfolio.ts';
import { dashboardWindow } from './range.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const model = exampleDashboard();

function render(view: 'grid' | 'list' = 'grid'): string {
    return renderToStaticMarkup(createElement(AgencyDashboardView, { model, initialView: view }));
}

test('the grid shows honest gaps, the color signal, and the detail links', () => {
    const html = render();
    assert.match(html, /data-dashboard="agency"/);
    assert.match(html, />Dashboard</);
    assert.match(html, /Northline Plumbing/);
    assert.match(html, /Harbor Dental/);
    assert.match(html, /of 6 clients/);
    assert.match(html, /vs /);
    assert.match(html, /imported /);
    assert.match(html, /Not synced/);
    assert.match(html, /No data in this range/);
    assert.match(html, /emergency plumber/);
    assert.match(html, /Search Insights/);
    assert.match(html, /SEO Plan/);
    assert.match(html, /Open in GSC/);
    assert.match(html, /href="\/workspace\/north\?tab=insights"/);
    assert.match(html, /href="\/workspace\/north\?tab=campaign"/);
    assert.match(html, /Month 3/);
    assert.match(html, /data-tone="down"/);
    assert.match(html, /data-tone="up"/);
    assert.match(html, /aria-label="Color signal"/);
    assert.match(html, /Biggest declines/);
    assert.equal(html.includes('>0<'), false);
    const fresh = html.slice(html.indexOf('Fresh Start Co'), html.indexOf('Fresh Start Co') + 500);
    assert.match(fresh, /Not synced/);
    assert.match(fresh, /—/);
    assert.match(html, /%<\/span><span class="ml-2 text-zinc-500">· /);
    assert.match(html, /No agreement/);
});

test('the list view is a table of the same clients', () => {
    const html = render('list');
    assert.match(html, /<table/);
    assert.match(html, />Clicks</);
    assert.match(html, />Impressions</);
    assert.match(html, /Avg\. position/);
    assert.match(html, /Impression-weighted average/);
    assert.match(html, /No agreement/);
    assert.match(html, /Northline Plumbing/);
    assert.match(html, /Not synced/);
    assert.match(html, /Search Insights/);
    assert.match(html, /No agreement/);
});

test('an error hides the previous portfolio instead of leaving its numbers up', () => {
    const html = renderToStaticMarkup(createElement(AgencyDashboardView, {
        model,
        error: 'Could not load the dashboard.',
    }));
    assert.match(html, /Could not load the dashboard/);
    assert.equal(html.includes('Northline Plumbing'), false);
    assert.equal(html.includes('of 6 clients'), false);
});

test('a search with no matches replaces the KPI strip', () => {
    const html = renderToStaticMarkup(createElement(AgencyDashboardView, {
        model,
        initialQuery: 'zzzz-no-such-client',
    }));
    assert.match(html, /No clients match/);
    assert.equal(html.includes('of 6 clients'), false);
    assert.equal(html.includes('Northline Plumbing'), false);
});

test('a partial period comparison is marked on the headline, and missing queries say why', () => {
    const partial = assembleDashboard({
        range: '7d',
        window: dashboardWindow('7d', '2026-10-07'),
        asOf: '2026-10-07',
        today: '2026-10-14',
        hoursMonth: '2026-10',
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: null, settling: false },
        clients: [
            { id: 'alpha', name: 'Alpha Co', domain: 'a.example', accountManager: 'Abel Miranda', seoHours: 10, property: 'sc-domain:a.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z', loggedHours: 1, agreements: [], agreementsKnown: true },
            { id: 'beta', name: 'Beta Co', domain: 'b.example', accountManager: 'Abel Miranda', seoHours: 10, property: 'sc-domain:b.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z', loggedHours: 1, agreements: [], agreementsKnown: true },
        ],
        aggregates: [
            { clientId: 'alpha', current: { clicks: 10, impressions: 100, positionWeight: 800, days: 7 }, previous: { clicks: 8, impressions: 80, positionWeight: 640, days: 7 }, series: [], queries: [{ query: 'alpha query', clicks: 3 }], incomplete: false },
            { clientId: 'beta', current: { clicks: 4, impressions: 40, positionWeight: 200, days: 7 }, previous: null, series: [], queries: [], queriesKnown: false, incomplete: false },
        ],
    });
    const html = renderToStaticMarkup(createElement(AgencyDashboardView, { model: partial }));
    assert.match(html, /1 of 2 clients/);
    assert.match(html, /Change compares 1 of 2 clients that have both periods/);
    assert.match(html, /title="Change compares 1 of 2 clients that have both periods[^"]*"/);
    assert.match(html, /Open this card to load queries/);
    assert.match(html, /No agreement/);
    const list = renderToStaticMarkup(createElement(AgencyDashboardView, { model: partial, initialView: 'list' }));
    assert.match(list, /Open this card to load queries/);
});
