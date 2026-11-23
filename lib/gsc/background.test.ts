import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundHistoryDates, backgroundWindowLength, planBackgroundDays, planV2Backfill, retryDelaySeconds, V2_BACKFILL_HISTORY_DAYS, V2_REQUEST_GAP_MS } from './background';
import { dateOffset } from './history';
const now = new Date('2026-10-01T18:00:00Z');
test('background history spans 480 dates, Pacific dates including today newest first', () => {
 const dates=backgroundHistoryDates(now);
 assert.equal(dates.length,480); assert.equal(new Set(dates).size,480);
 assert.equal(dates[0],'2026-10-01'); assert.ok(dates[0]>dates.at(-1)!);
});
test('recent revisions cannot starve behind historical backfill; fresh days do not refetch', () => {
 const dates=backgroundHistoryDates(now);
 const old={data_date:dates[0],imported_at:'2026-09-29T00:00:00Z',is_incomplete:true};
 const fresh={data_date:dates[1],imported_at:now.toISOString(),is_incomplete:true};
 assert.deepEqual(planBackgroundDays(dates,[old,fresh],now),[dates[2],dates[0],dates[3],dates[4]]);
});
test('complete fresh coverage is idle; stale recent days rotate without rewriting older history', () => {
 const dates=backgroundHistoryDates(now);
 const all=dates.map(data_date=>({data_date,imported_at:now.toISOString(),is_incomplete:false}));
 assert.deepEqual(planBackgroundDays(dates,all,now),[]);
 assert.deepEqual(planBackgroundDays(dates,all.map(day=>({...day,imported_at:'2026-09-29T00:00:00Z'})),now),dates.slice(0,4));
});
test('retry delays increase and stay bounded',()=>{
 assert.equal(retryDelaySeconds(1),60);assert.equal(retryDelaySeconds(2),120);
 assert.equal(retryDelaySeconds(100),86400);
});

test('preliminary dates refresh hourly without repeatedly fetching fresh snapshots',()=>{
 const dates=backgroundHistoryDates(now);
 const all=dates.map((data_date,index)=>({data_date,imported_at:now.toISOString(),is_incomplete:index<3}));
 const previousHour=new Date(now.getTime()-3600001).toISOString();
 all[0].imported_at=previousHour;all[4].imported_at=previousHour;
 assert.deepEqual(planBackgroundDays(dates,all,now),[dates[0]]);
});

test('mature incomplete days take priority over stale revisions and missing history', () => {
    const now = new Date('2026-10-02T02:00:00Z'); // Still October 1 in Pacific time.
    const dates = backgroundHistoryDates(now, 35);
    const existing = dates.slice(0, 16).filter(date => date !== dates[6]).map(data_date => ({
        data_date,
        imported_at: '2026-10-02T00:00:00Z',
        is_incomplete: [dates[2], dates[3], dates[9], dates[11], dates[12], dates[15]].includes(data_date),
    }));
    existing[0].imported_at = '2026-10-01T00:00:00Z';

    const first = planBackgroundDays(dates, existing, now);
    assert.deepEqual(first, [dates[3], dates[9], dates[11], dates[12]]);
    for (const day of existing) if (first.includes(day.data_date)) day.is_incomplete = false;
    assert.deepEqual(planBackgroundDays(dates, existing, now), [dates[15], dates[6], dates[0], dates[16]]);
});

test('a mature day that remains incomplete after a fetch leaves the worker idle until the hourly retry', () => {
    const dates = backgroundHistoryDates(now, 10);
    const hourAgo = new Date(now.getTime() - 3600000).toISOString();
    const coverage = dates.map((data_date, index) => ({
        data_date,
        imported_at: index === 3 ? hourAgo : now.toISOString(),
        is_incomplete: index === 3,
    }));
    assert.deepEqual(planBackgroundDays(dates, coverage, now), [dates[3]]);

    const savedAt = new Date(now.getTime() + 1000);
    coverage[3].imported_at = savedAt.toISOString();
    assert.deepEqual(planBackgroundDays(dates, coverage, now), []);
    const remaining = planBackgroundDays(dates, coverage, now, 1).length > 0;
    assert.equal(remaining, false);
    assert.deepEqual(planBackgroundDays(dates, coverage, new Date(savedAt.getTime() + 3600000), 1), [dates[3]]);
});

test('the newest stale day cannot repeatedly displace older recent revisions', () => {
    const dates = backgroundHistoryDates(now, 10);
    const existing = dates.slice(0, 7).map((data_date, index) => ({
        data_date,
        imported_at: index === 0 ? '2026-10-01T16:00:00Z' : '2026-09-29T00:00:00Z',
        is_incomplete: false,
    }));
    assert.deepEqual(planBackgroundDays(dates, existing, now, 2), [dates[1], dates[7]]);
});

test('the 486-day window is separate from the daily 480-day sync', () => {
 assert.equal(backgroundWindowLength({} as NodeJS.ProcessEnv), 480);
 assert.equal(backgroundWindowLength({ GSC_HISTORY_V2_BACKFILL_ENABLED: 'true' }), 486);
 const dates = backgroundHistoryDates(now, V2_BACKFILL_HISTORY_DAYS);
 assert.equal(dates.length, 486);
 assert.equal(dates[0], '2026-10-01');
 assert.equal(dates.at(-1), dateOffset('2026-10-01', -485));
 assert.ok(60000 / V2_REQUEST_GAP_MS <= 600);
});

test('v2 backfill walks newest first and resumes after a killed run', () => {
 const dates = backgroundHistoryDates(now, V2_BACKFILL_HISTORY_DAYS);
 const first = planV2Backfill(dates, null, 2);
 assert.deepEqual(first.dates, [dates[0], dates[1]]);
 const killed = planV2Backfill(dates, first.dates[0], 2);
 assert.deepEqual(killed.dates, [dates[1], dates[2]]);
 const done = planV2Backfill(dates, dates.at(-1)!, 2);
 assert.equal(done.done, true);
 assert.deepEqual(done.dates, []);
 assert.equal(done.cursor, dates.at(-1));
});
