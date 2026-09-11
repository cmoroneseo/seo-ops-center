import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchGscDay,historyWindow,historyDates,planHistoryDays} from './history';
const row=(keys:string[],clicks=1)=>({keys,clicks,impressions:10,position:5});
test('history dates follow Pacific calendar and finalized lag',()=>{
 assert.deepEqual(historyWindow(new Date('2026-09-11T00:00:00Z')),{start:'2026-08-11',end:'2026-09-07'});
 assert.deepEqual(historyDates('2024-02-28','2024-03-01'),['2024-02-28','2024-02-29','2024-03-01']);
 assert.throws(()=>historyDates('2026-02-30','2026-03-02'));
 assert.throws(()=>historyDates('2026-01-01','2026-02-15'));
});
test('backfill takes missing dates newest first, then rotates recent snapshots',()=>{
 const dates=['2026-09-01','2026-09-02','2026-09-03'];
 assert.deepEqual(planHistoryDays(dates,[{data_date:dates[2],imported_at:'2026-09-07'}]),[dates[1],dates[0]]);
 assert.deepEqual(planHistoryDays(dates,dates.map((data_date,index)=>({data_date,imported_at:`2026-09-0${7-index}`}))),[dates[2],dates[1]]);
});
test('keeps property, page and query-page grains separate with exact scope',async()=>{
 const bodies:Record<string,unknown>[]=[];
 const result=await fetchGscDay('https://www.example.com/sub/','token','2026-09-01',{fetch:async(url,init)=>{
  assert.match(String(url),/https%3A%2F%2Fwww.example.com%2Fsub%2F/);
  const body=JSON.parse(String(init?.body));bodies.push(body);
  return Response.json({rows:[row(body.dimensions.length===0?[]:body.dimensions.length===1?['https://example.com/a']:['query','https://example.com/a'])]});
 }});
 assert.deepEqual(result.facts.map(fact=>fact.grain),['property','page','query_page']);
 assert.ok(bodies.every(body=>body.dataState==='final'&&body.startDate===body.endDate));
 assert.equal(bodies[0].aggregationType,'byProperty');assert.equal(bodies[1].aggregationType,'byPage');
});
test('paginates with offsets and flags app limits without claiming completeness',async()=>{
 const starts:number[]=[];
 const result=await fetchGscDay('sc-domain:example.com','token','2026-09-01',{rowLimit:1,maxPages:2,fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));starts.push(body.startRow);
  return Response.json({rows:[row(body.dimensions.length===0?[]:body.dimensions.length===1?[`https://example.com/${body.startRow}`]:[`q${body.startRow}`,'https://example.com/a'])]});
 }});
 assert.deepEqual(starts,[0,0,1,0,1]);assert.equal(result.pageLimited,true);assert.equal(result.queryLimited,true);
});
test('empty successful days are represented without fabricated rows',async()=>{
 const result=await fetchGscDay('sc-domain:example.com','token','2026-09-01',{fetch:async()=>Response.json({})});
 assert.equal(result.facts.length,0);assert.equal(result.pageLimited,false);
});
test('failed pagination rejects entire day instead of returning partial facts',async()=>{
 let calls=0;
 await assert.rejects(fetchGscDay('sc-domain:example.com','token','2026-09-01',{rowLimit:1,maxPages:2,fetch:async(_url,init)=>{
  calls++;if(calls===3)return new Response('',{status:429});
  const body=JSON.parse(String(init?.body));return Response.json({rows:[row(body.dimensions.length?['https://example.com/a']:[])]});
 }}),/HTTP 429/);
});
test('duplicate pagination rows fail rather than double-counting',async()=>{
 await assert.rejects(fetchGscDay('sc-domain:example.com','token','2026-09-01',{rowLimit:1,maxPages:2,fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));return Response.json({rows:[row(body.dimensions.length?['https://example.com/a']:[])]});
 }}),/repeated a row/);
});
test('malformed dimensions and metrics reject data',async()=>{
 await assert.rejects(fetchGscDay('sc-domain:example.com','token','2026-09-01',{fetch:async()=>Response.json({rows:[{clicks:-1,impressions:10,position:3}]})}),/Invalid/);
});
