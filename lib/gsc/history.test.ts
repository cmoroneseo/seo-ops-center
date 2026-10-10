import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySurface,fetchGscDay,historyWindow,historyDates,ORGANIC_TOTALS_LABEL,pageSurfaceClicks,planHistoryDays,propertyDeviceClicks,querySurfacePositions} from './history';
const row=(keys:string[],clicks=1)=>({keys,clicks,impressions:10,position:5});
test('history dates follow Pacific calendar including today',()=>{
 assert.deepEqual(historyWindow(new Date('2026-09-11T00:00:00Z')),{start:'2026-08-14',end:'2026-09-10'});
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
  return Response.json({rows:[row(body.aggregationType==='byProperty'?['2026-09-01']:body.dimensions.length===1?['https://example.com/a']:['query','https://example.com/a'])]});
 }});
 assert.deepEqual(result.facts.map(fact=>fact.grain),['property','page','query_page']);
 assert.ok(bodies.every(body=>body.dataState==='all'&&body.startDate===body.endDate));
 assert.equal(bodies[0].aggregationType,'byProperty');assert.equal(bodies[1].aggregationType,'byPage');
});
test('paginates with offsets and flags app limits without claiming completeness',async()=>{
 const starts:number[]=[];
 const result=await fetchGscDay('sc-domain:example.com','token','2026-09-01',{rowLimit:1,maxPages:2,fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));starts.push(body.startRow);
  return Response.json({rows:[row(body.aggregationType==='byProperty'?['2026-09-01']:body.dimensions.length===1?[`https://example.com/${body.startRow}`]:[`q${body.startRow}`,'https://example.com/a'])]});
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
  const body=JSON.parse(String(init?.body));return Response.json({rows:[row(body.aggregationType==='byProperty'?['2026-09-01']:['https://example.com/a'])]});
 }}),/HTTP 429/);
});
test('quota responses are labeled without copying the provider body', async () => {
 await assert.rejects(fetchGscDay('sc-domain:example.com', 'token', '2026-09-01', {
  fetch: async () => new Response('quotaExceeded secret-token', { status: 403 }),
 }), (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.match(error.message, /HTTP 403, quota/);
  assert.equal(error.message.includes('secret-token'), false);
  return true;
 });
 await assert.rejects(fetchGscDay('sc-domain:example.com', 'token', '2026-09-01', {
  fetch: async () => new Response('forbidden', { status: 403 }),
 }), /HTTP 403\)/);
});
test('duplicate pagination rows fail rather than double-counting',async()=>{
 await assert.rejects(fetchGscDay('sc-domain:example.com','token','2026-09-01',{rowLimit:1,maxPages:2,fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));return Response.json({rows:[row(body.aggregationType==='byProperty'?['2026-09-01']:['https://example.com/a'])]});
 }}),/repeated a row/);
});
test('malformed dimensions and metrics reject data',async()=>{
 await assert.rejects(fetchGscDay('sc-domain:example.com','token','2026-09-01',{fetch:async()=>Response.json({rows:[{clicks:-1,impressions:10,position:3}]})}),/Invalid/);
});

test('fresh daily totals use date grouping and retain Google preliminary metadata',async()=>{
 const now=new Date('2026-10-02T16:00:00Z');
 const result=await fetchGscDay('sc-domain:example.com','token','2026-10-01',{now,fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  assert.equal(body.dataState,'all');
  if(body.aggregationType==='byProperty') {
   assert.deepEqual(body.dimensions,['date']);
   return Response.json({rows:[row(['2026-10-01'],4)],metadata:{first_incomplete_date:'2026-09-30'}});
  }
  return Response.json({rows:[]});
 }});
 assert.equal(result.isIncomplete,true);assert.equal(result.facts[0].clicks,4);
 const settled=await fetchGscDay('sc-domain:example.com','token','2026-09-30',{now,fetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));
  return Response.json({rows:body.aggregationType==='byProperty'?[row(['2026-09-30'])]:[],metadata:{first_incomplete_date:'2026-10-01'}});
 }});
 assert.equal(settled.isIncomplete,false);
});
test('fresh empty days stay preliminary and mismatched property dates are rejected',async()=>{
 const now=new Date('2026-10-02T16:00:00Z');
 const empty=await fetchGscDay('sc-domain:example.com','token','2026-10-02',{now,fetch:async()=>Response.json({})});
 assert.equal(empty.isIncomplete,true); assert.equal(empty.facts.length,0);
 await assert.rejects(fetchGscDay('sc-domain:example.com','token','2026-10-02',{now,fetch:async()=>Response.json({rows:[row(['2026-10-01'])]})}),/property date/);
});

test('v2 requests device and country grains and labels organic totals as page-level', async () => {
 const bodies: Record<string, unknown>[] = [];
 const result = await fetchGscDay('sc-domain:example.com', 'token', '2026-09-24', { v2: true, gbpLandingUrls: ['https://example.com/map'], fetch: async (_url, init) => {
  const body = JSON.parse(String(init?.body));
  bodies.push(body);
  const dimensions = body.dimensions as string[];
  if (body.dimensionFilterGroups) {
   assert.equal(body.aggregationType, 'byPage');
   assert.notEqual(body.aggregationType, 'byProperty');
   const filter = body.dimensionFilterGroups[0].filters[0];
   assert.equal(filter.dimension, 'page');
   assert.equal(filter.operator, 'notContains');
   assert.equal(filter.expression, 'utm_medium=gbp');
   return Response.json({ rows: [row(['https://example.com/organic'], 13)], responseAggregationType: 'byPage' });
  }
  if (dimensions[0] === 'date' && dimensions[1] === 'device') {
   assert.equal(body.aggregationType, 'byProperty');
   return Response.json({ rows: [row(['2026-09-24', 'DESKTOP'], 10), row(['2026-09-24', 'MOBILE'], 5), row(['2026-09-24', 'TABLET'], 3)] });
  }
  if (dimensions[0] === 'country') return Response.json({ rows: [row(['usa'], 18)] });
  if (dimensions[0] === 'page' && dimensions[1] === 'device') return Response.json({ rows: [row(['https://example.com/a?utm_medium=gbp', 'MOBILE'], 5)] });
  if (body.aggregationType === 'byProperty') return Response.json({ rows: [row(['2026-09-24'], 18)] });
  if (dimensions.length === 1) {
   return Response.json({ rows: [row(['https://example.com/a'], 13), row(['https://example.com/a?utm_medium=gbp'], 5), row(['https://example.com/map'], 1)] });
  }
  return Response.json({ rows: [row(['commercial plumber eastvale', 'https://example.com/a'], 2)] });
 }});
 assert.equal(result.organicTotalsScope, 'page');
 assert.equal(result.organicTotalsLabel, ORGANIC_TOTALS_LABEL);
 assert.deepEqual(result.facts.map(fact => fact.grain), ['property', 'page', 'page', 'page', 'query_page', 'property_device', 'property_device', 'property_device', 'page_device', 'property_country', 'page_organic']);
 const devices = propertyDeviceClicks(result.facts);
 assert.equal(devices.devices, devices.property);
 const pages = pageSurfaceClicks(result.facts);
 assert.equal(pages.organic + pages.gbp_link, pages.total);
 assert.equal(pages.gbp_link, 6);
 assert.equal(result.facts.find(fact => fact.grain === 'page_organic')?.surface, 'organic');
 assert.equal(classifySurface('https://example.com/map', ['https://example.com/map']), 'gbp_link');
});

test('commercial plumber eastvale Sep 24-30 reproduces organic 13.0 and GBP 5.7', () => {
 const facts = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'].flatMap(() => ([
  { query: 'commercial plumber eastvale', surface: 'organic' as const, impressions: 10, position: 13 },
  { query: 'commercial plumber eastvale', surface: 'gbp_link' as const, impressions: 4, position: 5.7 },
 ]));
 assert.deepEqual(querySurfacePositions(facts, 'commercial plumber eastvale'), { organic: 13, gbp_link: 5.7 });
 assert.equal(querySurfacePositions(facts, 'missing query').organic, null);
});
