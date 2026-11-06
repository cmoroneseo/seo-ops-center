import test from 'node:test';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SearchDashboardView } from '../../components/search-dashboard/SearchDashboardView.tsx';
import { bingChartSeries, gaChartSeries, gscChartSeries, gscKpis, gaKpis, type BingDashboard } from './model.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const noop = () => {};

function view(patch: Record<string, unknown> = {}) {
    const gscToggles = { clicks: true, impressions: true, position: false };
    const gaToggles = { sessions: false, keyEvents: true };
    const bingToggles = { clicks: true, impressions: true };
    return renderToStaticMarkup(createElement(SearchDashboardView, {
        clientName: 'Marketing Empire',
        clientId: 'client',
        organizationId: 'org',
        sources: ['gsc', 'ga'],
        source: 'gsc',
        onSource: noop,
        windowLabel: 'Last 28 days · Oct 7–Nov 3 vs Sep 9–Oct 6',
        loading: false,
        showTrack: true,
        gscConnected: true,
        gscError: '',
        gscKpis: gscKpis({ clicks: 40, impressions: 400, ctr: 0.1, position: 8.2 }, { clicks: 20, impressions: 200, ctr: 0.1, position: 9 }),
        gscPoints: [
            { date: '2026-10-07', clicks: 10, impressions: 100 },
            { date: '2026-10-08', clicks: 12, impressions: 140 },
        ],
        gscSeries: gscChartSeries(gscToggles),
        gscToggles,
        onGscToggle: noop,
        queries: [{ query: 'seo agency riverside', topPage: '/services/seo', position: 6.2, clicks: 86, impressions: 2100 }],
        pages: [{ page: '/services/seo', position: 6.2, clicks: 86, impressions: 2100 }],
        section: 'queries',
        onSection: noop,
        tableError: '',
        hiddenQueries: 0,
        hiddenPages: 0,
        gaConnected: true,
        gaError: '',
        gaKpis: gaKpis({ organicSessions: 12, sessions: 20, engagedSessions: 8, engagementRate: 0.4, keyEvents: 3 }),
        gaPoints: [{ date: '2026-10-07', organicSessions: 12, sessions: 20, keyEvents: 3 }],
        gaSeries: gaChartSeries(gaToggles),
        gaToggles,
        onGaToggle: noop,
        bingEnabled: false,
        bing: null,
        bingToggles,
        onBingToggle: noop,
        bingSeries: bingChartSeries(bingToggles),
        onConnections: noop,
        ...patch,
    }));
}

test('the source switcher is a compact outlined control and Tracked is absent', () => {
    const html = view();
    const switcher = html.slice(html.indexOf('data-source-switcher'), html.indexOf('data-kpi-strip'));
    assert.match(switcher, /data-source-switcher="compact"/);
    assert.match(switcher, /inline-flex/);
    assert.match(switcher, /bg-\[#141418\]/);
    assert.match(switcher, /bg-\[#1c1c22\]/);
    assert.match(switcher, /Google Search Console/);
    assert.match(switcher, /Google Analytics/);
    assert.equal(switcher.includes('bg-primary'), false);
    assert.equal(switcher.includes(' w-full'), false);
    assert.equal(html.includes('Tracked keywords'), false);
    assert.equal(html.includes('Semrush'), false);
    assert.equal(html.includes('BING_WEBMASTER'), false);
});

test('GSC plots both series and keeps Queries under the chart', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    const html = view();
    if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    assert.match(html, /data-dual-axis="true"/);
    assert.match(html, /data-series-id="clicks" data-stroke="var\(--chart-1\)"/);
    assert.match(html, /data-series-id="impressions" data-stroke="var\(--chart-4\)"/);
    assert.match(html, /aria-label="Search Insights"/);
    assert.match(html, /seo agency riverside/);
    assert.match(html, /data-track-query="seo agency riverside"/);
    assert.match(html, />Queries</);
    assert.match(html, />Pages</);
});

test('GA omits users and can draw organic sessions with key events', () => {
    const html = view({ source: 'ga' });
    assert.equal(/\bUsers\b/.test(html), false);
    assert.match(html, /Organic sessions/);
    assert.match(html, /Key events/);
    assert.match(html, /data-series-id="organicSessions"/);
    assert.match(html, /data-series-id="keyEvents"/);
    assert.notEqual(
        html.match(/data-series-id="organicSessions" data-stroke="([^"]+)"/)?.[1],
        html.match(/data-series-id="keyEvents" data-stroke="([^"]+)"/)?.[1],
    );
    assert.match(html, /data-dual-axis="true"/);
});

test('Bing shows weekly queries without a Track action or a position series', () => {
    const bing: BingDashboard = {
        gap: null,
        syncWarning: null,
        kpis: [
            { id: 'clicks', label: 'Clicks', value: '412', tone: null },
            { id: 'impressions', label: 'Impressions', value: '18.6k', tone: null },
            { id: 'ctr', label: 'CTR', value: '2.2%', tone: null },
            { id: 'position', label: 'Avg position · weekly', value: '12.8', tone: null },
            { id: 'vs-prior', label: 'vs prior', value: '↑ 6%', tone: 'good' },
        ],
        points: [
            { date: '2026-10-07', clicks: 20, impressions: 400 },
            { date: '2026-10-08', clicks: 18, impressions: 360 },
        ],
        queries: [{ label: 'seo agency near me', clicks: 54, impressions: 1400, position: 9.1 }],
        pages: [],
        queriesNote: null,
        pagesNote: null,
        hiddenQueries: 0,
        hiddenPages: 0,
    };
    const html = view({
        sources: ['gsc', 'ga', 'bing'],
        source: 'bing',
        bingEnabled: true,
        bing,
        section: 'queries',
    });
    assert.match(html, /Bing Webmaster/);
    assert.match(html, /Avg position · weekly/);
    assert.match(html, />weekly</);
    assert.match(html, /seo agency near me/);
    assert.match(html, /data-series-id="clicks"/);
    assert.match(html, /data-series-id="impressions"/);
    assert.match(html, /data-dual-axis="true"/);
    assert.equal(html.includes('data-series-id="position"'), false);
    assert.equal(html.includes('data-track-query'), false);
    assert.equal(html.includes('Avg position</'), false);
});

test('an unconnected Bing tab uses the gap title and skips the designer caption', () => {
    const html = view({
        sources: ['gsc', 'ga', 'bing'],
        source: 'bing',
        bingEnabled: true,
        bing: {
            gap: { label: 'Bing: not connected', title: null },
            syncWarning: null,
            kpis: [],
            points: [],
            queries: [],
            pages: [],
            queriesNote: null,
            pagesNote: null,
            hiddenQueries: 0,
            hiddenPages: 0,
        },
    });
    assert.match(html, /Bing: not connected/);
    assert.match(html, /Connect Bing Webmaster for this client/);
    assert.equal(html.includes('example empty state'), false);
    assert.equal(html.includes('data-kpi-strip'), false);
    assert.equal(html.includes('data-dual-axis'), false);
});
