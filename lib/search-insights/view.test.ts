import test from 'node:test';
import assert from 'node:assert/strict';

import { disconnectedInsights, exampleInsights, EXAMPLE_NOW, EXAMPLE_PROPERTY } from './fixture.ts';
import {
    DEFAULT_RECEIPT_LIMIT,
    chartAnnouncement,
    clusterHeatMix,
    clusterHeatStyle,
    connectPanel,
    emptyWindowCopy,
    niceTicks,
    parseInsightsDeepLink,
    partialBanner,
    positionHeader,
    positionLegendLabel,
    presentInsights,
    preliminaryLegend,
    staleBanner,
    strokePaths,
    tickLabel,
} from './view.ts';

test('deep links accept a calendar month and a known section', () => {
    assert.deepEqual(parseInsightsDeepLink('?range=2026-09&section=pages'), { range: '2026-09', section: 'pages' });
    assert.deepEqual(parseInsightsDeepLink('range=28d&section=tracker'), { range: '28d', section: 'tracker' });
    assert.deepEqual(parseInsightsDeepLink('?range=nope&section=ledger'), { range: null, section: null });
});

test('ticks stay on a 1-2-5 step and gaps are never bridged', () => {
    assert.deepEqual(niceTicks(3_200), [0, 2_000, 4_000]);
    assert.deepEqual(tickLabel(0), '0');
    assert.deepEqual(tickLabel(2_000), '2k');
    const paths = strokePaths([
        { x: 0, y: 10, preliminary: false },
        { x: 10, y: null, preliminary: false },
        { x: 20, y: 12, preliminary: false },
        { x: 30, y: 14, preliminary: true },
    ]);
    assert.equal(paths.solid.includes('L 20'), false);
    assert.match(paths.solid, /M 0 10/);
    assert.match(paths.solid, /M 20 12/);
    assert.match(paths.dashed, /M 20 12 L 30 14/);
});

test('announcements, position headers, and the neutral heat ramp', () => {
    assert.equal(chartAnnouncement('Oct 5', 'final', 1200), 'Oct 5 · final · 1,200 impressions');
    assert.equal(chartAnnouncement('Oct 4', 'missing', null), 'Oct 4 · missing · no impressions');
    assert.equal(positionHeader(), 'Avg position (lower is better)');
    assert.equal(positionLegendLabel(), '1 · 3 · 10 · 20 · lower is better');
    assert.ok(clusterHeatMix(2) > clusterHeatMix(40));
    assert.match(clusterHeatStyle(2), /var\(--foreground\)/);
    assert.match(clusterHeatStyle(2), /var\(--card\)/);
    assert.equal(/red|amber|green|oklch\(0\.6/.test(clusterHeatStyle(2)), false);
});

test('states copy matches the matrix for connect, empty, partial, stale, and preliminary days', () => {
    const connect = connectPanel('scottcoleplumbing.com');
    assert.equal(connect.action, 'Connect Search Console');
    assert.match(connect.body, /Search Console isn’t connected\. Search Insights runs on Google’s own data for scottcoleplumbing\.com/);
    assert.match(connect.body, /16 months of history/);
    assert.match(emptyWindowCopy('scottcoleplumbing.com', 'Oct 1–9, 2026'), /Google recorded no impressions/);
    assert.match(emptyWindowCopy('scottcoleplumbing.com', 'Oct 1–9, 2026'), /That’s Google’s number, not missing data/);
    assert.match(partialBanner('2026-08-10', 28), /History starts Aug 10, 2026/);
    assert.match(partialBanner('2026-08-10', 28), /changes are hidden until/);
    assert.match(staleBanner('2026-10-05T16:12:00.000Z', EXAMPLE_NOW), /Search Console last synced/);
    assert.match(staleBanner('2026-10-05T16:12:00.000Z', EXAMPLE_NOW), /Numbers below are as of that sync/);
    assert.equal(preliminaryLegend(['2026-10-08', '2026-10-06', '2026-10-07']), 'Oct 6–8 preliminary · not in totals');
});

test('the example fixture keeps surfaces apart, skips uncollected grains, and budgets receipts', () => {
    const view = presentInsights(exampleInsights(), {
        example: true,
        now: EXAMPLE_NOW,
        clientId: 'example-client',
        domain: 'scottcoleplumbing.com',
    });
    assert.equal(view.example, true);
    assert.equal(view.connected, true);
    assert.equal(view.connect, null);
    assert.deepEqual(view.sections.map(section => section.id), ['summary', 'queries', 'cities', 'movers', 'pages', 'tracker']);
    assert.equal(view.sections.at(-1)?.id, 'tracker');
    assert.ok((view.sections.at(-1)?.badge ?? 0) > 0);
    assert.ok(view.receiptCount <= DEFAULT_RECEIPT_LIMIT);
    assert.ok(view.receiptCount > 0);
    assert.ok(view.grainNotes.some(note => note.includes('Partial · not collected yet')));
    assert.equal(view.chart?.panels.map(panel => panel.id).join(','), 'organic,map');
    const organic = view.chart?.panels[0];
    const map = view.chart?.panels[1];
    assert.equal(organic?.drawn, true);
    assert.equal(map?.drawn, true);
    assert.equal(organic?.colorToken, 'organic');
    assert.equal(map?.colorToken, 'map');
    assert.ok((organic?.solid.match(/M /g) ?? []).length >= 2);
    assert.equal((organic?.solid ?? '').includes('L') && (organic?.dashed ?? '').length >= 0, true);
    assert.ok((organic?.hatch.length ?? 0) > 0);
    assert.match(view.chart?.note ?? '', /Prior period hidden/);
    assert.match(view.preliminaryLegend ?? '', /preliminary · not in totals/);
    const gap = view.chart?.rows.find(row => row.date === '2026-10-04');
    assert.equal(gap?.status, 'missing');
    assert.equal(gap?.organic, '—');
    assert.equal(view.positionHeader, 'Avg position (lower is better)');
    assert.equal(view.tracker?.rows.some(row => row.status === 'Still visible on Google'), true);
    assert.equal(view.tracker?.rows.some(row => row.status === 'Disagrees with Google'), true);
    assert.match(view.tracker?.verdict ?? '', /Google still shows the site/);
    assert.equal(view.kpis.some(kpi => kpi.label.includes('all Google Search') || kpi.label.includes('All Google Search')), true);
    assert.equal(view.pages?.rows.some(row => row.cells[0].startsWith('Business Profile link → ')), true);
});

test('a missing series is not drawn as a zero line', () => {
    const response = exampleInsights();
    response.summary!.series.map = null;
    const view = presentInsights(response, { now: EXAMPLE_NOW });
    const map = view.chart?.panels.find(panel => panel.id === 'map');
    assert.equal(map?.drawn, false);
    assert.equal(map?.solid, '');
    assert.match(map?.unavailable ?? '', /Partial · not collected yet/);
});

test('not connected replaces the body and draws no chart', () => {
    const view = presentInsights(disconnectedInsights(), { domain: 'scottcoleplumbing.com', now: EXAMPLE_NOW });
    assert.equal(view.connected, false);
    assert.equal(view.chart, null);
    assert.equal(view.kpis.length, 0);
    assert.equal(view.receiptCount, 0);
    assert.equal(view.connect?.body, connectPanel('scottcoleplumbing.com').body);
    assert.equal(view.connect?.action, 'Connect Search Console');
    assert.equal(view.property, null);
    assert.notEqual(view.domain, EXAMPLE_PROPERTY);
});

test('a real zero stays a neutral 0 with no chart path', () => {
    const response = exampleInsights();
    for (const point of response.summary?.series.organic ?? []) {
        if (!point.missing) point.impressions = 0;
    }
    for (const point of response.summary?.series.map ?? []) {
        if (!point.missing) point.impressions = 0;
    }
    if (response.summary) {
        for (const total of [response.summary.totals.organic, response.summary.totals.map, response.summary.totals.allGoogleSearch]) {
            if (total) {
                total.impressions = 0;
                total.clicks = 0;
            }
        }
    }
    response.freshness = { ...response.freshness, state: 'empty', displayValue: '0', copy: 'A real zero for this window.' };
    const view = presentInsights(response, { domain: 'scottcoleplumbing.com', now: EXAMPLE_NOW });
    assert.equal(view.chart, null);
    assert.equal(view.banner?.id, 'empty');
    assert.match(view.banner?.body ?? '', /That’s Google’s number, not missing data/);
    assert.match(view.banner?.actionLabel ?? '', /Check property/);
});
