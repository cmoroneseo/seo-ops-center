import assert from 'node:assert/strict';
import test from 'node:test';

import { dateOffset } from '@/lib/gsc/history';
import { eachDate } from '@/lib/search-reporting/range';

import { buildImpact } from './impact';
import {
    EARLY_ESTIMATE_NOTE,
    answerLine,
    buildResultsTable,
    changeTone,
    chartCaption,
    dailyAverage,
    formatChangePercent,
    formatTermValue,
    notReadyCopy,
    percentChange,
    searchTermsEmpty,
    termsHaveGaps,
} from './results';
import { dataReadyOn } from './schedule';
import type { DayPoint, ImpactModel, Kpi } from './types';

const DAY: Omit<DayPoint, 'date'> = {
    clicks: 9,
    impressions: 200,
    position: 10,
    organicSessions: 4,
    keyEvents: 1,
};

function fill(start: string, end: string, daily: Omit<DayPoint, 'date'>): DayPoint[] {
    return eachDate(start, end).map(date => ({ date, ...daily }));
}

function impactFor(input: {
    liveOn: string;
    now: Date;
    pageBefore: Omit<DayPoint, 'date'>;
    pageAfter: Omit<DayPoint, 'date'>;
    siteBefore?: Omit<DayPoint, 'date'> | null;
    siteAfter?: Omit<DayPoint, 'date'> | null;
    kpi?: Kpi;
    queries?: { query: string; days: DayPoint[] }[];
    pageDays?: DayPoint[];
    siteDays?: DayPoint[];
}): ImpactModel {
    const beforeStart = dateOffset(input.liveOn, -28);
    const beforeEnd = dateOffset(input.liveOn, -1);
    const afterEnd = dateOffset(input.liveOn, 55);
    const pageDays = input.pageDays ?? [
        ...fill(beforeStart, beforeEnd, input.pageBefore),
        ...fill(input.liveOn, afterEnd, input.pageAfter),
    ];
    const siteDays = input.siteDays ?? (input.siteBefore && input.siteAfter
        ? [
            ...fill(beforeStart, beforeEnd, input.siteBefore),
            ...fill(input.liveOn, afterEnd, input.siteAfter),
        ]
        : []);
    return buildImpact({
        liveOn: input.liveOn,
        kpi: input.kpi ?? 'clicks',
        now: input.now,
        compareLastYear: false,
        gscConnected: true,
        ga4Connected: true,
        pageDays,
        sitewideDays: siteDays,
        queries: input.queries,
    });
}

function row(table: ReturnType<typeof buildResultsTable>, id: string) {
    const found = table.rows.find(item => item.id === id);
    if (!found) throw new Error(`missing row ${id}`);
    return found;
}

test('daily averages, percent change, and position color use real counts only', () => {
    assert.equal(dailyAverage(90, 28, true), 90 / 28);
    assert.equal(dailyAverage(0, 28, true), 0);
    assert.equal(dailyAverage(0, 28, false), null);
    assert.equal(dailyAverage(null, 0, true), null);
    assert.equal(percentChange(10, 12), 0.2);
    assert.equal(percentChange(10, 8), -0.2);
    assert.equal(percentChange(0, 0), 0);
    assert.equal(percentChange(0, 4), null);
    assert.equal(percentChange(null, 0), null);
    assert.equal(percentChange(4, null), null);
    assert.equal(changeTone(0.2, false), 'good');
    assert.equal(changeTone(-0.2, false), 'bad');
    assert.equal(changeTone(-0.2, true), 'good');
    assert.equal(changeTone(0.25, true), 'bad');
    assert.equal(changeTone(0, true), 'flat');
    assert.equal(changeTone(null, true), 'missing');
    assert.equal(formatChangePercent(-0.2), '−20%');
    assert.equal(formatChangePercent(0.2), '+20%');
    assert.equal(formatChangePercent(null), '—');
});

test('the results table averages the starting point and the latest finished check', () => {
    const impact = impactFor({
        liveOn: '2026-10-13',
        now: new Date('2026-11-20T20:00:00.000Z'),
        pageBefore: { ...DAY, clicks: 9, impressions: 180, position: 10 },
        pageAfter: { ...DAY, clicks: 12, impressions: 200, position: 8 },
        siteBefore: { ...DAY, clicks: 49, impressions: 900, position: 14 },
        siteAfter: { ...DAY, clicks: 52, impressions: 960, position: 13 },
        kpi: 'clicks',
    });
    assert.equal(impact.headline.days, 28);
    assert.equal(impact.baselineControl?.clicks, (49 - 9) * 28);
    const table = buildResultsTable(impact);
    assert.equal(table.ready, true);
    assert.equal(table.days, 28);
    assert.equal(table.lowData, false);
    assert.equal(table.notReady, null);
    const clicks = row(table, 'clicks');
    assert.equal(clicks.watched, true);
    assert.equal(clicks.before, 9);
    assert.equal(clicks.after, 12);
    assert.equal(clicks.change, (12 - 9) / 9);
    const impressions = row(table, 'impressions');
    assert.equal(impressions.watched, false);
    assert.equal(impressions.before, 180);
    assert.equal(impressions.after, 200);
    assert.equal(impressions.change, (200 - 180) / 180);
    const rate = row(table, 'ctr');
    assert.equal(rate.before, impact.baseline.ctr);
    assert.equal(rate.after, impact.headline.page.ctr);
    assert.ok((rate.before ?? 0) > 0);
    const position = row(table, 'avg_position');
    assert.equal(position.lowerIsBetter, true);
    assert.equal(position.note, 'Lower is better');
    assert.equal(position.before, 10);
    assert.equal(position.after, 8);
    assert.equal(position.change, (8 - 10) / 10);
    assert.equal(changeTone(position.change, position.lowerIsBetter), 'good');
    const rest = row(table, 'rest_clicks');
    assert.equal(rest.watched, false);
    assert.equal(rest.before, 40);
    assert.equal(rest.after, 40);
    assert.equal(rest.change, 0);
    assert.match(answerLine('clicks', impact), /Clicks from Google are up .+ compared with pages we didn't change, 28 days after going live\./);
    assert.equal(answerLine('clicks', impact).includes("It's an early sign."), false);
});

test('a short finished check is an early sign, and a lower position that got worse is colored as a drop', () => {
    const early = impactFor({
        liveOn: '2026-11-01',
        now: new Date('2026-11-20T20:00:00.000Z'),
        pageBefore: { ...DAY, clicks: 10, impressions: 400, position: 8 },
        pageAfter: { ...DAY, clicks: 14, impressions: 400, position: 11 },
        siteBefore: { ...DAY, clicks: 40, impressions: 800, position: 12 },
        siteAfter: { ...DAY, clicks: 40, impressions: 800, position: 12 },
        kpi: 'avg_position',
    });
    assert.equal(early.headline.ready, true);
    assert.equal(early.headline.days, 14);
    const table = buildResultsTable(early);
    assert.equal(table.days, 14);
    assert.equal(row(table, 'avg_position').watched, true);
    assert.equal(row(table, 'clicks').watched, false);
    const position = row(table, 'avg_position');
    assert.equal(position.before, 8);
    assert.equal(position.after, 11);
    assert.ok((position.change ?? 0) > 0);
    assert.equal(changeTone(position.change, true), 'bad');
    assert.match(answerLine('avg_position', early), /It's an early sign\.$/);
    assert.match(answerLine('ctr', { ...early, kpi: 'ctr' }), /^Click rate is /);
});

test('no finished check stays not ready, with the due date and the data-ready date', () => {
    const impact = impactFor({
        liveOn: '2026-10-13',
        now: new Date('2026-10-16T20:00:00.000Z'),
        pageBefore: { ...DAY, clicks: 9 },
        pageAfter: { ...DAY, clicks: 20 },
        siteBefore: { ...DAY, clicks: 40, impressions: 900 },
        siteAfter: { ...DAY, clicks: 40, impressions: 900 },
    });
    assert.equal(impact.headline.ready, false);
    const table = buildResultsTable(impact);
    assert.equal(table.ready, false);
    assert.equal(table.lowData, false);
    assert.equal(table.days, null);
    assert.deepEqual(table.notReady, {
        days: 7,
        dueOn: '2026-10-20',
        dataReadyOn: '2026-10-23',
    });
    assert.equal(table.notReady?.dataReadyOn, dataReadyOn('2026-10-20'));
    assert.equal(row(table, 'clicks').before, 9);
    assert.equal(row(table, 'clicks').after, null);
    assert.equal(row(table, 'clicks').change, null);
    assert.equal(row(table, 'impressions').after, null);
    assert.match(notReadyCopy(table.notReady) ?? '', /Not ready yet\. The 7-day check is due Oct 20, 2026\. Google's numbers are ready around Oct 23, 2026\./);
    assert.match(answerLine('clicks', impact), /Too early to tell\. The 7-day check is due Oct 20, 2026\. Google's numbers are ready around Oct 23, 2026\./);
});

test('low data keeps the numbers and flags an early estimate', () => {
    const impact = impactFor({
        liveOn: '2026-06-01',
        now: new Date('2026-08-01T20:00:00.000Z'),
        pageBefore: { ...DAY, clicks: 1, impressions: 2, position: 10 },
        pageAfter: { ...DAY, clicks: 2, impressions: 3, position: 9 },
        siteBefore: { ...DAY, clicks: 20, impressions: 80, position: 12 },
        siteAfter: { ...DAY, clicks: 20, impressions: 80, position: 12 },
    });
    assert.equal(impact.headline.ready, true);
    assert.equal(impact.headline.lowData, true);
    const table = buildResultsTable(impact);
    assert.equal(table.lowData, true);
    assert.equal(row(table, 'clicks').before, 1);
    assert.equal(row(table, 'clicks').after, 2);
    assert.match(EARLY_ESTIMATE_NOTE, /Early estimate/);
    assert.match(answerLine('clicks', impact), /It's an early sign\./);
});

test('an unmeasured window is null, a measured zero stays zero, and a missing site is not invented', () => {
    const zero = impactFor({
        liveOn: '2026-06-01',
        now: new Date('2026-08-01T20:00:00.000Z'),
        pageBefore: { ...DAY, clicks: 0, impressions: 200 },
        pageAfter: { ...DAY, clicks: 0, impressions: 200 },
        siteBefore: null,
        siteAfter: null,
        siteDays: [],
        queries: [
            {
                query: 'measured zero',
                days: fill('2026-05-04', '2026-07-26', { ...DAY, clicks: 0, impressions: 10 }),
            },
            {
                query: 'missing after',
                days: fill('2026-05-04', '2026-05-31', { ...DAY, clicks: 4, impressions: 10 }),
            },
        ],
    });
    const table = buildResultsTable(zero);
    assert.equal(row(table, 'clicks').before, 0);
    assert.equal(row(table, 'clicks').after, 0);
    assert.equal(row(table, 'clicks').change, 0);
    assert.equal(zero.baselineControl, null);
    assert.equal(row(table, 'rest_clicks').before, null);
    assert.equal(row(table, 'rest_clicks').after, null);
    assert.notEqual(row(table, 'rest_clicks').before, 0);
    const measured = zero.queries.find(item => item.query === 'measured zero');
    const missing = zero.queries.find(item => item.query === 'missing after');
    assert.equal(measured?.beforeClicks, 0);
    assert.equal(measured?.afterClicks, 0);
    assert.equal(measured?.clicksDelta, 0);
    assert.ok((missing?.beforeClicks ?? 0) > 0);
    assert.equal(missing?.afterClicks, null);
    assert.equal(missing?.afterImpressions, null);
    assert.equal(missing?.clicksDelta, null);
    assert.equal(missing?.impressionsDelta, null);
    assert.notEqual(missing?.afterClicks, 0);

    const empty = impactFor({
        liveOn: '2026-06-01',
        now: new Date('2026-08-01T20:00:00.000Z'),
        pageBefore: DAY,
        pageAfter: DAY,
        pageDays: [],
        siteDays: [],
    });
    assert.equal(buildResultsTable(empty).rows.find(item => item.id === 'clicks')?.before, null);
    assert.equal(chartCaption('No comparison'), null);
    assert.match(chartCaption('Rest of the site') ?? '', /Compared with the rest of the site/);
    assert.match(chartCaption('Rest of the site') ?? '', /100 = the page's normal level before the change/);
});

test('search terms keep a real zero and say when a side was not reported', () => {
    assert.equal(formatTermValue(0), '0');
    assert.equal(formatTermValue(null), '— not reported yet');
    assert.equal(formatTermValue(12.34), '12.3');
    const blank = {
        query: 'missing',
        beforeClicks: null,
        afterClicks: null,
        beforeImpressions: null,
        afterImpressions: null,
        beforePosition: null,
        afterPosition: null,
        beforeCtr: null,
        afterCtr: null,
        clicksDelta: null,
        impressionsDelta: null,
        positionDelta: null,
    };
    assert.equal(searchTermsEmpty([]), 'none');
    assert.equal(searchTermsEmpty([blank]), 'unmeasured');
    assert.equal(searchTermsEmpty([{ ...blank, beforeClicks: 0 }]), null);
    assert.equal(termsHaveGaps([{ ...blank, beforeClicks: 0 }]), true);
    assert.equal(termsHaveGaps([{ ...blank, beforeClicks: 1, afterClicks: 2, beforeImpressions: 3, afterImpressions: 4, beforePosition: 5, afterPosition: 6 }]), false);
});
