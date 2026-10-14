import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgencyDashboardView } from '../../components/agency-dashboard/AgencyDashboard.tsx';
import { Sparkline } from '../../components/agency-dashboard/Sparkline.tsx';
import { exampleDashboard } from './fixture.ts';
import { assembleDashboard } from './portfolio.ts';
import { bucketSpine, dashboardWindow, daysInclusive, formatDay } from './range.ts';

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
    assert.match(html, /data-tone="down"/);
    assert.match(html, /data-tone="up"/);
    assert.match(html, /aria-label="Filters"/);
    assert.match(html, /data-active-filters="0"/);
    assert.match(html, /aria-label="Color signal"/);
    assert.match(html, /Biggest declines/);
    assert.match(html, /aria-label="Metric"/);
    assert.match(html, /Card color: impressions vs previous 28 days, deeper = bigger move/);
    assert.equal(html.includes('>0<'), false);
    const kpi = html.indexOf('data-kpi="clicks"');
    const meta = html.indexOf('data-meta="summary"');
    const north = html.indexOf('data-client="north"');
    assert.equal(kpi !== -1 && kpi < meta && meta < north, true);
    const nextCard = html.indexOf('data-client="', north + 'data-client="'.length);
    const card = html.slice(north, nextCard === -1 ? undefined : nextCard);
    const front = card.slice(card.indexOf('data-face="front"'), card.indexOf('data-face="back"'));
    assert.match(html, /data-rank="1"/);
    assert.match(front, /text-\[28px\] font-bold/);
    assert.match(front, /Northline Plumbing/);
    const back = card.slice(card.indexOf('data-face="back"'));
    assert.match(back, /data-absolute/);
    assert.match(back, /emergency plumber/);
    assert.match(back, /Search Insights/);
    assert.match(back, /SEO Plan/);
    assert.match(back, /Open in GSC/);
    assert.match(html, /linearGradient/);
    const freshAt = html.indexOf('Fresh Start Co');
    const fresh = html.slice(Math.max(0, freshAt - 500), freshAt + 200);
    assert.match(fresh, /Not synced/);
    assert.match(fresh, /—/);
    for (const gone of ['Abel Miranda', 'Month 3', 'No agreement', 'Account manager', 'aria-label="Manager"']) {
        assert.equal(html.includes(gone), false, gone);
    }
});

test('the list view is a table of the same clients', () => {
    const html = render('list');
    assert.match(html, /<table/);
    assert.match(html, />Clicks</);
    assert.match(html, />Impressions</);
    assert.match(html, /Avg\. position/);
    assert.match(html, /Impression-weighted average/);
    assert.match(html, /Northline Plumbing/);
    assert.match(html, /Not synced/);
    assert.match(html, /Search Insights/);
    for (const gone of ['>Manager<', '>Hours<', '>Phase<', 'No agreement', 'Abel Miranda']) {
        assert.equal(html.includes(gone), false, gone);
    }
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
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: null, settling: false },
        clients: [
            { id: 'alpha', name: 'Alpha Co', domain: 'a.example', property: 'sc-domain:a.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'beta', name: 'Beta Co', domain: 'b.example', property: 'sc-domain:b.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
        ],
        aggregates: [
            { clientId: 'alpha', current: { clicks: 10, impressions: 100, positionWeight: 800, days: 7 }, previous: { clicks: 8, impressions: 80, positionWeight: 640, days: 7 }, series: [], queries: [{ query: 'alpha query', clicks: 3 }], incomplete: false },
            { clientId: 'beta', current: { clicks: 4, impressions: 40, positionWeight: 200, days: 7 }, previous: null, series: [], queries: [], queriesKnown: false, incomplete: false },
        ],
    });
    const html = renderToStaticMarkup(createElement(AgencyDashboardView, { model: partial }));
    assert.match(html, /1 of 2 clients/);
    assert.match(html, /Change compares 1 of 2 clients with a full previous period/);
    assert.match(html, /do not have enough history/);
    assert.match(html, /title="Change compares 1 of 2 clients with a full previous period[^"]*"/);
    assert.match(html, /Open this card to load queries/);
    assert.equal(html.includes('No agreement'), false);
    const list = renderToStaticMarkup(createElement(AgencyDashboardView, { model: partial, initialView: 'list' }));
    assert.equal(list.includes('Open this card to load queries'), false);
    assert.match(list, /Open in GSC/);
    assert.equal(list.includes('>GSC<'), false);
    assert.equal(list.includes('No agreement'), false);
});

test('a short previous window renders an em dash and says why', () => {
    const short = assembleDashboard({
        range: '7d',
        window: dashboardWindow('7d', '2026-10-07'),
        asOf: '2026-10-07',
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: null, settling: false },
        clients: [
            { id: 'short', name: 'Short History', domain: 'short.example', property: 'sc-domain:short.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
        ],
        aggregates: [
            { clientId: 'short', current: { clicks: 40, impressions: 400, positionWeight: 2000, days: 7 }, previous: { clicks: 5, impressions: 50, positionWeight: 400, days: 2 }, series: [], queries: [], incomplete: false },
        ],
    });
    const html = renderToStaticMarkup(createElement(AgencyDashboardView, { model: short }));
    assert.match(html, /Not enough history/);
    assert.match(html, /Not enough history to compare this range/);
    const front = html.slice(html.indexOf('data-face="front"'), html.indexOf('data-face="back"'));
    const back = html.slice(html.indexOf('data-face="back"'));
    assert.match(front, /Not enough history/);
    assert.match(back, /Search Insights/);
    assert.match(back, /SEO Plan/);
    assert.match(back, /Open in GSC/);
    const list = renderToStaticMarkup(createElement(AgencyDashboardView, { model: short, initialView: 'list' }));
    assert.match(list, /Not enough history/);
    for (const gone of ['Carlos Morones', '0 / 15h', 'No agreement', '>Manager<', '>Hours<', '>Phase<']) {
        assert.equal(html.includes(gone), false, gone);
        assert.equal(list.includes(gone), false, gone);
    }
});

test('a partial current period explains the dash and the sparkline keeps the full timeline', () => {
    const window = dashboardWindow('12m', '2026-10-13');
    const expected = daysInclusive(window.current.start, window.current.end);
    const spine = bucketSpine(window.current.start, window.current.end, window.bucket);
    const last = spine[spine.length - 1];
    const partial = assembleDashboard({
        range: '12m',
        window,
        asOf: '2026-10-13',
        freshness: { latestDataDate: '2026-10-13', latestImportedAt: null, settling: false },
        clients: [
            { id: 'partial', name: 'Giselle Rodriguez', domain: 'giselle.example', property: 'sc-domain:giselle.example', syncStatus: 'active', lastSyncedAt: '2026-10-13T00:00:00Z' },
        ],
        aggregates: [{
            clientId: 'partial',
            current: { clicks: 40, impressions: 400, positionWeight: 3200, days: 203 },
            previous: null,
            series: [{ bucket: last, clicks: 40, impressions: 400, positionWeight: 3200 }],
            queries: [],
            incomplete: false,
        }],
    });
    const html = renderToStaticMarkup(createElement(AgencyDashboardView, { model: partial }));
    assert.match(html, new RegExp(`Partial current period: 203 of ${expected} days`));
    assert.match(html, new RegExp(`Starts ${formatDay(last)}`));
    assert.match(html, /data-timeline="full"/);
    const line = renderToStaticMarkup(createElement(Sparkline, {
        values: [null, null, null, 1, 2],
        tone: 'up',
        label: 'Partial trend',
        stretch: true,
    }));
    assert.match(line, /data-timeline="full"/);
    assert.match(line, /x2="120"/);
    assert.match(line, /M90\.00/);
});
