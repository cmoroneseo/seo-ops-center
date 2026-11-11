import assert from 'node:assert/strict';
import test from 'node:test';

import { dateOffset } from '@/lib/gsc/history';
import { eachDate } from '@/lib/search-reporting/range';

import { impactCsv } from './csv';
import { ecoworkzH1Input, exampleBoard, exampleConfounders, EXAMPLE_AS_OF } from './fixture';
import { buildImpact, findConfounders } from './impact';
import { gscPageCandidates, pageMatchesChange } from './match';
import { finalThrough, ptLocalToIso, sameDateLastYear } from './time';
import { GSC_LAG_DAYS, VERDICT_THRESHOLDS } from './thresholds';
import type { DayPoint, Kpi } from './types';
import { normalizeChange, validateChange } from './validate';

const DAY: Omit<DayPoint, 'date'> = {
    clicks: 8,
    impressions: 200,
    position: 22,
    organicSessions: 4,
    keyEvents: 1,
};

function fill(start: string, end: string, daily: Omit<DayPoint, 'date'>): DayPoint[] {
    return eachDate(start, end).map(date => ({ date, ...daily }));
}

function source(input: {
    liveOn: string;
    now: Date;
    pageBefore: Omit<DayPoint, 'date'>;
    pageAfter: Omit<DayPoint, 'date'>;
    siteBefore: Omit<DayPoint, 'date'>;
    siteAfter: Omit<DayPoint, 'date'>;
    kpi?: Kpi;
    through?: string;
    gscConnected?: boolean;
}) {
    const beforeStart = dateOffset(input.liveOn, -28);
    const beforeEnd = dateOffset(input.liveOn, -1);
    const afterEnd = input.through ?? dateOffset(input.liveOn, 55);
    return buildImpact({
        liveOn: input.liveOn,
        kpi: input.kpi ?? 'clicks',
        now: input.now,
        compareLastYear: false,
        gscConnected: input.gscConnected ?? true,
        ga4Connected: true,
        pageDays: [
            ...fill(beforeStart, beforeEnd, input.pageBefore),
            ...fill(input.liveOn, afterEnd, input.pageAfter),
        ],
        sitewideDays: [
            ...fill(beforeStart, beforeEnd, input.siteBefore),
            ...fill(input.liveOn, afterEnd, input.siteAfter),
        ],
    });
}

test('thresholds stay the documented bands', () => {
    assert.equal(GSC_LAG_DAYS, 3);
    assert.equal(VERDICT_THRESHOLDS.controlLift, 0.10);
    assert.equal(VERDICT_THRESHOLDS.pageBand, 0.15);
    assert.equal(VERDICT_THRESHOLDS.minBaselineDays, 21);
    assert.equal(VERDICT_THRESHOLDS.positionNoise, 1);
    assert.equal(VERDICT_THRESHOLDS.lowDataImpressions, 100);
});

test('a page that beats a flat control is improved', () => {
    const impact = source({
        liveOn: '2026-11-10',
        now: EXAMPLE_AS_OF,
        pageBefore: { ...DAY, clicks: 8, position: 22 },
        pageAfter: { ...DAY, clicks: 12, impressions: 210, position: 16 },
        siteBefore: { ...DAY, clicks: 88, impressions: 2200, position: 19 },
        siteAfter: { ...DAY, clicks: 94, impressions: 2230, position: 18.5 },
    });
    assert.equal(impact.finalThrough, '2026-12-12');
    assert.equal(impact.headline.days, 28);
    assert.equal(impact.headline.verdict, 'improved');
    assert.equal(impact.headline.estimate, false);
    assert.equal(impact.headline.controlMode, 'untouched');
    assert.ok((impact.headline.lift ?? 0) > VERDICT_THRESHOLDS.controlLift);
    assert.equal(impact.checkpoints.find(row => row.days === 7)?.verdict, 'improved');
    assert.ok((impact.checkpoints.find(row => row.days === 7)?.pageMove.helpful ?? 0) > 0);
    assert.equal(impact.checkpoints.find(row => row.days === 56)?.ready, false);
    assert.equal(impact.checkpoints.find(row => row.days === 56)?.verdict, 'too_early');
    assert.equal(impact.causation, "Lines up with the change. Doesn't prove the change caused it.");
});

test('a sitewide swing is not credited to the change', () => {
    const impact = source({
        liveOn: '2026-11-10',
        now: EXAMPLE_AS_OF,
        pageBefore: { ...DAY, clicks: 8 },
        pageAfter: { ...DAY, clicks: 12 },
        siteBefore: { ...DAY, clicks: 88, impressions: 2200 },
        siteAfter: { ...DAY, clicks: 132, impressions: 3300 },
    });
    assert.equal(impact.headline.verdict, 'flat');
    assert.match(impact.headline.note, /rest of the site/i);
});

test('a page that falls further than the control is declined', () => {
    const impact = source({
        liveOn: '2026-11-10',
        now: EXAMPLE_AS_OF,
        pageBefore: { ...DAY, clicks: 12 },
        pageAfter: { ...DAY, clicks: 6 },
        siteBefore: { ...DAY, clicks: 80, impressions: 2000 },
        siteAfter: { ...DAY, clicks: 80, impressions: 2000 },
    });
    assert.equal(impact.headline.verdict, 'declined');
});

test('the live day itself is too early while Search Console is still behind', () => {
    const impact = source({
        liveOn: '2026-11-10',
        now: new Date('2026-11-10T22:04:00.000Z'),
        pageBefore: DAY,
        pageAfter: { ...DAY, clicks: 12 },
        siteBefore: { ...DAY, clicks: 80, impressions: 2000 },
        siteAfter: { ...DAY, clicks: 80, impressions: 2000 },
    });
    assert.equal(finalThrough(new Date('2026-11-10T22:04:00.000Z')), '2026-11-07');
    assert.equal(impact.headline.verdict, 'too_early');
    assert.match(impact.headline.note, /3 days behind/);
});

test('a short baseline stays too early even after the window has passed', () => {
    const liveOn = '2026-06-01';
    const impact = buildImpact({
        liveOn,
        kpi: 'clicks',
        now: new Date('2026-09-01T20:00:00.000Z'),
        compareLastYear: false,
        gscConnected: true,
        ga4Connected: true,
        pageDays: fill(dateOffset(liveOn, -10), dateOffset(liveOn, 60), { ...DAY, clicks: 12 }),
        sitewideDays: fill(dateOffset(liveOn, -10), dateOffset(liveOn, 60), { ...DAY, clicks: 80, impressions: 2000 }),
    });
    assert.equal(impact.baselineReady, false);
    assert.equal(impact.headline.verdict, 'too_early');
    assert.match(impact.headline.note, /28 days before/);
});

test('position moves under 1 are flat, and a lower rank is the helpful direction', () => {
    const noise = source({
        liveOn: '2026-11-10',
        now: EXAMPLE_AS_OF,
        kpi: 'avg_position',
        pageBefore: { ...DAY, position: 22 },
        pageAfter: { ...DAY, position: 21.4 },
        siteBefore: { ...DAY, clicks: 80, impressions: 2000, position: 19 },
        siteAfter: { ...DAY, clicks: 80, impressions: 2000, position: 19 },
    });
    assert.equal(noise.headline.verdict, 'flat');
    assert.match(noise.headline.note, /less than 1/);

    const better = source({
        liveOn: '2026-11-10',
        now: EXAMPLE_AS_OF,
        kpi: 'avg_position',
        pageBefore: { ...DAY, position: 22 },
        pageAfter: { ...DAY, position: 16 },
        siteBefore: { ...DAY, clicks: 80, impressions: 2000, position: 19 },
        siteAfter: { ...DAY, clicks: 80, impressions: 2000, position: 18.8 },
    });
    assert.equal(better.headline.verdict, 'improved');
    assert.equal(better.headline.controlMode, 'sitewide');
});

test('low data is still judged and marked as an estimate', () => {
    const impact = source({
        liveOn: '2026-11-10',
        now: EXAMPLE_AS_OF,
        pageBefore: { ...DAY, clicks: 1, impressions: 2 },
        pageAfter: { ...DAY, clicks: 4, impressions: 3 },
        siteBefore: { ...DAY, clicks: 40, impressions: 800 },
        siteAfter: { ...DAY, clicks: 40, impressions: 800 },
    });
    assert.equal(impact.headline.verdict, 'improved');
    assert.equal(impact.headline.lowData, true);
    assert.equal(impact.headline.estimate, true);
    assert.match(impact.headline.note, /Early estimate/);
    assert.equal(impact.headline.note.includes('· Estimate'), false);
});

test('a negative untouched remainder falls back to the sitewide trend', () => {
    const impact = source({
        liveOn: '2026-11-10',
        now: EXAMPLE_AS_OF,
        pageBefore: { ...DAY, clicks: 100, impressions: 400 },
        pageAfter: { ...DAY, clicks: 140, impressions: 500 },
        siteBefore: { ...DAY, clicks: 50, impressions: 200 },
        siteAfter: { ...DAY, clicks: 55, impressions: 210 },
    });
    assert.equal(impact.headline.controlMode, 'sitewide');
    assert.equal(impact.headline.controlUnreliable, true);
    assert.equal(impact.headline.estimate, true);
});

test('missing days are not treated as zero', () => {
    const liveOn = '2026-06-01';
    const impact = buildImpact({
        liveOn,
        kpi: 'clicks',
        now: new Date('2026-09-01T20:00:00.000Z'),
        compareLastYear: false,
        gscConnected: true,
        ga4Connected: true,
        pageDays: [
            ...fill(dateOffset(liveOn, -28), dateOffset(liveOn, -1), DAY),
            ...fill(liveOn, dateOffset(liveOn, 9), { ...DAY, clicks: 1 }),
        ],
        sitewideDays: fill(dateOffset(liveOn, -28), dateOffset(liveOn, 60), { ...DAY, clicks: 80, impressions: 2000 }),
    });
    const week = impact.checkpoints.find(row => row.days === 28);
    assert.equal(week?.ready, false);
    assert.equal(week?.verdict, 'too_early');
    assert.ok((week?.page.daysPresent ?? 0) < 28);
    assert.notEqual(week?.page.clicks, 0);
});

test('Search Console not connected stays too early', () => {
    const impact = source({
        liveOn: '2026-11-10',
        now: EXAMPLE_AS_OF,
        gscConnected: false,
        pageBefore: DAY,
        pageAfter: { ...DAY, clicks: 20 },
        siteBefore: { ...DAY, clicks: 80, impressions: 2000 },
        siteAfter: { ...DAY, clicks: 80, impressions: 2000 },
    });
    assert.equal(impact.headline.verdict, 'too_early');
    assert.match(impact.headline.note, /Search Console isn't connected/);
});

test('the Ecoworkz example is improved, estimated nowhere, and flags the same-day promo', () => {
    const board = exampleBoard();
    const h1 = board.impacts['example-ecoworkz-h1'];
    const promo = board.impacts['example-ecoworkz-elnino'];
    assert.equal(h1.headline.verdict, 'improved');
    assert.equal(h1.headline.estimate, false);
    assert.equal(promo.headline.verdict, 'flat');
    assert.equal(board.changes[0].title, 'Homepage main heading');
    assert.equal(/\b(H1|Elementor|widget)\b/i.test(`${board.changes[0].title} ${board.changes[0].backupReference} ${board.changes[0].revertInstructions} ${board.changes[1].afterText} ${board.changes[1].revertInstructions}`), false);
    assert.equal(board.changes[0].beforeText.includes('Outdoor Living'), true);
    assert.equal(board.changes[0].afterText, 'Hardscape & Landscape Contractors in Corona, CA');
    assert.equal(board.changes[0].liveAt, '2026-11-10T22:04:00.000Z');
    const overlap = exampleConfounders(board, 'example-ecoworkz-h1');
    assert.equal(overlap.length, 1);
    assert.equal(overlap[0].overlap, 'same_day');
    assert.equal(overlap[0].title, 'El Niño promo banner');
    const others = findConfounders(board.changes, board.changes[1], 28);
    assert.equal(others[0].id, 'example-ecoworkz-h1');
    const csv = impactCsv(board.changes[0], h1);
    const pagesRow = csv.split('\n').find(row => row.startsWith('Pages,'));
    const exported = new URL((pagesRow ?? '').slice('Pages,'.length).split(' ')[0] ?? '');
    assert.equal(exported.hostname, 'www.ecoworkz.net');
    assert.equal(exported.pathname, '/');
    assert.equal(csv.includes('access_token'), false);
    assert.match(csv, /Type,Main page heading/);
    assert.match(csv, /What we're watching,Clicks from Google/);
    assert.match(csv, /Keep in mind,"?Lines up with the change\. Doesn't prove the change caused it\./);
    assert.match(csv, /Rest of the site/);
    assert.match(csv, /Not ready yet/);
    assert.equal(csv.includes('Untouched'), false);
    assert.equal(/\bKPI\b/.test(csv), false);
    assert.match(csv, /Nov 10, 2026 · 2:04 PM PT \(Pacific time\)/);
    assert.equal(h1.series.some(point => point.live), true);
    assert.equal(h1.series.find(point => point.date === '2026-11-10')?.clicks, 12);
    const waiting = h1.series.filter(point => point.date > h1.finalThrough);
    assert.equal(waiting.length, GSC_LAG_DAYS);
    assert.ok(waiting.every(point => point.preliminary && point.clicks == null && point.page == null));
    assert.equal(h1.yoy?.measured, true);
});

test('Pacific wall time, last year, and the GBP-tagged URL', () => {
    assert.equal(ptLocalToIso('2026-11-10T14:04'), '2026-11-10T22:04:00.000Z');
    assert.equal(ptLocalToIso('2026-11-10T13:28'), '2026-11-10T21:28:00.000Z');
    assert.equal(sameDateLastYear('2024-02-29'), '2023-02-28');
    assert.equal(pageMatchesChange('https://www.ecoworkz.net/', 'https://ecoworkz.net/'), true);
    assert.equal(pageMatchesChange(
        'https://www.ecoworkz.net/?utm_source=google&utm_medium=organic&utm_campaign=gbp_listing',
        'https://www.ecoworkz.net/',
    ), false);
    const candidates = gscPageCandidates('https://www.ecoworkz.net/').map(value => new URL(value));
    assert.equal(candidates.some(url => url.hostname === 'ecoworkz.net' && url.pathname === '/'), true);
    assert.equal(validateChange(ecoworkzH1Input()), null);
    const saved = normalizeChange(ecoworkzH1Input());
    assert.equal(saved?.pages[0].cmsPageId, '7901');
    assert.equal(saved?.pages[0].cmsWidgetId, '47eaa58');
    assert.equal(saved?.queries.length, 3);
    assert.equal(validateChange({ ...ecoworkzH1Input(), pages: [] }), 'Add at least one page.');
});
