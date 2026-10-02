import test from 'node:test';
import assert from 'node:assert/strict';
import { backgroundHistoryDates, planBackgroundDays, retryDelaySeconds } from './background';
const now = new Date('2026-10-01T18:00:00Z');
test('background history spans 480 dates, finalized Pacific dates newest first', () => {
 const dates=backgroundHistoryDates(now);
 assert.equal(dates.length,480); assert.equal(new Set(dates).size,480);
 assert.equal(dates[0],'2026-09-28'); assert.ok(dates[0]>dates.at(-1)!);
});
test('recent revisions cannot starve behind historical backfill; fresh days do not refetch', () => {
 const dates=backgroundHistoryDates(now);
 const old={data_date:dates[0],imported_at:'2026-09-29T00:00:00Z'};
 const fresh={data_date:dates[1],imported_at:now.toISOString()};
 assert.deepEqual(planBackgroundDays(dates,[old,fresh],now),[dates[2],dates[0],dates[3],dates[4]]);
});
test('complete fresh coverage is idle; stale recent days rotate without rewriting older history', () => {
 const dates=backgroundHistoryDates(now);
 const all=dates.map(data_date=>({data_date,imported_at:now.toISOString()}));
 assert.deepEqual(planBackgroundDays(dates,all,now),[]);
 assert.deepEqual(planBackgroundDays(dates,all.map(day=>({...day,imported_at:'2026-09-29T00:00:00Z'})),now),dates.slice(0,4));
});
test('retry delays increase and stay bounded',()=>{
 assert.equal(retryDelaySeconds(1),60);assert.equal(retryDelaySeconds(2),120);
 assert.equal(retryDelaySeconds(100),86400);
});
