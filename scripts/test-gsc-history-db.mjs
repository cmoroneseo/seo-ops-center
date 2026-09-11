// Usage: node scripts/test-gsc-history-db.mjs [path-to-pglite-module]
// PGlite is an optional isolated test dependency; never connects to production.
const {PGlite} = await import(process.argv[2] ?? '@electric-sql/pglite');
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const org='11111111-1111-1111-1111-111111111111',other='22222222-2222-2222-2222-222222222222',client='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create table public.organizations(id uuid primary key);
create table public.clients(id uuid primary key,organization_id uuid references organizations(id));
create table public.client_integrations(client_id uuid,organization_id uuid,service text,sync_status text,credentials jsonb);
create function public.get_user_org_ids() returns setof uuid language sql stable as $$ select nullif(current_setting('test.org',true),'')::uuid $$;
grant all on organizations,clients,client_integrations to service_role;
insert into organizations values('${org}'),('${other}');
insert into clients values('${client}','${org}');
insert into client_integrations values('${client}','${org}','gsc','active','{"site_url":"sc-domain:example.com"}');`);
await db.exec(readFileSync('migrations/049_gsc_performance_history.sql','utf8'));
await db.exec(readFileSync('migrations/050_gsc_search_insights_aggregation.sql','utf8'));
const fact={grain:'query_page',query:'test',page:'https://example.com/a',clicks:1,impressions:10,position:2};
const save=async(facts=[fact],property='sc-domain:example.com',fetched='2024-01-10T00:00:00Z',organization=org,date='2024-01-01',queryLimited=false)=>db.query('select public.replace_gsc_history_day($1,$2,$3,$4,$5,$6,$7,$8) as saved',[organization,client,property,date,fetched,false,queryLimited,JSON.stringify(facts)]);
await db.exec('set role service_role');
assert.equal((await save()).rows[0].saved,true);
assert.equal((await save()).rows[0].saved,true);
assert.equal((await db.query('select count(*)::int as count from gsc_history_facts')).rows[0].count,1);
await assert.rejects(save([{...fact,clicks:-1}]),/check constraint/);
assert.equal((await db.query('select clicks from gsc_history_facts')).rows[0].clicks,1);
await assert.rejects(save([fact],'sc-domain:other.com'),/property changed/);
await assert.rejects(save([fact],'sc-domain:example.com','2024-01-10T00:00:00Z',other),/organization mismatch/);
assert.equal((await save([{...fact,clicks:9}],'sc-domain:example.com','2024-01-09T00:00:00Z')).rows[0].saved,false);
assert.equal((await db.query('select clicks from gsc_history_facts')).rows[0].clicks,1);
await db.exec(`reset role; set role authenticated; set test.org='${org}'`);
assert.equal((await db.query('select count(*)::int as count from gsc_history_facts')).rows[0].count,1);
await assert.rejects(save(),/permission denied/);
await db.exec(`set test.org='${other}'`);
assert.equal((await db.query('select count(*)::int as count from gsc_history_days')).rows[0].count,0);
assert.equal((await db.query('select count(*)::int as count from gsc_history_facts')).rows[0].count,0);
await assert.rejects(db.query(`select public.get_gsc_search_insights('${org}','${client}','sc-domain:example.com','2024-01-01','2024-01-03')`),/permission denied/);
await db.exec('reset role; set role anon');
await assert.rejects(db.query('select * from gsc_history_days'),/permission denied/);
await db.exec('reset role; set role service_role');
const dailyFacts=(position)=>[
 {grain:'property',query:'',page:'',clicks:3,impressions:100,position},
 {grain:'query_page',query:'qualified query',page:'https://example.com/service',clicks:2,impressions:50,position},
 {grain:'query_page',query:'too little evidence',page:'https://example.com/other',clicks:0,impressions:10,position:9},
];
await save(dailyFacts(6),'sc-domain:example.com','2024-01-12T00:00:00Z',org,'2024-01-01');
await save(dailyFacts(8),'sc-domain:example.com','2024-01-12T00:00:00Z',org,'2024-01-02',true);
await save(dailyFacts(10),'sc-domain:example.com','2024-01-12T00:00:00Z',org,'2024-01-03');
const aggregateResult=(await db.query(`select public.get_gsc_search_insights('${org}','${client}','sc-domain:example.com','2024-01-01','2024-01-03') as result`)).rows[0].result;
const aggregate=typeof aggregateResult==='string'?JSON.parse(aggregateResult):aggregateResult;
assert.equal(aggregate.days.length,3);
assert.equal(aggregate.days[1].queryLimited,true);
assert.equal(aggregate.propertyRows.length,3);
assert.deepEqual(aggregate.queryPageRollups,[{query:'qualified query',page:'https://example.com/service',clicks:6,impressions:150,position:8,ctr:0.04,observedDays:3}]);
const wrongScope=(await db.query(`select public.get_gsc_search_insights('${other}','${client}','sc-domain:example.com','2024-01-01','2024-01-03') as result`)).rows[0].result;
assert.equal((typeof wrongScope==='string'?JSON.parse(wrongScope):wrongScope).days.length,0);
const shortWindow=(await db.query(`select public.get_gsc_search_insights('${org}','${client}','sc-domain:example.com','2024-01-01','2024-01-02') as result`)).rows[0].result;
assert.equal((typeof shortWindow==='string'?JSON.parse(shortWindow):shortWindow).queryPageRollups.length,0);
await save([],'sc-domain:example.com','2024-01-13T00:00:00Z');
assert.equal((await db.query("select count(*)::int as count from gsc_history_facts f join gsc_history_days d on d.id=f.day_id where d.data_date='2024-01-01'")).rows[0].count,0);
console.log('PASS: migration, idempotency, rollback, property/org guards, stale-write rejection, tenant RLS, denied writes, anonymous denial, server aggregation, empty replacement');
await db.close();
