// Usage: node scripts/test-site-inventory-db.mjs [path-to-pglite-module]
// PGlite is an isolated test dependency and never connects to production.
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite');
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const org = '11111111-1111-1111-1111-111111111111';
const client = '22222222-2222-2222-2222-222222222222';
const otherOrg = '99999999-9999-9999-9999-999999999999';
const otherClient = '88888888-8888-8888-8888-888888888888';

await db.exec(`
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.organizations(id uuid primary key);
create table public.users(id uuid primary key);
create table public.clients(id uuid primary key, organization_id uuid not null references public.organizations(id), name text not null, domain text);
create function public.get_user_org_ids() returns setof uuid language sql stable as $$ select nullif(current_setting('test.org', true), '')::uuid $$;
grant select on public.clients to service_role;
insert into public.organizations values ('${org}'), ('${otherOrg}');
insert into public.clients values ('${client}', '${org}', 'Ecoworkz', 'ecoworkz.net'), ('${otherClient}', '${otherOrg}', 'Other', 'other.test');
`);

await db.exec(readFileSync('migrations/053_site_inventory_foundation.sql', 'utf8'));

await db.exec('set role service_role');
const run = (await db.query(`insert into public.site_crawl_runs(organization_id,client_id,seed_url,configured_host,url_limit,status)
values ($1,$2,'https://ecoworkz.net/','ecoworkz.net',200,'queued') returning *`, [org, client])).rows[0];
await db.query(`insert into public.site_crawl_targets(organization_id,client_id,run_id,raw_url,normalized_url,discovery_sources,depth)
values ($1,$2,$3,'https://ecoworkz.net/','https://ecoworkz.net/',array['seed'],0),
       ($1,$2,$3,'https://ecoworkz.net/about','https://ecoworkz.net/about',array['internal'],1)`, [org, client, run.id]);

const token = '44444444-4444-4444-4444-444444444444';
const firstClaim = (await db.query('select * from public.claim_site_crawl_targets($1,$2,1)', [run.id, token])).rows;
assert.equal(firstClaim.length, 1);
assert.equal(firstClaim[0].status, 'processing');
assert.equal(firstClaim[0].attempt_count, 1);
const secondClaim = (await db.query('select * from public.claim_site_crawl_targets($1,$2,5)', [run.id, token])).rows;
assert.equal(secondClaim.length, 1);

const page = (await db.query(`insert into public.site_pages(organization_id,client_id) values ($1,$2) returning *`, [org, client])).rows[0];
const alias = (await db.query(`insert into public.site_page_urls(organization_id,client_id,site_page_id,raw_url,normalized_url,discovery_sources,is_primary)
values ($1,$2,$3,'HTTPS://ECOWORKZ.NET/','https://ecoworkz.net/',array['seed'],true) returning *`, [org, client, page.id])).rows[0];
await assert.rejects(db.query(`insert into public.site_page_urls(organization_id,client_id,site_page_id,raw_url,normalized_url,discovery_sources)
values ($1,$2,$3,'https://ecoworkz.net/#x','https://ecoworkz.net/',array['internal'])`, [org, client, page.id]), /unique/i);

const targetId = firstClaim[0].id;
const snapshot = (await db.query(`insert into public.site_page_snapshots(
organization_id,client_id,run_id,target_id,site_page_id,site_page_url_id,requested_url,final_url,fetch_status,status_code,content_type,redirect_hops,robots_allowed,title,h1s,word_count,limitation_flags)
values ($1,$2,$3,$4,$5,$6,'https://ecoworkz.net/','https://ecoworkz.net/','success',200,'text/html','[]',true,'Home',array['Welcome'],100,'{}') returning *`, [org, client, run.id, targetId, page.id, alias.id])).rows[0];
await assert.rejects(db.query(`update public.site_page_snapshots set title='Changed' where id=$1`, [snapshot.id]), /immutable/i);
await assert.rejects(db.query(`delete from public.site_page_snapshots where id=$1`, [snapshot.id]), /immutable/i);

await assert.rejects(db.query(`insert into public.site_pages(organization_id,client_id) values ($1,$2)`, [otherOrg, client]), /scope/i);
await assert.rejects(db.query(`insert into public.site_page_urls(organization_id,client_id,site_page_id,raw_url,normalized_url,discovery_sources)
values ($1,$2,$3,'https://other.test/','https://other.test/',array['seed'])`, [otherOrg, otherClient, page.id]), /scope|foreign key/i);

await assert.rejects(db.query(`insert into public.site_crawl_runs(organization_id,client_id,seed_url,configured_host,url_limit,status)
values ($1,$2,'https://ecoworkz.net/','ecoworkz.net',200,'running')`, [org, client]), /unique/i);

await db.exec(`reset role; set role authenticated; set "test.org"='${org}'`);
assert.equal((await db.query('select count(*)::int as count from public.site_pages')).rows[0].count, 1);
assert.equal((await db.query('select count(*)::int as count from public.site_page_snapshots')).rows[0].count, 1);
await assert.rejects(db.query(`insert into public.site_pages(organization_id,client_id) values ('${org}','${client}')`), /permission denied/i);

await db.exec(`set "test.org"='${otherOrg}'`);
assert.equal((await db.query('select count(*)::int as count from public.site_pages')).rows[0].count, 0);
assert.equal((await db.query('select count(*)::int as count from public.site_crawl_runs')).rows[0].count, 0);

await db.exec('reset role; set role anon');
await assert.rejects(db.query('select * from public.site_pages'), /permission denied/i);
await assert.rejects(db.query(`select * from public.claim_site_crawl_targets('${run.id}','${token}',1)`), /permission denied/i);

await db.exec('reset role');
const grants = await db.query(`select table_name,grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name like 'site_%' and grantee in ('anon','authenticated') order by table_name,grantee,privilege_type`);
assert.ok(grants.rows.every(row => row.grantee === 'authenticated' && row.privilege_type === 'SELECT'));
assert.equal(grants.rows.length, 5);

console.log('PASS: site identity, active-run guard, atomic leases, immutable observations, tenant RLS, read-only authenticated access, and anonymous denial');
await db.close();
