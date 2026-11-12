import assert from 'node:assert/strict';
import test from 'node:test';

import { dateOffset } from '@/lib/gsc/history';

import { exampleBoard } from './fixture.ts';
import { buildImpact, timelineItem } from './impact.ts';
import {
    clearLiveRange,
    customLiveRange,
    filterChanges,
    formatHeadlinePct,
    headlineFields,
    liveRangeForPreset,
    liveRangeLabel,
    matchLiveRange,
    nextCheck,
    nextCheckCopy,
    pagePath,
    resultDetail,
    sortChanges,
    summaryCounts,
    toggleResult,
    toggleSort,
    DEFAULT_CHANGE_SORT,
} from './list.ts';
import { GSC_LAG_DAYS } from './thresholds.ts';
import { finalThrough, formatDay } from './time.ts';
import type { SeoChange, TimelineItem } from './types.ts';

const TODAY = '2026-11-10';
const FINAL_THROUGH = '2026-11-07';

function sample(liveOn: string, id = 'sample'): SeoChange {
    return {
        id,
        clientId: 'client',
        changeType: 'title',
        title: 'Emergency page search result title',
        beforeText: 'Old title',
        afterText: 'New title',
        liveAt: `${liveOn}T18:00:00.000Z`,
        liveOn,
        approvedByName: 'Carlos',
        approvedAt: null,
        backupReference: '',
        revertInstructions: '',
        kpi: 'clicks',
        compareLastYear: false,
        testKind: 'single',
        treatment: '',
        pages: [{
            url: 'https://summitdental.example/emergency-dentist',
            urlKey: '/emergency-dentist',
            label: 'Emergency',
            cmsPageId: null,
            cmsWidgetId: null,
        }],
        queries: [],
    };
}

function row(partial: Partial<TimelineItem> & Pick<TimelineItem, 'id' | 'title' | 'liveOn'>): TimelineItem {
    return {
        changeType: 'title',
        liveAt: `${partial.liveOn}T18:00:00.000Z`,
        pageLabel: 'Page',
        url: 'https://summitdental.example/page',
        verdict: 'flat',
        estimate: false,
        deltaText: '',
        kpi: 'clicks',
        checkpointDays: null,
        headlineDays: null,
        headlinePct: null,
        nextCheckOn: null,
        nextCheckDays: null,
        ...partial,
    };
}

test('the next check comes from the go-live date and the final-data date', () => {
    assert.equal(finalThrough(new Date('2026-11-10T20:00:00.000Z')), FINAL_THROUGH);
    assert.equal(GSC_LAG_DAYS, 3);
    const cases: { liveOn: string; days: 7 | 14 | 28 | 56; due: string }[] = [
        { liveOn: '2026-11-04', days: 7, due: '2026-11-11' },
        { liveOn: '2026-10-28', days: 14, due: '2026-11-11' },
        { liveOn: '2026-10-20', days: 28, due: '2026-11-17' },
        { liveOn: '2026-10-13', days: 28, due: '2026-11-10' },
        { liveOn: '2026-10-09', days: 56, due: '2026-12-04' },
        { liveOn: '2026-10-06', days: 56, due: '2026-12-01' },
        { liveOn: '2026-10-02', days: 56, due: '2026-11-27' },
    ];
    for (const item of cases) {
        assert.deepEqual(nextCheck(item.liveOn, FINAL_THROUGH), {
            nextCheckDays: item.days,
            nextCheckOn: item.due,
        }, item.liveOn);
    }
    assert.deepEqual(nextCheck('2026-10-02', '2026-12-31'), { nextCheckOn: null, nextCheckDays: null });
    assert.deepEqual(nextCheck('not-a-day', FINAL_THROUGH), { nextCheckOn: null, nextCheckDays: null });
});

test('a due check names the date Google data should catch up, and a future check does not', () => {
    const due = nextCheck('2026-10-13', FINAL_THROUGH);
    const copy = nextCheckCopy({ ...due }, TODAY);
    assert.equal(copy.date, 'Nov 10, 2026');
    assert.equal(copy.check, '28-day check');
    assert.equal(copy.data, `data ~${formatDay(dateOffset(due.nextCheckOn ?? '', GSC_LAG_DAYS))}`);
    assert.equal(copy.data, 'data ~Nov 13');
    const upcoming = nextCheckCopy(nextCheck('2026-11-04', FINAL_THROUGH), TODAY);
    assert.equal(upcoming.date, 'Nov 11, 2026');
    assert.equal(upcoming.check, '7-day check');
    assert.equal(upcoming.data, null);
    assert.deepEqual(nextCheckCopy({ nextCheckOn: null, nextCheckDays: null }, TODAY), {
        date: 'No further check',
        check: '',
        data: null,
    });
});

test('a change that went live today and one with a future date still get a first check', () => {
    const future = '2026-12-01';
    assert.deepEqual(nextCheck(TODAY, FINAL_THROUGH), {
        nextCheckDays: 7,
        nextCheckOn: '2026-11-17',
    });
    assert.deepEqual(nextCheck(future, FINAL_THROUGH), {
        nextCheckDays: 7,
        nextCheckOn: '2026-12-08',
    });
    const todayCopy = nextCheckCopy(nextCheck(TODAY, FINAL_THROUGH), TODAY);
    assert.equal(todayCopy.date, 'Nov 17, 2026');
    assert.equal(todayCopy.check, '7-day check');
    assert.equal(todayCopy.data, null);
    const futureCopy = nextCheckCopy(nextCheck(future, FINAL_THROUGH), TODAY);
    assert.equal(futureCopy.date, 'Dec 8, 2026');
    assert.equal(futureCopy.check, '7-day check');
    assert.equal(futureCopy.data, null);

    const items = [
        row({ id: 'past', title: 'Past', liveOn: '2026-10-02' }),
        row({ id: 'today', title: 'Today', liveOn: TODAY }),
        row({ id: 'future', title: 'Future', liveOn: future }),
    ];
    assert.deepEqual(sortChanges(items, 'live', 'desc').map(item => item.id), ['future', 'today', 'past']);
    assert.deepEqual(filterChanges(items, { to: TODAY }).map(item => item.id), ['past', 'today']);
    assert.deepEqual(filterChanges(items, { from: TODAY }).map(item => item.id), ['today', 'future']);
});

test('headline fields are null when the check is unfinished, never zero', () => {
    assert.deepEqual(headlineFields({ ready: false, days: 7, lift: 0 }), {
        headlineDays: null,
        headlinePct: null,
    });
    assert.deepEqual(headlineFields({ ready: false, days: 7, lift: 0.18 }), {
        headlineDays: null,
        headlinePct: null,
    });
    assert.deepEqual(headlineFields({ ready: true, days: 14, lift: null }), {
        headlineDays: 14,
        headlinePct: null,
    });
    assert.deepEqual(headlineFields({ ready: true, days: 14, lift: 0.18 }), {
        headlineDays: 14,
        headlinePct: 18,
    });
    assert.deepEqual(headlineFields({ ready: true, days: 28, lift: -0.142 }), {
        headlineDays: 28,
        headlinePct: -14.2,
    });
    assert.equal(formatHeadlinePct(null), null);
    assert.equal(formatHeadlinePct(18), '+18%');
    assert.equal(formatHeadlinePct(-14), '−14%');
    assert.equal(formatHeadlinePct(9), '+9%');
    assert.equal(formatHeadlinePct(null) === '0%', false);
    assert.equal(resultDetail({ headlineDays: null }), 'Not ready yet');
    assert.equal(resultDetail({ headlineDays: 14 }), '14-day check');
});

test('the list row copies headline and next-check fields from the read, without storing them', () => {
    const now = new Date('2026-11-10T20:00:00.000Z');
    const impact = buildImpact({
        liveOn: '2026-11-04',
        kpi: 'clicks',
        now,
        compareLastYear: false,
        gscConnected: true,
        ga4Connected: false,
        pageDays: [],
        sitewideDays: [],
    });
    const item = timelineItem(sample('2026-11-04'), impact);
    assert.equal(impact.finalThrough, FINAL_THROUGH);
    assert.equal(item.verdict, 'too_early');
    assert.equal(item.headlineDays, null);
    assert.equal(item.headlinePct, null);
    assert.equal(item.nextCheckDays, 7);
    assert.equal(item.nextCheckOn, '2026-11-11');

    const board = exampleBoard();
    for (const change of board.changes) {
        const listed = board.items.find(row => row.id === change.id);
        const read = board.impacts[change.id];
        assert.ok(listed);
        assert.deepEqual(
            { headlineDays: listed.headlineDays, headlinePct: listed.headlinePct },
            headlineFields(read.headline),
        );
        assert.deepEqual(
            { nextCheckOn: listed.nextCheckOn, nextCheckDays: listed.nextCheckDays },
            nextCheck(change.liveOn, read.finalThrough),
        );
        if (listed.headlineDays != null) assert.notEqual(listed.headlinePct, 0);
    }
    const h1 = board.items.find(row => row.id === 'example-ecoworkz-h1');
    assert.equal(h1?.headlineDays, 28);
    assert.equal(h1?.nextCheckDays, 56);
    assert.equal(h1?.nextCheckOn, '2027-01-05');
});

test('summary counts match the filtered list, and a result click toggles that bucket', () => {
    const items = [
        row({ id: 'a', title: 'Alpha', liveOn: '2026-11-04', verdict: 'too_early' }),
        row({ id: 'b', title: 'Bravo', liveOn: '2026-10-28', verdict: 'improved', estimate: true, headlineDays: 7, headlinePct: 9 }),
        row({ id: 'c', title: 'Charlie', liveOn: '2026-10-06', changeType: 'content_refresh', verdict: 'declined', headlineDays: 28, headlinePct: -14 }),
        row({ id: 'd', title: 'Delta', liveOn: '2026-10-13', verdict: 'improved', headlineDays: 14, headlinePct: 18 }),
        row({ id: 'e', title: 'Echo', liveOn: '2026-10-20', verdict: 'flat', headlineDays: 14, headlinePct: 2 }),
    ];
    const filtered = filterChanges(items, { from: '2026-10-10', to: '2026-11-30' });
    const counts = summaryCounts(filtered);
    assert.deepEqual(counts, {
        improved: 1,
        flat: 1,
        declined: 0,
        too_early: 1,
        early_estimate: 1,
    });
    assert.equal(
        counts.improved + counts.flat + counts.declined + counts.too_early + counts.early_estimate,
        filtered.length,
    );
    assert.equal(toggleResult(null, 'improved'), 'improved');
    assert.equal(toggleResult('improved', 'improved'), null);
    assert.equal(toggleResult('improved', 'declined'), 'declined');
    const shown = filterChanges(filtered, { result: 'improved' });
    assert.equal(shown.length, counts.improved);
    assert.deepEqual(shown.map(item => item.id), ['d']);
    assert.deepEqual(summaryCounts(filtered), counts);
    const searched = filterChanges(items, { query: 'charlie' });
    assert.deepEqual(summaryCounts(searched), {
        improved: 0,
        flat: 0,
        declined: 1,
        too_early: 0,
        early_estimate: 0,
    });
});

test('every column sorts, went live starts newest first, and missing values are not zero', () => {
    assert.deepEqual(DEFAULT_CHANGE_SORT, { key: 'live', direction: 'desc' });
    const items = [
        row({
            id: 'early',
            title: 'Emergency page',
            liveOn: '2026-11-04',
            changeType: 'title',
            kpi: 'clicks',
            verdict: 'too_early',
            headlinePct: null,
            nextCheckOn: '2026-11-11',
            nextCheckDays: 7,
            url: 'https://summitdental.example/emergency-dentist',
        }),
        row({
            id: 'estimate',
            title: 'Invisalign links',
            liveOn: '2026-10-28',
            changeType: 'internal_links',
            kpi: 'impressions',
            verdict: 'improved',
            estimate: true,
            headlineDays: 7,
            headlinePct: 9,
            nextCheckOn: '2026-11-11',
            nextCheckDays: 14,
            url: 'https://summitdental.example/invisalign',
        }),
        row({
            id: 'declined',
            title: 'Whitening update',
            liveOn: '2026-10-06',
            changeType: 'content_refresh',
            kpi: 'organic_sessions',
            verdict: 'declined',
            headlineDays: 28,
            headlinePct: -14,
            nextCheckOn: null,
            nextCheckDays: null,
            url: 'https://summitdental.example/teeth-whitening',
        }),
        row({
            id: 'flat',
            title: 'Homepage description',
            liveOn: '2026-10-20',
            liveAt: '2026-10-20T12:00:00.000Z',
            changeType: 'meta',
            kpi: 'ctr',
            verdict: 'flat',
            headlineDays: 14,
            headlinePct: 2,
            nextCheckOn: '2026-11-17',
            nextCheckDays: 28,
            url: 'https://summitdental.example/',
            pageLabel: 'Homepage',
        }),
    ];
    assert.deepEqual(sortChanges(items, 'live', 'desc').map(item => item.id), ['early', 'estimate', 'flat', 'declined']);
    assert.deepEqual(sortChanges(items, 'live', 'asc').map(item => item.id), ['declined', 'flat', 'estimate', 'early']);
    assert.deepEqual(sortChanges(items, 'change', 'asc').map(item => item.id), ['early', 'flat', 'estimate', 'declined']);
    assert.deepEqual(sortChanges(items, 'type', 'asc').map(item => item.id), ['declined', 'estimate', 'flat', 'early']);
    assert.deepEqual(sortChanges(items, 'watching', 'asc').map(item => item.id), ['flat', 'early', 'estimate', 'declined']);
    assert.deepEqual(sortChanges(items, 'result', 'asc').map(item => item.id), ['declined', 'estimate', 'flat', 'early']);
    assert.deepEqual(sortChanges(items, 'next', 'asc').map(item => item.id), ['early', 'estimate', 'flat', 'declined']);
    assert.deepEqual(sortChanges(items, 'next', 'desc').map(item => item.id), ['flat', 'estimate', 'early', 'declined']);
    const byPercent = sortChanges(items, 'result', 'asc');
    const nullIndex = byPercent.findIndex(item => item.headlinePct == null);
    const zeroWouldBe = byPercent.findIndex(item => (item.headlinePct ?? 0) < 0);
    assert.ok(nullIndex > zeroWouldBe);
    assert.equal(toggleSort(DEFAULT_CHANGE_SORT, 'live').direction, 'asc');
    assert.deepEqual(toggleSort(DEFAULT_CHANGE_SORT, 'type'), { key: 'type', direction: 'asc' });
    for (const key of ['change', 'type', 'live', 'watching', 'result'] as const) {
        const sorted = sortChanges(items, key, 'asc').map(item => item.id);
        assert.deepEqual(sortChanges(items, key, 'desc').map(item => item.id).reverse(), sorted);
    }
});

test('went-live presets, a custom range, and clearing compose with search, type, and result', () => {
    assert.deepEqual(liveRangeForPreset('30', TODAY), { from: '2026-10-12', to: TODAY });
    assert.deepEqual(liveRangeForPreset('90', TODAY), { from: '2026-08-13', to: TODAY });
    assert.deepEqual(liveRangeForPreset('all', TODAY), clearLiveRange());
    assert.deepEqual(liveRangeForPreset('30', 'not-a-day'), clearLiveRange());
    assert.deepEqual(clearLiveRange(), { from: '', to: '' });
    assert.equal(matchLiveRange(clearLiveRange(), TODAY), 'all');
    assert.equal(matchLiveRange(liveRangeForPreset('30', TODAY), TODAY), '30');
    assert.equal(matchLiveRange(liveRangeForPreset('90', TODAY), TODAY), '90');
    assert.equal(matchLiveRange({ from: '2026-10-01', to: '2026-10-20' }, TODAY), 'custom');
    assert.deepEqual(customLiveRange('2026-11-02', '2026-10-01'), { from: '2026-10-01', to: '2026-11-02' });
    assert.deepEqual(customLiveRange('', 'soon'), clearLiveRange());
    assert.equal(liveRangeLabel(liveRangeForPreset('90', TODAY), TODAY), 'Last 90 days');
    assert.equal(liveRangeLabel(clearLiveRange(), TODAY), 'All time');
    assert.equal(liveRangeLabel({ from: '2026-10-01', to: '2026-10-20' }, TODAY), 'Oct 1, 2026 – Oct 20, 2026');
    assert.equal(liveRangeLabel({ from: '2026-10-12', to: '' }, TODAY), 'From Oct 12, 2026');
    assert.equal(liveRangeLabel({ from: '', to: TODAY }, TODAY), 'Through Nov 10, 2026');

    const items = [
        row({ id: 'today', title: 'Emergency title', liveOn: TODAY, changeType: 'title', verdict: 'too_early' }),
        row({ id: 'future', title: 'Future heading', liveOn: '2026-12-01', changeType: 'h1', verdict: 'too_early' }),
        row({ id: 'old', title: 'Old redirect', liveOn: '2026-01-15', changeType: 'redirect', verdict: 'improved', headlineDays: 28, headlinePct: 11 }),
        row({ id: 'edge', title: 'Edge day', liveOn: '2026-10-12', changeType: 'meta', verdict: 'flat', headlineDays: 14, headlinePct: 2 }),
        row({ id: 'before', title: 'Day before', liveOn: '2026-10-11', changeType: 'meta', verdict: 'declined', headlineDays: 28, headlinePct: -4 }),
        row({ id: 'home', title: 'Homepage heading', liveOn: '2026-10-13', changeType: 'h1', verdict: 'improved', headlineDays: 14, headlinePct: 18 }),
    ];

    assert.deepEqual(filterChanges(items, liveRangeForPreset('30', TODAY)).map(item => item.id), ['today', 'edge', 'home']);
    assert.deepEqual(filterChanges(items, liveRangeForPreset('90', TODAY)).map(item => item.id), ['today', 'edge', 'before', 'home']);
    assert.deepEqual(
        filterChanges(items, customLiveRange('2026-10-13', '2026-10-12')).map(item => item.id),
        ['edge', 'home'],
    );
    assert.equal(filterChanges(items, clearLiveRange()).length, items.length);

    const narrowed = filterChanges(items, {
        ...liveRangeForPreset('30', TODAY),
        type: 'h1',
        query: 'homepage',
    });
    assert.deepEqual(narrowed.map(item => item.id), ['home']);
    const counts = summaryCounts(narrowed);
    assert.deepEqual(counts, {
        improved: 1,
        flat: 0,
        declined: 0,
        too_early: 0,
        early_estimate: 0,
    });
    assert.deepEqual(filterChanges(narrowed, { result: 'improved' }).map(item => item.id), ['home']);
    assert.equal(filterChanges(narrowed, { result: 'declined' }).length, 0);
    assert.deepEqual(summaryCounts(narrowed), counts);

    const ranged = filterChanges(items, liveRangeForPreset('90', TODAY));
    const rangedCounts = summaryCounts(ranged);
    assert.deepEqual(rangedCounts, {
        improved: 1,
        flat: 1,
        declined: 1,
        too_early: 1,
        early_estimate: 0,
    });
    assert.deepEqual(filterChanges(ranged, { result: 'declined' }).map(item => item.id), ['before']);
    assert.deepEqual(summaryCounts(ranged), rangedCounts);
    assert.equal(
        rangedCounts.improved + rangedCounts.flat + rangedCounts.declined + rangedCounts.too_early + rangedCounts.early_estimate,
        ranged.length,
    );
});

test('the page path is the address under the title', () => {
    assert.equal(pagePath('https://summitdental.example/emergency-dentist', 'Emergency'), '/emergency-dentist');
    assert.equal(pagePath('https://www.ecoworkz.net/', 'Homepage'), 'Homepage');
    assert.equal(pagePath('/invisalign', 'Invisalign'), '/invisalign');
    assert.equal(pagePath('', 'Homepage'), 'Homepage');
});
