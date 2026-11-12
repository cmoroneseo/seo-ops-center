import assert from 'node:assert/strict';
import test from 'node:test';

import { dateOffset } from '@/lib/gsc/history';

import {
    ALIGNED_NOTE,
    LAG_LABEL,
    REVERSED_NOTE,
    WEEKLY_NOTE,
    buildDailyChart,
    buildSideBySide,
    chartDomain,
    dailyChartTitle,
    indexToBaseline,
    lagWindow,
    samePageMarkers,
    type MeasuredDay,
} from './chart';
import { GSC_LAG_DAYS } from './thresholds';

const LIVE = '2026-10-13';
const FINAL = '2026-10-20';

function day(date: string, clicks: number, impressions = 10, position = 4): MeasuredDay {
    return { date, clicks, impressions, position };
}

test('daily counts keep real zeros and leave missing days as gaps', () => {
    const model = buildDailyChart({
        metric: 'clicks',
        liveOn: LIVE,
        finalThrough: FINAL,
        lowData: false,
        days: [
            day('2026-10-01', 0, 5, 8),
            day('2026-10-03', 4, 5, 8),
            day(LIVE, 6, 5, 8),
        ],
    });
    const byDate = new Map(model.points.map(point => [point.date, point.value]));
    assert.equal(byDate.get('2026-10-01'), 0);
    assert.equal(byDate.get('2026-10-02'), null);
    assert.equal(byDate.get('2026-10-03'), 4);
    assert.notEqual(byDate.get('2026-10-02'), 0);
    assert.equal(model.points.some(point => point.date === '2026-10-02'), true);
    assert.equal(model.reversed, false);
    assert.equal(model.reversedNote, null);
    assert.equal(model.weekly, false);
    assert.equal(model.title, 'Clicks from Google, day by day');
});

test('the lag window is the last three days and those days are not drawn as zero', () => {
    const domain = chartDomain(LIVE, FINAL);
    const lag = lagWindow(FINAL, domain);
    assert.equal(GSC_LAG_DAYS, 3);
    assert.deepEqual(lag, { start: '2026-10-21', end: '2026-10-23' });
    const model = buildDailyChart({
        metric: 'clicks',
        liveOn: LIVE,
        finalThrough: FINAL,
        lowData: false,
        days: [day('2026-10-21', 99), day('2026-10-23', 99), day(FINAL, 3)],
    });
    assert.equal(model.lagStart, '2026-10-21');
    assert.equal(model.lagEnd, '2026-10-23');
    assert.equal(model.lagLabel, LAG_LABEL);
    const waiting = model.points.filter(point => point.date >= '2026-10-21' && point.date <= '2026-10-23');
    assert.equal(waiting.length, 3);
    assert.ok(waiting.every(point => point.value == null));
    assert.equal(model.points.find(point => point.date === FINAL)?.value, 3);
    const old = lagWindow('2026-06-01', chartDomain('2026-01-01', '2026-06-01'));
    assert.equal(old, null);
});

test('before and after averages use measured days only and stop before the lag', () => {
    const model = buildDailyChart({
        metric: 'clicks',
        liveOn: LIVE,
        finalThrough: FINAL,
        lowData: false,
        days: [
            day('2026-10-10', 0),
            day('2026-10-12', 4),
            day(LIVE, 10),
            day('2026-10-14', 20),
            day('2026-10-21', 1000),
        ],
    });
    assert.equal(model.beforeAverage, 2);
    assert.equal(model.afterAverage, 15);
    const before = model.points.filter(point => point.date < LIVE && point.beforeAverage != null);
    const after = model.points.filter(point => point.afterAverage != null);
    assert.ok(before.length > 0);
    assert.ok(before.every(point => point.beforeAverage === 2 && point.date < LIVE));
    assert.ok(after.every(point => point.date >= LIVE && point.date <= FINAL && point.afterAverage === 15));
    assert.equal(model.points.some(point => point.date > FINAL && point.afterAverage != null), false);
});

test('low data uses weekly totals, with gaps for empty weeks and zeros for real zeros', () => {
    const beforeStart = dateOffset(LIVE, -28);
    const weekTwo = dateOffset(beforeStart, 7);
    const weekThree = dateOffset(beforeStart, 14);
    const days: MeasuredDay[] = [
        day(beforeStart, 1, 10, 2),
        day(dateOffset(beforeStart, 1), 1, 2, 8),
    ];
    for (let offset = 0; offset < 7; offset += 1) {
        days.push(day(dateOffset(weekThree, offset), 0, 4, 6));
    }
    const clicks = buildDailyChart({
        metric: 'clicks',
        liveOn: LIVE,
        finalThrough: '2026-11-30',
        lowData: true,
        days,
    });
    assert.equal(clicks.weekly, true);
    assert.equal(clicks.weeklyNote, WEEKLY_NOTE);
    assert.equal(clicks.title, 'Clicks from Google, week by week');
    const beforeWeeks = clicks.points.filter(point => point.date < LIVE);
    assert.equal(beforeWeeks.length, 4);
    assert.equal(beforeWeeks[0].value, 2);
    assert.equal(beforeWeeks[1].value, null);
    assert.equal(beforeWeeks[2].value, 0);
    assert.notEqual(beforeWeeks[1].value, 0);
    assert.equal(beforeWeeks[0].date, beforeStart);
    assert.equal(beforeWeeks[1].date, weekTwo);

    const rates = buildDailyChart({
        metric: 'ctr',
        liveOn: LIVE,
        finalThrough: '2026-11-30',
        lowData: true,
        days,
    });
    assert.equal(rates.points.find(point => point.date === beforeStart)?.value, 2 / 12);
    const position = buildDailyChart({
        metric: 'avg_position',
        liveOn: LIVE,
        finalThrough: '2026-11-30',
        lowData: true,
        days,
    });
    assert.equal(position.points.find(point => point.date === beforeStart)?.value, (2 * 10 + 8 * 2) / 12);
    assert.equal(position.reversed, true);
    assert.equal(position.reversedNote, REVERSED_NOTE);
});

test('average position reverses the axis and a day with no impressions is a gap', () => {
    const model = buildDailyChart({
        metric: 'avg_position',
        liveOn: LIVE,
        finalThrough: FINAL,
        lowData: false,
        days: [
            day('2026-10-10', 0, 0, 0),
            day('2026-10-11', 2, 8, 3.5),
        ],
    });
    assert.equal(model.reversed, true);
    assert.equal(model.reversedNote, REVERSED_NOTE);
    assert.equal(model.points.find(point => point.date === '2026-10-10')?.value, null);
    assert.equal(model.points.find(point => point.date === '2026-10-11')?.value, 3.5);
    assert.equal(dailyChartTitle('avg_position'), 'Average position from Google, day by day');
    const rate = buildDailyChart({
        metric: 'ctr',
        liveOn: LIVE,
        finalThrough: FINAL,
        lowData: false,
        days: [day('2026-10-11', 0, 8, 3)],
    });
    assert.equal(rate.points.find(point => point.date === '2026-10-11')?.value, 0);
    assert.equal(rate.reversed, false);
});

test('markers are other changes on the same page, placed inside the window', () => {
    const focus = { id: 'heading', pageKeys: ['summit.example/'] };
    const markers = samePageMarkers(focus, [
        { id: 'heading', title: 'Homepage main heading', liveOn: LIVE, pageKeys: ['summit.example/'] },
        { id: 'description', title: 'Homepage search result description', liveOn: '2026-10-16', pageKeys: ['summit.example/'] },
        { id: 'other-page', title: 'Emergency page title', liveOn: '2026-10-16', pageKeys: ['summit.example/emergency'] },
        { id: 'outside', title: 'Old homepage change', liveOn: '2026-01-02', pageKeys: ['summit.example/'] },
    ]);
    assert.deepEqual(markers.map(marker => marker.id), ['outside', 'description']);
    const model = buildDailyChart({
        metric: 'clicks',
        liveOn: LIVE,
        finalThrough: FINAL,
        lowData: false,
        days: [day('2026-10-10', 4), day('2026-10-16', 0)],
        markers: [
            ...markers,
            { id: 'outside', title: 'Old homepage change', liveOn: '2026-01-02' },
            { id: 'gap', title: 'A change on a missing day', liveOn: '2026-10-18' },
        ],
    });
    assert.deepEqual(model.markers.map(marker => marker.id), ['description', 'gap']);
    assert.equal(model.markers[0].date, '2026-10-16');
    assert.equal(model.markers[0].value, 0);
    assert.equal(model.markers[0].title, 'Homepage search result description');
    assert.equal(model.markers[1].date, '2026-10-18');
    assert.equal(model.markers[1].value, model.afterAverage);
});

test('a marker with no measured day and no average is left off', () => {
    const model = buildDailyChart({
        metric: 'clicks',
        liveOn: LIVE,
        finalThrough: FINAL,
        lowData: false,
        days: [],
        markers: [{ id: 'gap', title: 'Nothing to sit on', liveOn: '2026-10-18' }],
    });
    assert.equal(model.beforeAverage, null);
    assert.equal(model.afterAverage, null);
    assert.deepEqual(model.markers, []);
});

test('overlay lines up the windows by day number and does not invent later days', () => {
    const beforeStart = dateOffset(LIVE, -28);
    const model = buildSideBySide({
        metric: 'clicks',
        liveOn: LIVE,
        finalThrough: FINAL,
        lowData: false,
        days: [
            day(beforeStart, 2),
            day(dateOffset(beforeStart, 1), 0),
            day(LIVE, 5),
            day('2026-10-21', 99),
        ],
    });
    assert.equal(model.points.length, 28);
    assert.equal(model.points[0].day, 1);
    assert.equal(model.points[0].before, 2);
    assert.equal(model.points[0].after, 5);
    assert.equal(model.points[1].before, 0);
    assert.equal(model.points[1].after, null);
    assert.equal(model.note, ALIGNED_NOTE);
    assert.equal(model.wentLiveMarker, false);
    const lastFinalAfter = model.points.find(point => point.day === 8);
    assert.equal(lastFinalAfter?.after, null);
    assert.ok(model.points.slice(8).every(point => point.after == null));
    assert.equal(model.reversed, false);

    const weekly = buildSideBySide({
        metric: 'impressions',
        liveOn: LIVE,
        finalThrough: '2026-11-30',
        lowData: true,
        days: [day(beforeStart, 1, 3), day(LIVE, 1, 4)],
    });
    assert.equal(weekly.weekly, true);
    assert.equal(weekly.points.length, 4);
    assert.equal(weekly.points[0].before, 3);
    assert.equal(weekly.points[0].after, 4);
    assert.equal(weekly.points[1].before, null);
});

test('the indexed view keeps each line on its own starting point and does not fill gaps', () => {
    const indexed = indexToBaseline([
        { date: '2026-10-01', page: 10, control: 100 },
        { date: '2026-10-02', page: null, control: null },
        { date: '2026-10-12', page: 10, control: 100 },
        { date: LIVE, page: 0, control: 110 },
        { date: '2026-10-14', page: 15, control: 110 },
    ], LIVE);
    assert.equal(indexed.hasControl, true);
    assert.equal(indexed.points[0].page, 100);
    assert.equal(indexed.points[0].control, 100);
    assert.equal(indexed.points[1].page, null);
    assert.equal(indexed.points[1].control, null);
    assert.equal(indexed.points[3].page, 0);
    assert.equal(indexed.points[4].page, 150);
    assert.equal(Math.round(indexed.points[4].control ?? 0), 110);
    const noBase = indexToBaseline([
        { date: '2026-10-01', page: 0, control: null },
        { date: LIVE, page: 5, control: null },
    ], LIVE);
    assert.equal(noBase.hasControl, false);
    assert.ok(noBase.points.every(point => point.page == null && point.control == null));
});
