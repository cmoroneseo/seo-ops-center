import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dateOffset } from '@/lib/gsc/history.ts';
import type { HistoryDay, HistoryRow } from '@/lib/gsc/insights.ts';
import { pairedWindows, periodMetrics, propertySeries } from '@/lib/search-dashboard/model.ts';
import { campaignWorkspaceEnabled } from './flag.ts';
import type { CampaignInitiative } from './initiatives.ts';
import { campaignPageResults } from './pages.ts';
import { campaignLocalProfile, campaignSitewide, type CampaignPageSeries } from './sources.ts';

const TODAY = '2026-10-29';
const END = '2026-10-28';
const PAGE = 'https://harbor.example/services/emergency';
const OTHER = 'https://harbor.example/services/neighborhood';

function initiative(partial: Partial<CampaignInitiative> & Pick<CampaignInitiative, 'id' | 'title'>): CampaignInitiative {
    return {
        organizationId: 'org',
        clientId: 'client',
        purpose: null,
        ownerName: null,
        priority: 2,
        state: 'in_progress',
        startsOn: null,
        endsOn: null,
        pageUrl: null,
        successMetricLabel: null,
        evidenceUrl: null,
        verifiedOn: null,
        items: [],
        ...partial,
    };
}

function storedDays(rowFor?: (day: HistoryDay, index: number) => HistoryRow | undefined, mutate?: (day: HistoryDay, index: number) => void) {
    const start = dateOffset(END, -55);
    const days: HistoryDay[] = [];
    const rows: HistoryRow[] = [];
    for (let index = 0; index < 56; index += 1) {
        const date = dateOffset(start, index);
        const day: HistoryDay = {
            id: `day-${date}`,
            date,
            importedAt: `${date}T18:00:00Z`,
            pageLimited: false,
            queryLimited: false,
            isIncomplete: false,
        };
        mutate?.(day, index);
        days.push(day);
        const row = rowFor?.(day, index);
        if (row) rows.push(row);
    }
    return { days, rows };
}

function ready(days: HistoryDay[], rows: HistoryRow[]): CampaignPageSeries {
    return { status: 'ready', days, rows };
}

test('no stored page URL is not measurable and is not a zero', () => {
    const results = campaignPageResults({
        series: { status: 'ready', days: storedDays().days, rows: [] },
        initiatives: [initiative({ id: 'crawl', title: 'Crawl access' })],
        today: TODAY,
    });
    assert.deepEqual(results, []);
});

test('a missing or incomplete page series stays unmeasured instead of zero', () => {
    const initiatives = [initiative({ id: 'emergency', title: 'Emergency service page', pageUrl: PAGE, endsOn: '2026-11-20' })];
    for (const status of ['missing', 'unavailable', 'incomplete'] as const) {
        const result = campaignPageResults({
            series: { status, days: storedDays().days, rows: storedDays(day => ({
                id: 1, dayId: day.id, page: PAGE, query: '', clicks: 9, impressions: 10, position: 4,
            })).rows },
            initiatives,
            today: TODAY,
        })[0];
        assert.equal(result.status, 'not_measurable');
        assert.equal(result.reason, status);
        assert.equal(result.clicks, null);
        assert.equal(result.url, PAGE);
    }

    const incompleteDay = storedDays(
        (day, index) => ({ id: index + 1, dayId: day.id, page: PAGE, query: '', clicks: 2, impressions: 4, position: 3 }),
        (day, index) => { if (index === 40) day.isIncomplete = true; },
    );
    const partial = campaignPageResults({ series: ready(incompleteDay.days, incompleteDay.rows), initiatives, today: TODAY })[0];
    assert.equal(partial.reason, 'incomplete');
    assert.equal(partial.clicks, null);

    const capped = storedDays(
        (day, index) => index === 40 ? undefined : ({
            id: index + 1, dayId: day.id, page: PAGE, query: '', clicks: 2, impressions: 4, position: 3,
        }),
        (day, index) => { if (index === 40) day.pageLimited = true; },
    );
    const hidden = campaignPageResults({ series: ready(capped.days, capped.rows), initiatives, today: TODAY })[0];
    assert.equal(hidden.reason, 'incomplete');
    assert.equal(hidden.clicks, null);
});

test('a complete page series can be zero, and propertySeries would have called that day missing', () => {
    const initiatives = [initiative({ id: 'emergency', title: 'Emergency service page', pageUrl: PAGE })];
    const absent = storedDays();
    const zero = campaignPageResults({ series: ready(absent.days, []), initiatives, today: TODAY })[0];
    assert.equal(zero.status, 'measurable');
    assert.equal(zero.clicks, 0);
    const flags = absent.days.map(day => ({ date: day.date, isIncomplete: false }));
    const window = pairedWindows(flags, TODAY);
    assert.ok(window);
    const property = propertySeries(absent.days, [], window.current);
    assert.equal(property.every(point => point.clicks == null), true);
    assert.equal(periodMetrics(property).clicks, null);

    const explicit = storedDays(day => ({ id: 1, dayId: day.id, page: PAGE, query: '', clicks: 0, impressions: 0, position: 0 }));
    const storedZero = campaignPageResults({ series: ready(explicit.days, explicit.rows), initiatives, today: TODAY })[0];
    assert.equal(storedZero.clicks, 0);
});

test('page clicks stay off the sitewide total and the Business Profile card', () => {
    const property = storedDays((_day, index) => ({
        id: index + 1,
        dayId: `day-${dateOffset(dateOffset(END, -55), index)}`,
        page: '',
        query: '',
        clicks: index < 28 ? 4 : 5,
        impressions: 20,
        position: 6,
    }));
    const page = storedDays((day, index) => ({
        id: 1000 + index,
        dayId: day.id,
        page: index % 2 === 0 ? PAGE : `${PAGE}?utm_medium=gbp`,
        query: '',
        clicks: index < 28 ? 1 : 3,
        impressions: 8,
        position: 5,
    }));
    const sitewide = campaignSitewide({ connected: true, days: property.days, rows: property.rows, today: TODAY });
    const local = campaignLocalProfile([
        { metricMonth: '2026-09', data: { calls: 8 } },
        { metricMonth: '2026-08', data: { calls: 3 } },
    ], new Date('2026-10-29T20:00:00Z'));
    const results = campaignPageResults({
        series: ready(page.days, page.rows),
        initiatives: [initiative({ id: 'emergency', title: 'Emergency service page', pageUrl: PAGE })],
        today: TODAY,
    });
    assert.equal(sitewide.clicks, 140);
    assert.equal(sitewide.priorClicks, 112);
    assert.equal(local.value, 8);
    assert.equal(results.length, 1);
    assert.equal(results[0].surface, 'organic');
    assert.equal(results[0].clicks, 42);
    assert.notEqual(results[0].clicks, sitewide.clicks);
    assert.notEqual((sitewide.clicks ?? 0) + (results[0].clicks ?? 0), sitewide.clicks);
    assert.notEqual((local.value ?? 0) + (results[0].clicks ?? 0), local.value);
    assert.equal(JSON.stringify(sitewide).includes('42'), false);
    assert.equal(JSON.stringify(local).includes('42'), false);
});

test('every stored URL is listed, milestone first, and a shared URL stays one row', () => {
    const series = ready(storedDays().days, []);
    const initiatives = [
        initiative({ id: 'later', title: 'Later page', priority: 1, endsOn: '2026-12-01', pageUrl: OTHER }),
        initiative({ id: 'sooner', title: 'Sooner page', priority: 3, endsOn: '2026-11-15', pageUrl: PAGE }),
        initiative({ id: 'plain', title: 'No URL', priority: 1 }),
        initiative({ id: 'again', title: 'Same emergency page', priority: 2, pageUrl: `${PAGE}/` }),
        initiative({
            id: 'map',
            title: 'Profile link',
            priority: 4,
            pageUrl: `${PAGE}?utm_medium=gbp`,
        }),
    ];
    const results = campaignPageResults({ series, initiatives, today: '2026-11-07' });
    assert.deepEqual(results.map(result => result.titles), [
        ['Sooner page', 'Same emergency page'],
        ['Later page'],
        ['Profile link'],
    ]);
    assert.equal(results[0].clicks, 0);
    assert.equal(results[2].surface, 'gbp_link');
    assert.equal(results[2].clicks, 0);
    assert.equal(results.some(result => result.titles.includes('No URL')), false);
});

test('the campaign flag stays exact true and the example env stays blank', () => {
    const previous = process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
    try {
        delete process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
        assert.equal(campaignWorkspaceEnabled(), false);
        process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = 'true';
        assert.equal(campaignWorkspaceEnabled(), true);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
        else process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = previous;
    }
    const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    assert.match(envExample, /^NEXT_PUBLIC_CAMPAIGN_WORKSPACE=$/m);
    assert.equal(envExample.includes('NEXT_PUBLIC_CAMPAIGN_WORKSPACE=true'), false);
});
