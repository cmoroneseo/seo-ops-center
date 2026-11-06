import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BING_WEBMASTER_MEG_ORG_ID, BING_WEBMASTER_SANDBOX_ORG_ID, bingWebmasterEnabled } from '@/lib/bing/flags.ts';
import {
    SOURCE_LABEL,
    bingChartSeries,
    bingDualAxis,
    bingWeeklyPosition,
    buildBingDashboard,
    defaultSearchSource,
    gscChartSeries,
    gscDualAxis,
    gscKpis,
    gaKpis,
    pairedWindows,
    readGa4DailyPayload,
    visibleSources,
    type BingTrafficDay,
} from './model.ts';

const day = (date: string, incomplete = false) => ({ date, isIncomplete: incomplete });

test('the Bing tab follows the webmaster flag and allowlist, and Tracked is not a Search source', () => {
    assert.deepEqual(visibleSources(false), ['gsc', 'ga']);
    assert.equal(visibleSources(false).includes('bing'), false);
    assert.equal(JSON.stringify(visibleSources(bingWebmasterEnabled({} as NodeJS.ProcessEnv, BING_WEBMASTER_SANDBOX_ORG_ID))).includes('bing'), false);
    assert.equal(bingWebmasterEnabled({ BING_WEBMASTER: 'TRUE', BING_WEBMASTER_ORG_IDS: BING_WEBMASTER_SANDBOX_ORG_ID } as NodeJS.ProcessEnv, BING_WEBMASTER_SANDBOX_ORG_ID), false);
    const enabled = { BING_WEBMASTER: 'true', BING_WEBMASTER_ORG_IDS: BING_WEBMASTER_SANDBOX_ORG_ID } as NodeJS.ProcessEnv;
    assert.deepEqual(visibleSources(bingWebmasterEnabled(enabled, BING_WEBMASTER_SANDBOX_ORG_ID)), ['gsc', 'ga', 'bing']);
    assert.deepEqual(visibleSources(bingWebmasterEnabled(enabled, BING_WEBMASTER_MEG_ORG_ID)), ['gsc', 'ga']);
    assert.equal(SOURCE_LABEL.bing, 'Bing Webmaster');
    assert.equal(JSON.stringify(SOURCE_LABEL).includes('Tracked'), false);
});

test('the default tab is GSC, then GA, then Bing', () => {
    assert.equal(defaultSearchSource({ gsc: true, ga: true, bing: true }), 'gsc');
    assert.equal(defaultSearchSource({ gsc: false, ga: true, bing: true }), 'ga');
    assert.equal(defaultSearchSource({ gsc: false, ga: false, bing: true }), 'bing');
    assert.equal(defaultSearchSource({ gsc: false, ga: false, bing: false }), null);
});

test('the 28-day window ends on the last final day', () => {
    const days = [];
    for (let index = 0; index < 70; index += 1) {
        const date = new Date(Date.UTC(2026, 8, 1 + index)).toISOString().slice(0, 10);
        days.push(day(date, date > '2026-11-03'));
    }
    const window = pairedWindows(days, '2026-11-06');
    assert.equal(window?.current.end, '2026-11-03');
    assert.equal(window?.current.start, '2026-10-07');
    assert.equal(window?.prior.end, '2026-10-06');
    assert.equal(window?.comparable, true);
});

test('GSC draws clicks and impressions on two axes when both toggles are on', () => {
    const toggles = { clicks: true, impressions: true, position: false };
    const series = gscChartSeries(toggles);
    assert.equal(gscDualAxis(toggles), true);
    assert.deepEqual(series.map(item => item.id), ['clicks', 'impressions']);
    assert.notEqual(series[0]?.color, series[1]?.color);
    assert.equal(series[0]?.axis, 'left');
    assert.equal(series[1]?.axis, 'right');
    assert.equal(gscChartSeries({ clicks: true, impressions: false, position: false }).some(item => item.id === 'impressions'), false);
});

test('GA KPIs omit users and keep organic sessions as the primary series', () => {
    const row = readGa4DailyPayload({
        day: '2026-10-01',
        is_final: true,
        ga4_daily: { organic_sessions: 10, sessions: 20, engaged_sessions: 8, key_events: 1, users: 99, new_users: 4 },
    });
    assert.equal(row?.organicSessions, 10);
    assert.equal(JSON.stringify(row).toLowerCase().includes('user'), false);
    const kpis = gaKpis({ organicSessions: 10, sessions: 20, engagedSessions: 8, engagementRate: 0.4, keyEvents: 1 });
    assert.deepEqual(kpis.map(item => item.id), ['organicSessions', 'sessions', 'engagedSessions', 'engagementRate', 'keyEvents']);
    assert.equal(kpis.some(item => /user/i.test(item.label)), false);
});

test('Bing position is the weekly impression-weighted average and missing position stays blank', () => {
    assert.equal(bingWeeklyPosition([
        { impressions: 100, avgImpressionPosition: 10 },
        { impressions: 50, avgImpressionPosition: null },
        { impressions: 100, avgImpressionPosition: 20 },
    ]), 15);
    assert.equal(bingWeeklyPosition([{ impressions: 40, avgImpressionPosition: null }]), null);
    const toggles = { clicks: true, impressions: true };
    const series = bingChartSeries(toggles);
    assert.equal(bingDualAxis(toggles), true);
    assert.deepEqual(series.map(item => item.id), ['clicks', 'impressions']);
    assert.equal(series.some(item => item.id === 'position'), false);
    assert.notEqual(series[0]?.color, series[1]?.color);
});

test('a disconnected Bing client keeps the gap copy and does not invent KPIs', () => {
    const view = buildBingDashboard({
        link: null,
        traffic: [],
        queries: [],
        pages: [],
        window: { current: { start: '2026-10-07', end: '2026-11-03' }, prior: { start: '2026-09-09', end: '2026-10-06' }, comparable: true },
    });
    assert.equal(view.gap?.label, 'Bing: not connected');
    assert.equal(view.kpis.length, 0);
    assert.equal(view.points.length, 0);
});

test('Bing KPIs come from traffic days and weekly queries, not from GSC figures or click position', () => {
    const traffic: BingTrafficDay[] = [
        { date: '2026-10-07', clicks: 10, impressions: 100, queriesComplete: true, pagesComplete: true },
        { date: '2026-10-08', clicks: 5, impressions: 0, queriesComplete: true, pagesComplete: true },
    ];
    const view = buildBingDashboard({
        link: { syncStatus: 'active', lastSyncedAt: '2026-11-01T00:00:00Z' },
        traffic,
        queries: [{
            weekEnding: '2026-10-11',
            query: 'riverside seo',
            clicks: 4,
            impressions: 40,
            avgImpressionPosition: null,
            stale: false,
        }],
        pages: [{
            weekEnding: '2026-10-11',
            page: 'https://example.com/seo',
            clicks: 4,
            impressions: 40,
            avgImpressionPosition: 9,
        }],
        window: { current: { start: '2026-10-07', end: '2026-11-03' }, prior: { start: '2026-09-09', end: '2026-10-06' }, comparable: false },
    });
    assert.equal(view.gap, null);
    assert.equal(view.kpis.find(item => item.id === 'clicks')?.value, '15');
    assert.equal(view.kpis.find(item => item.id === 'impressions')?.value, '100');
    assert.equal(view.kpis.find(item => item.id === 'ctr')?.value, '15%');
    assert.equal(view.kpis.find(item => item.id === 'position')?.value, '—');
    assert.equal(view.kpis.some(item => item.label.includes('weekly')), true);
    assert.equal(view.queries[0]?.position, null);
    assert.equal(view.pages[0]?.position, 9);
    assert.equal(view.points.some(point => point.position != null), false);
    assert.notEqual(view.kpis.find(item => item.id === 'clicks')?.value, '1,240');
});

test('the Bing read does not select click position or call the Webmaster client', () => {
    const server = readFileSync(new URL('./bing-server.ts', import.meta.url), 'utf8');
    const route = readFileSync(new URL('../../app/api/search/bing/route.ts', import.meta.url), 'utf8');
    assert.equal(server.includes('avg_click_position'), false);
    assert.match(server, /avg_impression_position/);
    assert.equal(server.includes('lib/bing/client'), false);
    assert.match(route, /bingWebmasterEnabled/);
    assert.equal(route.includes('lib/bing/client'), false);
});

test('GSC versus prior stays blank when the windows are not comparable', () => {
    const cells = gscKpis({ clicks: 10, impressions: 20, ctr: 0.5, position: 4 }, null);
    assert.equal(cells.find(item => item.id === 'vs-prior')?.value, '—');
});
