import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleDashboard } from './portfolio.ts';
import { dashboardWindow } from './range.ts';
import {
    BING_CONNECTED_NO_DATA,
    BING_CONNECTED_NO_DATA_TITLE,
    BING_LINK_COLUMNS,
    BING_PAGE_COLUMNS,
    attachBingDashboard,
    bingPosition,
    engineHeadline,
    parseBingPayload,
    readBingPageRow,
} from './bing.ts';
import { summarizeSelection } from './portfolio.ts';

test('Bing position divides by positioned impressions and a negative average is empty', () => {
    assert.equal(bingPosition(750, 50), 15);
    assert.equal(bingPosition(750, 0), null);
    assert.equal(bingPosition(null, 50), null);
    assert.equal(bingPosition(-1, 50), null);
});

test('a missing click position does not reject the Bing payload', () => {
    const parsed = parseBingPayload({
        current: [{ clientId: 'north', clicks: 18, impressions: 70, days: 7, positionWeight: 750, positionImpressions: 50, queriesComplete: true, pagesComplete: true }],
        previous: [],
        series: [
            { clientId: 'north', bucket: '2026-10-01', clicks: 8, impressions: 20 },
            { clientId: 'north', bucket: '2026-10-02', clicks: 10, impressions: 30 },
        ],
        positionSeries: [{ clientId: 'north', weekEnding: '2026-10-04', positionWeight: 750, positionImpressions: 50 }],
        queries: [{
            clientId: 'north',
            stale: false,
            queries: [{ query: 'bing plumber', clicks: 11, impressions: 40, avgImpressionPosition: 4.5, avgClickPosition: -1 }],
        }],
    }, ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'], 'day');
    const north = parsed.get('north')!;
    assert.equal(north.current?.clicks, 18);
    assert.equal(north.points[0]?.clicks, 8);
    assert.equal(north.points[3]?.positionWeight, 750);
    assert.equal(north.points[4], null);
    assert.equal(JSON.stringify(north.queries).split('avgClickPosition').length, 1);
    assert.equal(north.queries[0].position, 4.5);
});

test('All mode combines CTR and Bing mode weights position across clients', () => {
    const model = attachBingDashboard(assembleDashboard({
        range: '7d',
        window: dashboardWindow('7d', '2026-10-07'),
        asOf: '2026-10-07',
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: null, settling: false },
        clients: [
            { id: 'alpha', name: 'Alpha', domain: 'alpha.example', property: 'sc-domain:alpha.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'beta', name: 'Beta', domain: 'beta.example', property: 'sc-domain:beta.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'gap', name: 'Gap', domain: 'gap.example', property: 'sc-domain:gap.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
        ],
        aggregates: [
            { clientId: 'alpha', current: { clicks: 10, impressions: 100, positionWeight: 500, days: 7 }, previous: { clicks: 8, impressions: 80, positionWeight: 400, days: 7 }, series: [], queries: [], incomplete: false },
            { clientId: 'beta', current: { clicks: 10, impressions: 100, positionWeight: 500, days: 7 }, previous: { clicks: 8, impressions: 80, positionWeight: 400, days: 7 }, series: [], queries: [], incomplete: false },
        ],
    }), {
        bucket: 'day',
        expectedDays: 7,
        expectedPreviousDays: 7,
        links: [
            { clientId: 'alpha', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z', siteUrl: 'https://alpha.example/' },
            { clientId: 'beta', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z', siteUrl: 'https://beta.example/' },
        ],
        payload: {
            current: [
                { clientId: 'alpha', clicks: 30, impressions: 100, days: 7, positionWeight: 100, positionImpressions: 10, queriesComplete: true, pagesComplete: true },
                { clientId: 'beta', clicks: 30, impressions: 100, days: 7, positionWeight: 900, positionImpressions: 30, queriesComplete: true, pagesComplete: false },
            ],
            previous: [
                { clientId: 'alpha', clicks: 10, impressions: 50, days: 7, positionWeight: 40, positionImpressions: 10 },
                { clientId: 'beta', clicks: 10, impressions: 50, days: 7, positionWeight: 80, positionImpressions: 10 },
            ],
            series: [],
            positionSeries: [],
            queries: [
                { clientId: 'alpha', stale: false, queries: [] },
                { clientId: 'beta', stale: false, queries: [] },
            ],
        },
        pages: [],
    });

    const alpha = model.cards.find(card => card.clientId === 'alpha')!;
    assert.equal(alpha.bing?.metrics.position.value, 10);
    assert.equal(alpha.bing?.combinedCtr.value, 40 / 200);
    assert.equal(alpha.metrics.ctr.value, 0.1);
    assert.equal(alpha.bing?.clickShare, 30 / 40);
    assert.equal(model.cards.find(card => card.clientId === 'gap')?.bing?.reasonLabel, 'Bing: not connected');
    assert.equal(model.cards.find(card => card.clientId === 'beta')?.bing?.pagesReason, 'Pages were not stored for this range');

    const google = summarizeSelection(model, model.cards);
    const all = engineHeadline(google, model.cards, 'all');
    assert.equal(all.kpis.clicks.value, 20);
    assert.equal(all.kpis.ctr.value, 80 / 400);
    assert.equal(all.kpis.position.value, google.kpis.position.value);
    assert.equal(all.overlay?.clicks != null, true);

    const bing = engineHeadline(google, model.cards, 'bing');
    assert.equal(bing.kpis.position.value, 1000 / 40);
    assert.equal(bing.kpis.position.value, 25);
    assert.equal(bing.kpis.clicks.value, 60);
    assert.equal(bing.overlay, null);
});

test('a linked client with no rows in range says Bing is connected', () => {
    const model = attachBingDashboard(assembleDashboard({
        range: '7d',
        window: dashboardWindow('7d', '2026-10-07'),
        asOf: '2026-10-07',
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: null, settling: false },
        clients: [
            { id: 'idle', name: 'Idle Range', domain: 'idle.example', property: 'sc-domain:idle.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
            { id: 'fresh', name: 'Fresh', domain: 'fresh.example', property: 'sc-domain:fresh.example', syncStatus: 'active', lastSyncedAt: null },
        ],
        aggregates: [
            { clientId: 'idle', current: { clicks: 4, impressions: 40, positionWeight: 200, days: 7 }, previous: null, series: [], queries: [], incomplete: false },
        ],
    }), {
        bucket: 'day',
        expectedDays: 7,
        expectedPreviousDays: 7,
        links: [
            { clientId: 'idle', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z', siteUrl: 'https://idle.example/' },
            { clientId: 'fresh', syncStatus: 'active', lastSyncedAt: null, siteUrl: 'https://fresh.example/' },
        ],
        payload: EMPTY_BING,
        pages: [],
    });
    const idle = model.cards.find(card => card.clientId === 'idle')!;
    assert.equal(idle.reason, null);
    assert.equal(idle.metrics.clicks.value, 4);
    assert.equal(idle.bing?.connected, true);
    assert.equal(idle.bing?.reason, 'no_data');
    assert.equal(idle.bing?.reasonLabel, BING_CONNECTED_NO_DATA);
    assert.equal(idle.bing?.reasonTitle, BING_CONNECTED_NO_DATA_TITLE);
    assert.equal(model.cards.find(card => card.clientId === 'fresh')?.bing?.reasonLabel, 'Not synced');
    assert.equal(model.cards.find(card => card.clientId === 'fresh')?.bing?.reasonTitle, null);
});

const EMPTY_BING = { current: [], previous: [], series: [], positionSeries: [], queries: [] };

test('a bad Bing payload keeps Google and uses a fixed reason', () => {
    const model = attachBingDashboard(assembleDashboard({
        range: '7d',
        window: dashboardWindow('7d', '2026-10-07'),
        asOf: '2026-10-07',
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: null, settling: false },
        clients: [
            { id: 'alpha', name: 'Alpha', domain: 'alpha.example', property: 'sc-domain:alpha.example', syncStatus: 'active', lastSyncedAt: '2026-10-12T00:00:00Z' },
        ],
        aggregates: [
            { clientId: 'alpha', current: { clicks: 10, impressions: 100, positionWeight: 500, days: 7 }, previous: null, series: [], queries: [], incomplete: false },
        ],
    }), {
        bucket: 'day',
        expectedDays: 7,
        expectedPreviousDays: 7,
        payload: { current: 'broken' },
    });
    assert.equal(model.cards[0].metrics.clicks.value, 10);
    assert.equal(model.cards[0].bing?.reasonLabel, 'Bing data could not be loaded');
    assert.equal(JSON.stringify(model).split('broken').length, 1);
});

test('page rows keep impression position and drop a negative click position', () => {
    const row = readBingPageRow({
        client_id: 'north',
        site_url: 'https://north.example/',
        page: 'https://north.example/repairs',
        clicks: '6',
        impressions: 30,
        avg_impression_position: 3,
        avg_click_position: -1,
        week_ending: '2026-10-04',
    });
    assert.equal(row?.avgImpressionPosition, 3);
    assert.equal(JSON.stringify(row).split('avg_click_position').length, 1);
    assert.equal(JSON.stringify(row).split('avgClickPosition').length, 1);
    assert.equal(BING_PAGE_COLUMNS.split('avg_click').length, 1);
    assert.equal(BING_LINK_COLUMNS.split('token').length, 1);
    assert.equal(BING_PAGE_COLUMNS, 'client_id, site_url, page, clicks, impressions, avg_impression_position, week_ending');
});
