import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgencyDashboardView } from '../../components/agency-dashboard/AgencyDashboard.tsx';
import { attachBingDashboard } from './bing.ts';
import { exampleDashboard } from './fixture.ts';
import { attachGa4Dashboard, type Ga4Aggregate } from './ga4.ts';
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
    assert.equal(html.includes('data-rank='), false);
    assert.equal(html.includes('>#<'), false);
    assert.equal(front.includes('text-[28px]'), false);
    assert.match(front, /Northline Plumbing/);
    assert.equal(html.includes('aria-label="Search engine"'), false);
    assert.equal(html.includes('aria-label="Card metric"'), false);
    assert.equal(html.includes('data-curve="monotone"'), false);
    assert.equal(html.includes('Connect GA4'), false);
    const back = card.slice(card.indexOf('data-face="back"'));
    assert.match(back, /data-absolute/);
    assert.match(back, /emergency plumber/);
    assert.match(back, /Search Insights/);
    assert.match(back, /SEO Plan/);
    assert.match(back, /Open in GSC/);
    assert.match(html, /linearGradient/);
    const freshAt = html.indexOf('Fresh Start Co');
    const fresh = html.slice(Math.max(0, freshAt - 200), freshAt + 500);
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
    assert.equal(html.includes('>#<'), false);
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
    assert.match(html, /Change compares 1 of 2 clients that have both periods/);
    assert.match(html, /title="Change compares 1 of 2 clients that have both periods[^"]*"/);
    assert.match(html, /Open this card to load queries/);
    assert.equal(html.includes('No agreement'), false);
    const list = renderToStaticMarkup(createElement(AgencyDashboardView, { model: partial, initialView: 'list' }));
    assert.match(list, /Open this card to load queries/);
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

function bingDashboard() {
    const base = assembleDashboard({
        range: '7d',
        window: dashboardWindow('7d', '2026-10-07'),
        asOf: '2026-10-07',
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: null, settling: false },
        clients: [
            { id: 'north', name: 'Northline Plumbing', domain: 'north.example', property: 'sc-domain:north.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'harbor', name: 'Harbor Dental', domain: 'harbor.example', property: 'sc-domain:harbor.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'idle', name: 'Idle Range', domain: 'idle.example', property: 'sc-domain:idle.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'quiet', name: 'Quiet Studio', domain: 'quiet.example', property: 'sc-domain:quiet.example', syncStatus: 'active', lastSyncedAt: null },
        ],
        aggregates: [
            {
                clientId: 'north',
                current: { clicks: 82, impressions: 400, positionWeight: 2000, days: 7 },
                previous: { clicks: 80, impressions: 400, positionWeight: 2400, days: 7 },
                series: [
                    { bucket: '2026-10-01', clicks: 10, impressions: 40, positionWeight: 200 },
                    { bucket: '2026-10-02', clicks: 12, impressions: 50, positionWeight: 250 },
                ],
                queries: [{ query: 'emergency plumber', clicks: 9 }],
                incomplete: false,
            },
        ],
    });
    return attachBingDashboard(base, {
        bucket: 'day',
        expectedDays: 7,
        expectedPreviousDays: 7,
        links: [
            { clientId: 'north', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z', siteUrl: 'https://north.example/' },
            { clientId: 'idle', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z', siteUrl: 'https://idle.example/' },
            { clientId: 'quiet', syncStatus: 'active', lastSyncedAt: null, siteUrl: 'https://quiet.example/' },
        ],
        payload: {
            current: [{ clientId: 'north', clicks: 18, impressions: 100, days: 7, positionWeight: 750, positionImpressions: 50, queriesComplete: true, pagesComplete: true }],
            previous: [{ clientId: 'north', clicks: 10, impressions: 80, days: 7, positionWeight: 400, positionImpressions: 40 }],
            series: [
                { clientId: 'north', bucket: '2026-10-01', clicks: 8, impressions: 40 },
                { clientId: 'north', bucket: '2026-10-02', clicks: 10, impressions: 60 },
            ],
            positionSeries: [{ clientId: 'north', weekEnding: '2026-10-04', positionWeight: 750, positionImpressions: 50 }],
            queries: [{
                clientId: 'north',
                stale: false,
                queries: [{ query: 'bing plumber', clicks: 11, impressions: 40, avgImpressionPosition: null, avgClickPosition: -1 }],
            }],
        },
        pages: [
            { clientId: 'north', siteUrl: 'https://north.example/', page: 'https://north.example/repairs', clicks: 6, impressions: 30, avgImpressionPosition: 3, weekEnding: '2026-10-04' },
            { clientId: 'north', siteUrl: 'https://other.example/', page: 'https://other.example/secret', clicks: 99, impressions: 99, avgImpressionPosition: 1, weekEnding: '2026-10-04' },
        ],
    });
}

test('the engine toggle defaults to Google and All mode draws Bing without rank numbers', () => {
    const model = bingDashboard();
    const google = renderToStaticMarkup(createElement(AgencyDashboardView, { model }));
    assert.match(google, /aria-label="Search engine"/);
    assert.match(google, /data-engine-option="google"[^>]*aria-pressed="true"/);
    assert.equal(google.includes('stroke-dasharray'), false);
    assert.equal(google.includes('Bing 18% of clicks'), false);
    assert.equal(google.includes('data-rank='), false);
    assert.equal(google.includes('>#<'), false);
    assert.equal(google.includes('Bing: connected · no data yet'), false);

    const all = renderToStaticMarkup(createElement(AgencyDashboardView, { model, initialEngine: 'all' }));
    assert.match(all, /data-engine-option="all"[^>]*aria-pressed="true"/);
    assert.match(all, /Bing 18% of clicks/);
    assert.match(all, /stroke-dasharray="4 3"/);
    assert.match(all, /Dashed line is Bing/);
    assert.match(all, /Bing: not connected/);
    const north = all.slice(all.indexOf('data-client="north"'), all.indexOf('data-client="harbor"'));
    const northFront = north.slice(north.indexOf('data-face="front"'), north.indexOf('data-face="back"'));
    assert.match(northFront, />82</);
    assert.match(northFront, /20\.0%/);
    assert.equal(northFront.includes('20.5%'), false);
    const back = north.slice(north.indexOf('data-face="back"'));
    assert.match(back, /data-bing="panel"/);
    assert.match(back, /Top pages/);
    assert.match(back, /\/repairs/);
    assert.match(back, /bing plumber/);
    assert.match(back, /No impression position/);
    assert.equal(back.includes('secret'), false);
    assert.equal(back.includes('avgClickPosition'), false);
    assert.equal(all.includes('data-rank='), false);

    const bing = renderToStaticMarkup(createElement(AgencyDashboardView, { model, initialEngine: 'bing' }));
    const harbor = bing.slice(bing.indexOf('data-client="harbor"'), bing.indexOf('data-client="quiet"'));
    const harborFront = harbor.slice(harbor.indexOf('data-face="front"'), harbor.indexOf('data-face="back"'));
    assert.match(harborFront, /—/);
    assert.match(harborFront, /Bing: not connected/);
    const quiet = bing.slice(bing.indexOf('data-client="quiet"'));
    const quietFront = quiet.slice(quiet.indexOf('data-face="front"'), quiet.indexOf('data-face="back"'));
    assert.match(quietFront, /—/);
    assert.match(quietFront, /Not synced/);
    const idle = bing.slice(bing.indexOf('data-client="idle"'), bing.indexOf('data-client="quiet"'));
    const idleFront = idle.slice(idle.indexOf('data-face="front"'), idle.indexOf('data-face="back"'));
    assert.match(idleFront, /Bing: connected · no data yet/);
    assert.match(idleFront, /title="Bing has no data for this site in this range"/);
    assert.equal(idleFront.includes('Bing: not connected'), false);
    const northBing = bing.slice(bing.indexOf('data-client="north"'), bing.indexOf('data-client="harbor"'));
    assert.match(northBing, /15\.0/);
    assert.equal(northBing.includes('7.5'), false);

    const list = renderToStaticMarkup(createElement(AgencyDashboardView, { model, initialEngine: 'all', initialView: 'list' }));
    assert.equal(list.includes('>#<'), false);
    assert.match(list, /Bing 18% of clicks/);
    assert.match(list, /Bing: not connected/);
});

function ga4CardsModel() {
    const base = assembleDashboard({
        range: '28d',
        window: dashboardWindow('28d', '2026-10-07'),
        asOf: '2026-10-07',
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: null, settling: false },
        clients: [
            { id: 'vita', name: 'VitaTherapy Wellness', domain: 'vita.example', property: 'sc-domain:vita.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'scott', name: 'Scott Cole & Associates', domain: 'scott.example', property: 'sc-domain:scott.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'zero', name: 'Zero Measured', domain: 'zero.example', property: 'sc-domain:zero.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'empty', name: 'Empty History', domain: 'empty.example', property: 'sc-domain:empty.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
        ],
        aggregates: [
            { clientId: 'vita', current: { clicks: 900, impressions: 4000, positionWeight: 20000, days: 28 }, previous: { clicks: 800, impressions: 4000, positionWeight: 22000, days: 28 }, series: [{ bucket: '2026-09-10', clicks: 30, impressions: 140, positionWeight: 700 }, { bucket: '2026-09-11', clicks: 40, impressions: 150, positionWeight: 750 }], queries: [], incomplete: false },
            { clientId: 'scott', current: { clicks: 10, impressions: 100, positionWeight: 800, days: 28 }, previous: { clicks: 8, impressions: 80, positionWeight: 640, days: 28 }, series: [], queries: [], incomplete: false },
            { clientId: 'zero', current: { clicks: 4, impressions: 40, positionWeight: 200, days: 28 }, previous: { clicks: 4, impressions: 40, positionWeight: 200, days: 28 }, series: [], queries: [], incomplete: false },
            { clientId: 'empty', current: { clicks: 4, impressions: 40, positionWeight: 200, days: 28 }, previous: { clicks: 4, impressions: 40, positionWeight: 200, days: 28 }, series: [], queries: [], incomplete: false },
        ],
    });
    const series = base.buckets.map((bucket, index) => ({
        bucket,
        organicSessions: 400 + index,
        keyEvents: 10 + (index % 3),
    }));
    const aggregate: Ga4Aggregate = {
        clients: [
            {
                clientId: 'vita',
                current: { organicSessions: 12480, sessions: 20400, engagedSessions: 12485, keyEvents: 342, days: 28 },
                previous: { organicSessions: 10541, sessions: 18000, engagedSessions: 11016, keyEvents: 300, days: 28 },
                series,
            },
            {
                clientId: 'zero',
                current: { organicSessions: 0, sessions: 0, engagedSessions: 0, keyEvents: 0, days: 28 },
                previous: { organicSessions: 0, sessions: 8, engagedSessions: 0, keyEvents: 0, days: 28 },
                series: base.buckets.map(bucket => ({ bucket, organicSessions: 0, keyEvents: 0 })),
            },
            {
                clientId: 'empty',
                current: { organicSessions: null, sessions: null, engagedSessions: null, keyEvents: null, days: 28 },
                previous: null,
                series: [],
            },
        ],
    };
    return attachGa4Dashboard(base, {
        links: [
            { clientId: 'vita', property: 'properties/1' },
            { clientId: 'zero', property: 'properties/2' },
            { clientId: 'empty', property: 'properties/3' },
        ],
        aggregate,
        expectedPreviousDays: 28,
    });
}

function cardFront(html: string, clientId: string): string {
    const start = html.indexOf(`data-client="${clientId}"`);
    const next = html.indexOf('data-client="', start + 1);
    const card = html.slice(start, next === -1 ? undefined : next);
    return card.slice(card.indexOf('data-face="front"'), card.indexOf('data-face="back"'));
}

test('the GA4 toggle follows the metric, and an unmapped client is an em dash', () => {
    const model = ga4CardsModel();
    const hidden = renderToStaticMarkup(createElement(AgencyDashboardView, { model }));
    assert.equal(hidden.includes('aria-label="Card metric"'), false);
    assert.equal(hidden.includes('Connect GA4'), false);
    assert.match(hidden, /aria-label="Metric"/);

    const organic = renderToStaticMarkup(createElement(AgencyDashboardView, {
        model,
        ga4Cards: true,
        initialCardMetric: 'organic-sessions',
    }));
    assert.match(organic, /aria-label="Card metric"/);
    assert.match(organic, /data-card-metric="organic-sessions"[^>]*aria-pressed="true"/);
    assert.match(organic, /data-card-metric="clicks"[^>]*aria-pressed="false"/);
    assert.match(organic, /aria-label="Filters"/);
    assert.equal(organic.includes('aria-label="Metric"'), false);
    assert.equal(organic.includes('data-rank='), false);
    assert.equal(organic.includes('>#<'), false);
    assert.equal((organic.match(/<button[^>]*aria-label="Filters"/g) ?? []).length, 1);
    for (const gone of ['Account manager', '>Manager<', '>Hours<', '>Phase<', 'No agreement', 'Abel Miranda', 'Carlos Morones']) {
        assert.equal(organic.includes(gone), false, gone);
    }

    const vita = cardFront(organic, 'vita');
    assert.match(vita, /VitaTherapy Wellness/);
    assert.match(vita, /Organic sessions · 28D/);
    assert.match(vita, /data-hero[^>]*>12,480</);
    assert.match(vita, /18\.4%/);
    assert.match(vita, /data-tone="up"/);
    assert.match(vita, /data-curve="monotone"/);
    assert.match(vita, /Sessions/);
    assert.match(vita, /Engagement rate/);
    assert.match(vita, /61\.2%/);
    assert.match(vita, /Key events/);
    assert.match(vita, />342</);
    assert.equal(vita.includes('>Pos<'), false);
    assert.equal(vita.includes('>CTR<'), false);

    const scott = cardFront(organic, 'scott');
    assert.match(scott, /data-ga4="unmapped"/);
    assert.match(scott, /GA4 not connected/);
    assert.match(scott, /Connect GA4/);
    assert.match(scott, /href="\/workspace\/scott\?tab=integrations&amp;picker=ga4"/);
    assert.match(scott, /data-hero[^>]*>—</);
    assert.equal(scott.includes('>0<'), false);
    assert.equal(scott.includes('>0.0%<'), false);
    for (const stat of ['sessions', 'engagementRate', 'keyEvents']) {
        const block = scott.slice(scott.indexOf(`data-ga4-stat="${stat}"`));
        assert.match(block, /—/);
    }

    const zero = cardFront(organic, 'zero');
    assert.match(zero, /data-hero[^>]*>0</);
    assert.equal(zero.includes('Connect GA4'), false);
    const zeroRate = zero.slice(zero.indexOf('data-ga4-stat="engagementRate"'));
    assert.match(zeroRate, /—/);

    const empty = cardFront(organic, 'empty');
    assert.match(empty, /data-hero[^>]*>—</);
    assert.match(empty, /No data in this range/);
    assert.equal(empty.includes('Connect GA4'), false);
    assert.equal(empty.includes('>0<'), false);

    const clicks = renderToStaticMarkup(createElement(AgencyDashboardView, {
        model,
        ga4Cards: true,
        initialCardMetric: 'clicks',
    }));
    const clicksFront = cardFront(clicks, 'vita');
    assert.match(clicksFront, /Clicks · 28D/);
    assert.match(clicksFront, />Pos</);
    assert.match(clicksFront, />CTR</);
    assert.match(clicksFront, />Impressions</);
    assert.equal(clicksFront.includes('Engagement rate'), false);
    assert.equal(clicksFront.includes('Connect GA4'), false);
    assert.match(clicksFront, /data-curve="monotone"/);

    const events = renderToStaticMarkup(createElement(AgencyDashboardView, {
        model,
        ga4Cards: true,
        initialCardMetric: 'key-events',
    }));
    const eventsFront = cardFront(events, 'vita');
    assert.match(eventsFront, /Key events · 28D/);
    assert.match(eventsFront, /data-hero[^>]*>342</);
    assert.match(events, /data-card-metric="key-events"[^>]*aria-pressed="true"/);

    const list = renderToStaticMarkup(createElement(AgencyDashboardView, {
        model,
        ga4Cards: true,
        initialCardMetric: 'organic-sessions',
        initialView: 'list',
    }));
    assert.equal(list.includes('>#<'), false);
    assert.match(list, /data-ga4-list="unmapped"/);
    assert.match(list, /Connect GA4/);
    assert.equal(list.includes('>Manager<'), false);
});
