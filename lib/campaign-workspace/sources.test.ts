import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dateOffset } from '@/lib/gsc/history.ts';
import type { HistoryDay, HistoryRow } from '@/lib/gsc/insights.ts';
import { formatDelta } from '@/lib/reporting/delta.ts';
import { pairedWindows, periodMetrics, propertySeries } from '@/lib/search-dashboard/model.ts';
import {
    campaignIdentity,
    campaignLocalProfile,
    campaignSitewide,
    countAwaitingApproval,
} from './sources.ts';

const TODAY = '2026-10-29';
const END = '2026-10-28';

function storedDays(clicksFor: (index: number) => number, mutate?: (day: HistoryDay, index: number) => void) {
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
        rows.push({
            id: index + 1,
            dayId: day.id,
            page: '',
            query: '',
            clicks: clicksFor(index),
            impressions: 20,
            position: 6,
        });
    }
    return { days, rows };
}

test('a complete property window matches the Search dashboard total and keeps GBP out', () => {
    const { days, rows } = storedDays(index => (index < 28 ? 4 : 5));
    const flags = days.map(day => ({ date: day.date, isIncomplete: Boolean(day.isIncomplete) }));
    const window = pairedWindows(flags, TODAY);
    assert.ok(window);
    assert.equal(window.comparable, true);
    const expected = periodMetrics(propertySeries(days, rows, window.current)).clicks;
    const prior = periodMetrics(propertySeries(days, rows, window.prior)).clicks;
    const sitewide = campaignSitewide({ connected: true, days, rows, today: TODAY });
    assert.equal(expected, 140);
    assert.equal(prior, 112);
    assert.equal(sitewide.clicks, expected);
    assert.equal(sitewide.priorClicks, prior);
    assert.equal(sitewide.points.length, 28);
    assert.equal(sitewide.points.every(point => point.clicks === 5), true);
    assert.equal(sitewide.baselineDaily, 4);
    const delta = formatDelta(expected, prior, { metric: 'count', audience: 'staff', presentation: 'reporting' });
    assert.equal(delta.percent, 25);
    assert.match(sitewide.deltaLabel ?? '', /25% vs baseline/);
    assert.match(sitewide.baselineCaption ?? '', /112/);

    const now = new Date('2026-10-29T20:00:00Z');
    const local = campaignLocalProfile([
        { metricMonth: '2026-10', data: { calls: 50 } },
        { metricMonth: '2026-09', data: { calls: 8, direction_requests: 1 } },
        { metricMonth: '2026-08', data: { calls: 3 } },
    ], now);
    assert.equal(local.value, 8);
    assert.equal(local.label, 'Call-button taps');
    assert.equal(local.priorValue, 3);
    assert.equal(sitewide.clicks, 140);
    assert.notEqual(sitewide.clicks, (sitewide.clicks ?? 0) + (local.value ?? 0));
});

test('missing and incomplete Search Console stays unmeasured instead of zero', () => {
    const absent = campaignSitewide({ connected: false, days: [], rows: [], today: TODAY });
    assert.equal(absent.status, 'not_measurable');
    assert.equal(absent.reason, 'unavailable');
    assert.equal(absent.clicks, null);
    const noDays = campaignSitewide({ connected: true, days: [], rows: [], today: TODAY });
    assert.equal(noDays.reason, 'missing');
    assert.equal(noDays.clicks, null);
    assert.equal(absent.points.length, 0);
    assert.equal(absent.baselineDaily, null);

    const { days, rows } = storedDays(index => (index < 28 ? 4 : 5), (day, index) => {
        if (index === 40) day.isIncomplete = true;
    });
    const partial = campaignSitewide({ connected: true, days, rows, today: TODAY });
    assert.equal(partial.clicks, null);
    assert.equal(partial.reason, 'incomplete');
    assert.equal(partial.points.length, 0);

    const emptyRows = storedDays(() => 0);
    emptyRows.rows = [];
    const noRows = campaignSitewide({ connected: true, days: emptyRows.days, rows: [], today: TODAY });
    assert.equal(noRows.clicks, null);

    const zeros = storedDays(() => 0);
    const measuredZero = campaignSitewide({ connected: true, days: zeros.days, rows: zeros.rows, today: TODAY });
    assert.equal(measuredZero.status, 'measurable');
    assert.equal(measuredZero.clicks, 0);
});

test('Business Profile uses its own closed month and does not treat a missing series as zero', () => {
    const now = new Date('2026-10-29T20:00:00Z');
    const openOnly = campaignLocalProfile([{ metricMonth: '2026-10', data: { calls: 50 } }], now);
    assert.equal(openOnly.value, null);
    assert.equal(openOnly.status, 'not_measurable');

    const absentSeries = campaignLocalProfile([{ metricMonth: '2026-09', data: { calls: null, review_count: 12 } }], now);
    assert.equal(absentSeries.value, null);

    const text = campaignLocalProfile([{ metricMonth: '2026-09', data: { calls: '8' } }], now);
    assert.equal(text.value, null);

    const directions = campaignLocalProfile([{ metricMonth: '2026-09', data: { calls: null, direction_requests: 6 } }], now);
    assert.equal(directions.value, 6);
    assert.equal(directions.label, 'Directions');
    assert.equal(directions.priorValue, null);

    const zero = campaignLocalProfile([{ metricMonth: '2026-09', data: { calls: 0 } }], now);
    assert.equal(zero.status, 'measurable');
    assert.equal(zero.value, 0);
});

test('approval count reuses the in-review sent-document rule', () => {
    assert.equal(countAwaitingApproval([
        { batchStatus: 'in_review', sentAt: '2026-10-01', status: 'pending', archivedAt: null },
        { batchStatus: 'in_review', sentAt: '2026-10-01', status: 'changes_requested', archivedAt: null },
        { batchStatus: 'in_review', sentAt: '2026-10-01', status: 'approved', archivedAt: null },
        { batchStatus: 'in_review', sentAt: null, status: 'pending', archivedAt: null },
        { batchStatus: 'draft', sentAt: '2026-10-01', status: 'pending', archivedAt: null },
        { batchStatus: 'in_review', sentAt: '2026-10-01', status: 'pending', archivedAt: '2026-10-02' },
        { batchStatus: 'archived', sentAt: '2026-10-01', status: 'pending', archivedAt: null },
    ]), 2);
    assert.equal(countAwaitingApproval([]), 0);
});

test('identity uses client fields and leaves derived blanks unset', () => {
    const empty = campaignIdentity({});
    assert.equal(empty.startDate, null);
    assert.equal(empty.owner, null);
    assert.equal(empty.scope, null);

    const filled = campaignIdentity({
        launchDate: '2026-01-04',
        launchDateOverride: '2026-03-02',
        accountManager: 'Alex Kim',
        seoHours: 10,
        deliverablesSpec: '2x/month',
    });
    assert.equal(filled.startDate, '2026-03-02');
    assert.equal(filled.startLabel, 'Mar 2, 2026');
    assert.equal(filled.owner, 'Alex Kim');
    assert.equal(filled.scope, '2x/month · 10 SEO hours / month');

    assert.equal(campaignIdentity({ accountManager: 'Unassigned', seoHours: 0 }).owner, null);
    assert.equal(campaignIdentity({ accountManager: 'Unassigned', seoHours: 0 }).scope, null);
    assert.equal(campaignIdentity({
        campaignStart: '2026-02-01',
        onboardingDate: '2026-02-01',
    }).startDate, null);
    assert.equal(campaignIdentity({
        campaignStart: '2026-04-01',
        onboardingDate: '2026-02-01',
    }).startDate, '2026-04-01');
});

test('campaign workspace source does not touch campaign plans, rankings, or migrations', () => {
    const dirs = [
        new URL('./', import.meta.url),
        new URL('../../components/campaign-workspace/', import.meta.url),
    ];
    const text = dirs.flatMap(dir => readdirSync(dir)
        .filter(name => (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.test.ts'))
        .map(name => readFileSync(new URL(name, dir), 'utf8')))
        .join('\n');
    assert.equal(text.includes('campaign_plans'), false);
    assert.equal(text.includes('campaign-plans'), false);
    assert.equal(text.includes('tracked_keywords'), false);
    assert.equal(text.includes('CREATE TABLE'), false);
    assert.equal(text.includes('migrations/'), false);
    assert.match(text, /pairedWindows/);
    assert.match(text, /propertySeries/);
    assert.match(text, /periodMetrics/);
    assert.match(text, /from\('metrics'\)/);
    assert.match(text, /source', 'gbp'|source: 'gbp'/);
});
