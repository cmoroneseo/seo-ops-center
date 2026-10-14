import test from 'node:test';
import assert from 'node:assert/strict';
import type { ClientAgreement } from '@/lib/agreements/types';
import { parseAgencyAggregate } from './aggregate.ts';
import {
    cardTint,
    changeTone,
    compareCards,
    formatChange,
    formatMetric,
    metricValue,
    percentChange,
    type SortState,
} from './metrics.ts';
import { assembleDashboard, filterCards, type DashboardClientInput } from './portfolio.ts';
import { bucketStart, dashboardWindow, daysInclusive } from './range.ts';

const today = '2026-10-14';
const month = '2026-10';

function agreement(startsOn: string): ClientAgreement {
    return {
        id: 'ag-1', organizationId: 'org', clientId: 'a', previousId: null, kind: 'initial', title: 'Retainer',
        startsOn, endsOn: null, mode: 'monthly', hours: 40, hoursMode: 'committed', proration: 'full_period',
        timezone: 'America/Los_Angeles', scope: '', services: [], evidence: null, note: null,
        recordedAt: startsOn, recordedBy: 'user', planSnapshot: null,
    };
}

function client(patch: Partial<DashboardClientInput> & Pick<DashboardClientInput, 'id' | 'name'>): DashboardClientInput {
    return {
        domain: 'example.com',
        accountManager: 'Abel Miranda',
        seoHours: 10,
        property: 'sc-domain:example.com',
        syncStatus: 'active',
        lastSyncedAt: '2026-10-12T18:00:00Z',
        loggedHours: 18,
        agreements: [],
        agreementsKnown: true,
        ...patch,
    };
}

function totals(clicks: number, impressions: number, position: number | null, days = 7) {
    return {
        clicks,
        impressions,
        positionWeight: position == null || impressions <= 0 ? null : position * impressions,
        days,
    };
}

test('ranges end on the latest stored day and the previous window abuts them', () => {
    const week = dashboardWindow('7d', '2026-10-07');
    assert.deepEqual(week.current, { start: '2026-10-01', end: '2026-10-07' });
    assert.deepEqual(week.previous, { start: '2026-09-24', end: '2026-09-30' });
    assert.equal(week.bucket, 'day');
    assert.equal(daysInclusive(week.current.start, week.current.end), daysInclusive(week.previous.start, week.previous.end));
    assert.equal(week.previous.end < week.current.start, true);

    const quarter = dashboardWindow('3m', '2026-10-07');
    assert.equal(quarter.current.end, '2026-10-07');
    assert.equal(quarter.current.start, '2026-07-08');
    assert.equal(quarter.previous.end, '2026-07-07');
    assert.equal(quarter.bucket, 'week');
    assert.equal(dashboardWindow('12m', '2026-10-07').bucket, 'month');
    assert.equal(dashboardWindow('28d', '2026-10-07').bucket, 'day');
    assert.equal(bucketStart('2026-10-07', 'week'), '2026-10-05');
    assert.equal(bucketStart('2026-10-04', 'week'), '2026-09-28');
    assert.equal(bucketStart('2026-10-07', 'month'), '2026-10-01');
});

test('CTR and position are weighted, and a missing period is not a zero', () => {
    const current = totals(10, 200, 8);
    assert.equal(metricValue(current, 'ctr'), 0.05);
    assert.equal(metricValue(current, 'position'), 8);
    assert.equal(metricValue(totals(0, 0, null), 'ctr'), null);
    assert.equal(metricValue(totals(0, 0, null), 'position'), null);
    assert.equal(metricValue(totals(0, 100, 12), 'clicks'), 0);
    assert.equal(metricValue(null, 'clicks'), null);
    assert.equal(percentChange(80, 100), -0.2);
    assert.equal(percentChange(0, 0), 0);
    assert.equal(percentChange(5, 0), null);
    assert.equal(percentChange(5, null), null);
    assert.equal(formatMetric('clicks', null), '—');
    assert.equal(formatMetric('ctr', null), '—');
    assert.equal(formatMetric('position', null), '—');
    assert.equal(formatChange(null), '—');
});

test('position movement is colored by rank, not by the sign of the number', () => {
    assert.equal(changeTone('position', -0.15), 'up');
    assert.equal(changeTone('position', 0.15), 'down');
    assert.equal(changeTone('clicks', 0.15), 'up');
    assert.equal(changeTone('impressions', -0.15), 'down');
    assert.equal(changeTone('ctr', 0), 'flat');
    assert.deepEqual(cardTint('impressions', -0.25), { tone: 'down', strength: 4 });
    assert.deepEqual(cardTint('position', -0.25), { tone: 'up', strength: 4 });
    assert.deepEqual(cardTint('impressions', null), { tone: 'flat', strength: 0 });
});

test('the portfolio keeps gaps honest and compares only clients with both periods', () => {
    const model = assembleDashboard({
        range: '7d',
        window: dashboardWindow('7d', '2026-10-07'),
        asOf: '2026-10-07',
        today,
        hoursMonth: month,
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: '2026-10-12T18:00:00Z', settling: false },
        clients: [
            client({ id: 'paired', name: 'Paired', agreements: [agreement('2026-08-01')] }),
            client({ id: 'first', name: 'First sync', lastSyncedAt: '2026-10-12T18:00:00Z' }),
            client({ id: 'quiet', name: 'No rows', domain: 'quiet.example', lastSyncedAt: '2026-09-01T00:00:00Z' }),
            client({ id: 'fresh', name: 'Never synced', syncStatus: 'active', lastSyncedAt: null, loggedHours: 0 }),
            client({ id: 'broken', name: 'Broken', syncStatus: 'error', lastSyncedAt: null }),
        ],
        aggregates: [
            {
                clientId: 'paired',
                current: totals(80, 1000, 10, 7),
                previous: totals(100, 800, 12, 7),
                series: [{ bucket: '2026-10-01', clicks: 80, impressions: 1000, positionWeight: 10000 }],
                queries: [{ query: 'emergency plumber', clicks: 40 }, { query: 'drain cleaning', clicks: 20 }],
                incomplete: false,
            },
            {
                clientId: 'first',
                current: totals(50, 0, null, 3),
                previous: null,
                series: [],
                queries: [],
                incomplete: false,
            },
        ],
    });

    assert.equal(model.clientsWithData, 2);
    assert.equal(model.clientsConnected, 5);
    assert.equal(model.pairedClients, 1);
    assert.equal(model.kpis.clicks.value, 130);
    assert.equal(model.kpis.clicks.change, -0.2);
    assert.equal(model.kpis.impressions.value, 1000);
    assert.equal(model.kpis.position.value, 10);
    assert.equal(model.kpis.position.change, (10 - 12) / 12);
    assert.match(model.summary, /2 of 5 clients/);
    assert.match(model.summary, /Oct 1–7, 2026 vs Sep 24–30, 2026/);
    assert.match(model.summary, /imported /);

    const paired = model.cards.find(card => card.clientId === 'paired')!;
    assert.equal(paired.reason, null);
    assert.equal(paired.metrics.clicks.value, 80);
    assert.equal(paired.metrics.ctr.value, 0.08);
    assert.equal(paired.phaseLabel, 'Month 3');
    assert.equal(paired.hoursLabel, '18 / 40h');
    assert.equal(paired.queries[0].query, 'emergency plumber');
    assert.equal(paired.links.insights, '/workspace/paired?tab=insights');
    assert.equal(paired.links.plan, '/workspace/paired?tab=campaign');
    assert.match(paired.links.gsc, /resource_id=sc-domain%3Aexample.com/);

    const first = model.cards.find(card => card.clientId === 'first')!;
    assert.equal(first.metrics.clicks.value, 50);
    assert.equal(first.metrics.clicks.change, null);
    assert.equal(first.metrics.ctr.value, null);
    assert.equal(first.metrics.position.value, null);
    assert.equal(first.coverageLabel, '3 of 7 days');

    assert.equal(model.cards.find(card => card.clientId === 'quiet')?.reasonLabel, 'No data in this range');
    assert.equal(model.cards.find(card => card.clientId === 'fresh')?.reasonLabel, 'Not synced');
    assert.equal(model.cards.find(card => card.clientId === 'fresh')?.metrics.clicks.value, null);
    assert.equal(model.cards.find(card => card.clientId === 'broken')?.reasonLabel, 'Sync failed');
    assert.equal(formatMetric('clicks', model.cards.find(card => card.clientId === 'fresh')?.metrics.clicks.value ?? null), '—');
});

test('sort puts the biggest declines first and never treats a gap as zero', () => {
    const model = assembleDashboard({
        range: '28d',
        window: dashboardWindow('28d', '2026-10-07'),
        asOf: '2026-10-07',
        today,
        hoursMonth: month,
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: null, settling: true },
        clients: [
            client({ id: 'down', name: 'Down' }),
            client({ id: 'up', name: 'Up' }),
            client({ id: 'gap', name: 'Gap', lastSyncedAt: null }),
            client({ id: 'rank', name: 'Rank' }),
        ],
        aggregates: [
            { clientId: 'down', current: totals(40, 500, 9), previous: totals(80, 1000, 8), series: [], queries: [], incomplete: false },
            { clientId: 'up', current: totals(90, 1200, 11), previous: totals(70, 1000, 14), series: [], queries: [], incomplete: false },
            { clientId: 'rank', current: totals(10, 100, 4), previous: totals(10, 100, 6), series: [], queries: [], incomplete: false },
        ],
    });
    const declines: SortState = { mode: 'declines', metric: 'impressions', direction: 'desc' };
    const byDecline = [...model.cards].sort((a, b) => compareCards(a, b, declines)).map(card => card.clientId);
    assert.deepEqual(byDecline, ['down', 'rank', 'up', 'gap']);

    const byPosition: SortState = { mode: 'declines', metric: 'position', direction: 'desc' };
    const positionOrder = [...model.cards].sort((a, b) => compareCards(a, b, byPosition)).map(card => card.clientId);
    assert.equal(positionOrder[0], 'down');
    assert.equal(positionOrder.at(-1), 'gap');

    const byValue: SortState = { mode: 'metric', metric: 'position', direction: 'asc' };
    const bestPosition = [...model.cards].sort((a, b) => compareCards(a, b, byValue)).map(card => card.clientId);
    assert.deepEqual(bestPosition.slice(0, 3), ['rank', 'down', 'up']);

    const filtered = filterCards(model.cards, { query: 'rank', manager: null, coverage: 'all' });
    assert.deepEqual(filtered.map(card => card.clientId), ['rank']);
    assert.equal(model.settling, true);
});

test('a bad aggregate is rejected instead of being read as zero', () => {
    assert.throws(() => parseAgencyAggregate({ current: [], previous: [], series: [] }), /Invalid dashboard aggregate/);
    assert.throws(() => parseAgencyAggregate({
        current: [{ clientId: 'a', impressions: 10, days: 1 }],
        previous: [],
        series: [],
        queries: [],
    }), /Invalid dashboard aggregate/);
    const parsed = parseAgencyAggregate({
        current: [{ clientId: 'a', clicks: 0, impressions: 10, positionWeight: 80, days: 2, incomplete: false }],
        previous: [],
        series: [{ clientId: 'a', bucket: '2026-10-01', clicks: 0, impressions: 10, positionWeight: 80 }],
        queries: [{ clientId: 'a', query: 'seo agency', clicks: 4 }],
        freshness: { latestDataDate: '2026-10-07', latestImportedAt: '2026-10-12T18:00:00Z', settling: false },
    });
    assert.equal(parsed.clients[0].current?.clicks, 0);
    assert.equal(parsed.clients[0].current?.positionWeight, 80);
    assert.equal(parsed.clients[0].queries[0].clicks, 4);
});
