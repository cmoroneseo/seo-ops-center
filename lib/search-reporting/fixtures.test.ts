import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOffset } from '@/lib/gsc/history';
import { deriveMonthlyGsc, monthFinality, type DaySnapshot } from '@/lib/gsc/monthly';
import { monthBounds } from '@/lib/sync/months';
import { buildSearchReporting, type BuildInput } from './assemble';
import { buildCityRows } from './cities';
import { buildMovers } from './movers';
import { buildPageRows } from './pages';
import { investigationsFor, positionBands } from './queries';
import { ahrefsReferenceRows, compareAhrefs } from './tracker';
import { ALL_GOOGLE_SEARCH_LABEL, CLUSTER_IMPRESSION_MINIMUM, NOT_COLLECTED_DETAIL, NOT_COLLECTED_REASON, TOO_FEW_SEARCHES, type StoredDay, type StoredFact } from './types';

const NOW = new Date('2026-10-09T18:00:00.000Z');

function day(id: string, date: string, isIncomplete = false): StoredDay {
    return { id, date, isIncomplete, importedAt: '2026-10-08T15:00:00.000Z', pageLimited: false, queryLimited: false };
}

function fact(dayId: string, patch: Partial<StoredFact> & Pick<StoredFact, 'grain'>): StoredFact {
    return {
        dayId,
        page: '',
        query: '',
        clicks: 0,
        impressions: 0,
        position: 1,
        device: null,
        country: null,
        surface: 'organic',
        ...patch,
    };
}

function dates(start: string, end: string): string[] {
    const count = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
    return Array.from({ length: count }, (_, index) => dateOffset(start, index));
}

function base(patch: Partial<BuildInput> = {}): BuildInput {
    return {
        now: NOW,
        range: '2026-09',
        surface: 'all',
        device: null,
        cityTokens: [],
        connected: true,
        property: 'sc-domain:scottcole.example',
        clientName: 'Scott Cole',
        days: [],
        facts: [],
        ahrefsRows: [],
        ahrefsSyncedAt: null,
        lastSyncAt: '2026-10-08T15:00:00.000Z',
        lastSyncErrored: false,
        ...patch,
    };
}

test('a final Pacific month matches monthly.ts and keeps surfaces apart', () => {
    const bounds = monthBounds('2026-09');
    const days = dates(bounds.start, bounds.end).map((date, index) => day(`sep-${index}`, date));
    const facts: StoredFact[] = days.flatMap(stored => [
        fact(stored.id, { grain: 'property', clicks: 2, impressions: 10, position: 4 }),
        fact(stored.id, { grain: 'page', page: 'https://scottcole.example/services', clicks: 1, impressions: 6, position: 2, surface: 'organic' }),
        fact(stored.id, { grain: 'page', page: 'https://scottcole.example/contact?utm_medium=gbp', clicks: 4, impressions: 4, position: 10, surface: 'gbp_link' }),
    ]);
    const snapshots: DaySnapshot[] = days.map(stored => ({
        date: stored.date,
        isIncomplete: false,
        property: { clicks: 2, impressions: 10, position: 4 },
    }));
    const monthly = deriveMonthlyGsc('2026-09', snapshots);
    const report = buildSearchReporting(base({ days, facts }));
    const all = report.summary?.totals.allGoogleSearch;
    assert.ok(monthly);
    assert.ok(all);
    assert.equal(all.label, ALL_GOOGLE_SEARCH_LABEL);
    assert.equal(all.clicks, monthly.data.organic_clicks);
    assert.equal(all.impressions, monthly.data.impressions);
    assert.equal(all.position, monthly.data.avg_position);
    assert.equal(all.ctr, monthly.data.ctr);
    assert.deepEqual(report.range?.finality, monthFinality('2026-09', snapshots));
    assert.equal(report.range?.finality.final, true);
    assert.equal(report.summary?.totals.organic?.position, 2);
    assert.equal(report.summary?.totals.map?.position, 10);
    assert.equal(report.summary?.totals.organic?.clicks, 30);
    assert.equal(report.summary?.totals.map?.clicks, 120);
    assert.notEqual(all.clicks, (report.summary?.totals.organic?.clicks ?? 0) + (report.summary?.totals.map?.clicks ?? 0));
    assert.notEqual(all.position, 6);
    assert.equal(report.summary?.series.organic?.length, 30);
    assert.equal(report.summary?.mask.length, 0);
    assert.equal(report.summary?.receipt.final, true);
    assert.equal(report.summary?.receipt.source, 'Google Search Console');
    assert.equal(report.summary?.receipt.range, '2026-09-01/2026-09-30');
    assert.equal(report.summary?.receipt.synced_at, '2026-10-08T15:00:00.000Z');
    assert.match(report.summary?.receipt.method ?? '', /All Google Search/);
    const profile = report.pages?.rows.find(row => row.surface === 'gbp_link');
    assert.equal(profile?.label, 'Business Profile link → /contact');
    assert.equal(report.pages?.rows.find(row => row.surface === 'organic')?.label, '/services');
});

test('preliminary days stay on the mask and out of the total', () => {
    const days = [
        day('oct-1', '2026-10-01'),
        day('oct-2', '2026-10-02', true),
    ];
    const facts = [
        fact('oct-1', { grain: 'property', clicks: 5, impressions: 10, position: 3 }),
        fact('oct-2', { grain: 'property', clicks: 100, impressions: 100, position: 3 }),
    ];
    const report = buildSearchReporting(base({ range: '2026-10', days, facts }));
    assert.equal(report.summary?.totals.allGoogleSearch?.clicks, 5);
    assert.equal(report.summary?.mask.some(item => item.date === '2026-10-02' && item.reason === 'preliminary'), true);
    assert.equal(report.range?.finality.final, false);
    assert.equal(report.range?.finality.days_present, 2);
    assert.equal(report.summary?.comparison.distorted, true);
    assert.equal(report.summary?.comparison.reason, 'partial period');
    assert.equal(report.summary?.comparison.impressions?.kind, 'distorted');
    assert.equal(report.summary?.comparison.impressions?.reason, 'partial period');
    const finalOnly = deriveMonthlyGsc('2026-10', [{ date: '2026-10-01', isIncomplete: false, property: { clicks: 5, impressions: 10, position: 3 } }]);
    assert.equal(report.summary?.totals.allGoogleSearch?.clicks, finalOnly?.data.organic_clicks);
});

test('history that starts mid-month and unequal coverage name their reasons', () => {
    const late = dates('2026-09-10', '2026-09-30').map((date, index) => day(`late-${index}`, date));
    const lateReport = buildSearchReporting(base({
        days: late,
        facts: late.map(stored => fact(stored.id, { grain: 'property', clicks: 1, impressions: 1, position: 1 })),
    }));
    assert.equal(lateReport.summary?.comparison.reason, 'history starts mid-period');

    const september = dates('2026-09-01', '2026-09-30').map((date, index) => day(`sep-${index}`, date));
    const august = dates('2026-08-01', '2026-08-26').map((date, index) => day(`aug-${index}`, date));
    const uneven = buildSearchReporting(base({
        days: [...august, ...september],
        facts: [...august, ...september].map(stored => fact(stored.id, { grain: 'property', clicks: 1, impressions: 2, position: 3 })),
    }));
    assert.equal(uneven.range?.finality.final, true);
    assert.equal(uneven.summary?.comparison.distorted, true);
    assert.equal(uneven.summary?.comparison.reason, 'unequal coverage');
    assert.equal(uneven.summary?.comparison.position?.kind, 'distorted');
    assert.equal(uneven.summary?.comparison.position?.reason, 'unequal coverage');
});

test('the default range is the last 28 final Pacific days', () => {
    const final = dates('2026-09-09', '2026-10-06').map((date, index) => day(`f-${index}`, date));
    const preliminary = ['2026-10-07', '2026-10-08', '2026-10-09'].map((date, index) => day(`p-${index}`, date, true));
    const report = buildSearchReporting(base({
        range: '28d',
        days: [...final, ...preliminary],
        facts: final.map(stored => fact(stored.id, { grain: 'property', clicks: 1, impressions: 1, position: 2 })),
    }));
    assert.equal(report.range?.key, '28d');
    assert.equal(report.range?.start, '2026-09-09');
    assert.equal(report.range?.end, '2026-10-06');
    assert.equal(report.range?.finality.final, true);
    assert.equal(report.range?.finality.days_expected, 28);
    assert.equal(report.summary?.totals.allGoogleSearch?.clicks, 28);
    assert.equal(report.summary?.mask.some(item => item.reason === 'preliminary'), false);
});

test('v1 history keeps the page surface split and leaves uncollected grains null', () => {
    const stored = day('sep-1', '2026-09-01');
    const facts = [
        fact(stored.id, { grain: 'property', clicks: 9, impressions: 20, position: 4 }),
        fact(stored.id, { grain: 'page', page: 'https://scottcole.example/services', clicks: 3, impressions: 8, position: 2, surface: 'organic' }),
        fact(stored.id, { grain: 'page', page: 'https://scottcole.example/contact?utm_medium=gbp', clicks: 1, impressions: 5, position: 11, surface: 'gbp_link' }),
        fact(stored.id, { grain: 'query_page', query: 'plumber eastvale', page: 'https://scottcole.example/services', clicks: 1, impressions: 8, position: 2, surface: 'organic' }),
    ];
    const open = buildSearchReporting(base({ days: [stored], facts, cityTokens: ['Eastvale'] }));
    assert.equal(open.summary?.totals.organic?.clicks, 3);
    assert.equal(open.summary?.totals.map?.clicks, 1);
    assert.equal(open.summary?.totals.allGoogleSearch?.clicks, 9);
    assert.equal(open.summary?.totals.allGoogleSearch?.label, ALL_GOOGLE_SEARCH_LABEL);
    assert.equal(open.grains?.pageOrganic.value, null);
    assert.equal(open.grains?.pageOrganic.state, 'partial');
    assert.equal(open.grains?.pageOrganic.reason, NOT_COLLECTED_REASON);
    assert.equal(open.grains?.pageOrganic.detail, NOT_COLLECTED_DETAIL);
    assert.equal(open.grains?.device.value, null);
    assert.equal(open.grains?.device.reason, NOT_COLLECTED_REASON);

    const mobile = buildSearchReporting(base({ days: [stored], facts, device: 'MOBILE' }));
    assert.equal(mobile.summary?.totals.organic, null);
    assert.equal(mobile.summary?.totals.map, null);
    assert.equal(mobile.summary?.totals.allGoogleSearch, null);
    assert.equal(mobile.summary?.series.organic, null);
    assert.equal(mobile.grains?.device.requested, 'MOBILE');
    assert.equal(mobile.grains?.device.value, null);
    assert.equal(mobile.grains?.device.reason, NOT_COLLECTED_REASON);
    assert.equal(mobile.grains?.device.detail, NOT_COLLECTED_DETAIL);
    assert.equal(mobile.queries, null);
    assert.equal(JSON.stringify(mobile.summary).includes('"clicks":0'), false);
});

test('city clusters need 40 impressions in both windows', () => {
    const rows = buildCityRows([
        { query: 'commercial plumber eastvale', surface: 'organic', current: 40, prior: 40 },
        { query: 'emergency plumber eastvale', surface: 'organic', current: 10, prior: 5 },
        { query: 'plumber corona', surface: 'organic', current: 40, prior: 39 },
        { query: 'plumber in san bernardino', surface: 'gbp_link', current: 50, prior: 45 },
    ], ['Corona', 'Eastvale', 'San Bernardino'], 'all');
    const eastvale = rows.find(row => row.city === 'eastvale');
    const corona = rows.find(row => row.city === 'corona');
    const bernardino = rows.find(row => row.city === 'san bernardino');
    assert.equal(CLUSTER_IMPRESSION_MINIMUM, 40);
    assert.equal(eastvale?.shown, true);
    assert.equal(eastvale?.impressions, 50);
    assert.equal(eastvale?.priorImpressions, 45);
    assert.equal(corona?.shown, false);
    assert.equal(corona?.impressions, null);
    assert.equal(corona?.display, '—');
    assert.equal(corona?.reason, TOO_FEW_SEARCHES);
    assert.equal(bernardino?.shown, true);
    assert.equal(bernardino?.surface, 'gbp_link');
    assert.equal(bernardino?.impressions, 50);
});

test('mix shift sorts last and a drop counts only after two consecutive checks', () => {
    const windows = [
        ['2026-07-01', '2026-07-04'],
        ['2026-07-05', '2026-07-08'],
        ['2026-07-09', '2026-07-12'],
    ] as const;
    const days = windows.flatMap((span, windowIndex) => dates(span[0], span[1]).map((date, index) => day(`w${windowIndex}-${index}`, date)));
    const byDate = new Map(days.map(stored => [stored.id, stored]));
    const add = (query: string, counts: number[], observedPrior: number[]): StoredFact[] => {
        const rows: StoredFact[] = [];
        windows.forEach((span, windowIndex) => {
            const windowDates = dates(span[0], span[1]);
            const use = windowIndex === 1 ? windowDates.slice(0, observedPrior[0]) : windowDates;
            const each = counts[windowIndex] / use.length;
            for (const date of use) {
                const stored = days.find(item => item.date === date);
                rows.push(fact(stored!.id, { grain: 'query_page', query, page: 'https://example.com/a', impressions: each, clicks: 1, position: 4 }));
            }
        });
        return rows;
    };
    const facts = [
        ...add('steady drop', [80, 60, 40], [4]),
        ...add('one drop', [40, 80, 50], [4]),
        ...add('sparse spike', [40, 40, 400], [1]),
    ];
    const rows = buildMovers({
        facts,
        dayById: byDate,
        days,
        earlier: { start: '2026-07-01', end: '2026-07-04' },
        prior: { start: '2026-07-05', end: '2026-07-08' },
        current: { start: '2026-07-09', end: '2026-07-12' },
        surface: 'all',
        windowDistorted: false,
    });
    assert.equal(rows.find(row => row.query === 'steady drop')?.drop, true);
    assert.equal(rows.find(row => row.query === 'steady drop')?.kind, 'drop');
    assert.equal(rows.find(row => row.query === 'one drop')?.drop, false);
    assert.equal(rows.find(row => row.query === 'one drop')?.kind, 'pending');
    const sparse = rows.find(row => row.query === 'sparse spike');
    assert.equal(sparse?.tag, 'mix_shift');
    assert.equal(sparse?.reason, 'mix shift');
    assert.equal(sparse?.drop, false);
    assert.equal(rows.at(-1)?.query, 'sparse spike');
    assert.notEqual(rows[0]?.tag, 'mix_shift');
});

test('position bands stay inside one surface and tracker anomalies need a real disagreement', () => {
    const organic = { query: 'drain cleaning', page: 'https://example.com/a', surface: 'organic' as const, date: '2026-09-01', clicks: 1, impressions: 10, position: 2 };
    const map = { query: 'drain cleaning', page: 'https://example.com/a', surface: 'gbp_link' as const, date: '2026-09-01', clicks: 1, impressions: 10, position: 12 };
    const organicBands = positionBands([organic], 'organic');
    const mapBands = positionBands([map], 'gbp_link');
    assert.equal(organicBands.find(band => band.id === '1-3')?.queries, 1);
    assert.equal(organicBands.find(band => band.id === '11-20')?.queries, 0);
    assert.equal(mapBands.find(band => band.id === '1-3')?.queries, 0);
    assert.equal(mapBands.find(band => band.id === '11-20')?.queries, 1);
    const repeated = [1, 2, 3].flatMap(dayNumber => ([
        { query: 'drain cleaning', page: 'https://example.com/a', surface: 'organic' as const, date: `2026-09-0${dayNumber}`, clicks: 1, impressions: 50, position: 8 },
        { query: 'acme drain', page: 'https://example.com/a', surface: 'organic' as const, date: `2026-09-0${dayNumber}`, clicks: 1, impressions: 50, position: 8 },
        { query: 'drain cleaning', page: 'https://example.com/map', surface: 'gbp_link' as const, date: `2026-09-0${dayNumber}`, clicks: 1, impressions: 50, position: 8 },
    ]));
    const organicInvestigations = investigationsFor(repeated, [], 'organic', 'Acme');
    const mapInvestigations = investigationsFor(repeated, [], 'gbp_link', 'Acme');
    assert.deepEqual(organicInvestigations.nearPageOne.map(row => row.query), ['drain cleaning']);
    assert.deepEqual(mapInvestigations.nearPageOne.map(row => row.query), ['drain cleaning']);
    assert.equal(organicInvestigations.nearPageOne.some(row => row.query === 'acme drain'), false);

    const gsc = [{ query: 'drain cleaning', position: 4 }, { query: 'water heater', position: 18 }];
    const pairs = compareAhrefs(gsc, [
        { query: 'Drain Cleaning', position: 3 },
        { query: 'water heater', position: 3 },
        { query: 'missing query', position: 2 },
    ]);
    assert.equal(pairs[0]?.anomalyOpen, false);
    assert.equal(pairs[1]?.anomalyOpen, true);
    assert.equal(pairs[2]?.anomalyOpen, false);
    assert.equal(pairs.some(row => row.tracker === 'dataforseo'), false);
    assert.deepEqual(ahrefsReferenceRows({ domain_rating: 20, ranked_keywords: 10, top_10_keywords: 4 }), []);
    assert.equal(ahrefsReferenceRows({ keywords: [{ keyword: 'drain cleaning', best_position: 3 }] })[0]?.position, 3);
});

test('a disconnected property is an em dash, and a real stored zero stays zero', () => {
    const disconnected = buildSearchReporting(base({ connected: false, property: null }));
    assert.equal(disconnected.connected, false);
    assert.equal(disconnected.freshness.displayValue, '—');
    assert.equal(disconnected.summary, null);
    const stored = day('sep-1', '2026-09-01');
    const zero = buildSearchReporting(base({
        days: [stored],
        facts: [fact(stored.id, { grain: 'property', clicks: 0, impressions: 0, position: 0 })],
    }));
    assert.equal(zero.summary?.totals.allGoogleSearch?.clicks, 0);
    assert.equal(zero.summary?.totals.allGoogleSearch?.impressions, 0);
    assert.equal(zero.freshness.state === 'fresh' || zero.freshness.state === 'empty' || zero.freshness.state === 'partial' || zero.freshness.state === 'stale', true);
});

test('page labels and a 50k-row rollup stay on the TypeScript path', () => {
    const rows = buildPageRows([
        { page: 'https://scottcole.example/contact?utm_medium=gbp', surface: 'gbp_link', clicks: 2, impressions: 5, position: 4 },
    ], 'all');
    assert.equal(rows[0]?.label, 'Business Profile link → /contact');

    const days = dates('2026-09-09', '2026-10-06').map((date, index) => day(`p-${index}`, date));
    const facts: StoredFact[] = [];
    for (let index = 0; index < 50000; index++) {
        facts.push(fact(days[index % days.length].id, {
            grain: 'query_page',
            query: `query ${index % 100}`,
            page: 'https://example.com/a',
            clicks: 1,
            impressions: 2,
            position: 3,
            surface: index % 2 === 0 ? 'organic' : 'gbp_link',
        }));
    }
    const started = Date.now();
    const report = buildSearchReporting(base({ range: '28d', days, facts }));
    const elapsed = Date.now() - started;
    const organicImpressions = report.queries?.bands.organic?.reduce((sum, band) => sum + band.impressions, 0);
    assert.equal(organicImpressions, 50000);
    assert.equal(report.summary?.totals.organic?.clicks ?? 0, 0);
    assert.ok(elapsed < 2000, `50k-row rollup took ${elapsed}ms`);
});

test('a failed query grain keeps v1 totals and hides query sections', () => {
    const stored = day('sep-1', '2026-09-01');
    const report = buildSearchReporting(base({
        days: [stored],
        unavailableGrains: ['query_page'],
        facts: [
            fact(stored.id, { grain: 'property', clicks: 9, impressions: 20, position: 4 }),
            fact(stored.id, { grain: 'page', page: 'https://scottcole.example/services', clicks: 3, impressions: 8, position: 2, surface: 'organic' }),
        ],
    }));
    assert.equal(report.summary?.totals.allGoogleSearch?.clicks, 9);
    assert.equal(report.summary?.totals.organic?.clicks, 3);
    assert.equal(report.queries, null);
    assert.equal(report.cities, null);
    assert.equal(report.movers, null);
    assert.equal(report.grains?.pageOrganic.reason, NOT_COLLECTED_REASON);
});

test('failed property and page grains degrade to the states-matrix history message', () => {
    const report = buildSearchReporting(base({
        days: [day('sep-1', '2026-09-01')],
        facts: [],
        unavailableGrains: ['property', 'page'],
    }));
    assert.equal(report.summary?.totals.allGoogleSearch, null);
    assert.equal(report.summary?.totals.organic, null);
    assert.equal(report.freshness.state, 'partial');
    assert.equal(report.freshness.copy, "History doesn't cover this window.");
    assert.equal(report.freshness.tag, null);
});
