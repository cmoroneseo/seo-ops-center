// Usage: node scripts/test-site-identity-db.mjs [path-to-pglite-module]
// Isolated PostgreSQL fixture; this script never connects to production.
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite');
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const org = '11111111-1111-1111-1111-111111111111';
const client = '22222222-2222-2222-2222-222222222222';
const reviewer = '33333333-3333-3333-3333-333333333333';
const otherOrg = '99999999-9999-9999-9999-999999999999';
const otherClient = '88888888-8888-8888-8888-888888888888';
const otherReviewer = '77777777-7777-7777-7777-777777777777';

await db.exec(`
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.organizations(id uuid primary key);
create table public.users(id uuid primary key);
create table public.clients(id uuid primary key, organization_id uuid not null references public.organizations(id), name text not null);
create table public.organization_members(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references public.users(id),
  unique(organization_id, user_id)
);
create function public.get_user_org_ids() returns setof uuid language sql stable
as $$ select organization_id from public.organization_members where user_id = nullif(current_setting('test.uid', true), '')::uuid $$;
grant select on public.clients, public.organization_members to service_role;
grant select on public.organization_members to authenticated;
insert into public.organizations values ('${org}'), ('${otherOrg}');
insert into public.users values ('${reviewer}'), ('${otherReviewer}');
insert into public.organization_members(organization_id,user_id) values ('${org}','${reviewer}'), ('${otherOrg}','${otherReviewer}');
insert into public.clients values ('${client}','${org}','Fixture'), ('${otherClient}','${otherOrg}','Other');
`);
await db.exec(readFileSync('migrations/053_site_inventory_foundation.sql', 'utf8'));
await db.exec(readFileSync('migrations/054_filter_site_crawl_assets.sql', 'utf8'));
// Supabase can supply broad default grants; migration 055 must narrow them.
await db.exec('alter default privileges in schema public grant all on tables to anon, authenticated, service_role');
await db.exec(readFileSync('migrations/055_reviewed_page_identity.sql', 'utf8'));

await db.exec('set role service_role');
async function page(organizationId = org, clientId = client) {
  return (await db.query('insert into public.site_pages(organization_id,client_id) values ($1,$2) returning *', [organizationId, clientId])).rows[0];
}
async function crawl(organizationId = org, clientId = client, createdAt = '2026-09-11T09:00:00Z') {
  return (await db.query(`insert into public.site_crawl_runs(organization_id,client_id,seed_url,configured_host,status,created_at)
    values ($1,$2,'https://fixture.test/','fixture.test','completed',$3) returning id`, [organizationId, clientId, createdAt])).rows[0];
}
const run = await crawl();
const foreignRun = await crawl(otherOrg, otherClient);
async function observe(page, observedAt = '2026-09-11T10:00:00Z', crawlRun = page.client_id === client ? run : foreignRun) {
  const url = `https://fixture.test/${page.id}`;
  await db.query(`insert into public.site_page_urls(organization_id,client_id,site_page_id,raw_url,normalized_url,is_primary)
    values ($1,$2,$3,$4,$4,true) on conflict (client_id,normalized_url) do nothing`,
  [page.organization_id, page.client_id, page.id, url]);
  const alias = (await db.query('select id from public.site_page_urls where site_page_id=$1', [page.id])).rows[0];
  const target = (await db.query(`insert into public.site_crawl_targets(organization_id,client_id,run_id,raw_url,normalized_url)
    values ($1,$2,$3,$4,$4) returning id`, [page.organization_id, page.client_id, crawlRun.id, `${url}?at=${observedAt}`])).rows[0];
  return (await db.query(`insert into public.site_page_snapshots(organization_id,client_id,run_id,target_id,site_page_id,site_page_url_id,requested_url,fetch_status,title,observed_at)
    values ($1,$2,$3,$4,$5,$6,$7,'success','Original title',$8) returning *`,
  [page.organization_id, page.client_id, crawlRun.id, target.id, page.id, alias.id, url, observedAt])).rows[0];
}

const source = await page();
const target = await page();
const third = await page();
const foreignPage = await page(otherOrg, otherClient);
const sourceSnapshot = await observe(source);
const targetSnapshot = await observe(target);
const thirdSnapshot = await observe(third);
const foreignSnapshot = await observe(foreignPage);

function evidenceFor(source, snapshot, target, targetSnapshot) {
  return { version: 1, source: { pageId: source.id, snapshotId: snapshot.id, title: snapshot.title },
    ...(target ? { target: { pageId: target.id, snapshotId: targetSnapshot.id } } : {}), signals: [] };
}
const evidence = evidenceFor(source, sourceSnapshot, target, targetSnapshot);
async function decide({ sourceId = source.id, targetId = target.id, kind = 'claim_into', reason = 'redirect_alias', note = null,
  snapshot = evidence, organizationId = org, clientId = client, reviewerId = reviewer } = {}) {
  // FROM evaluates the volatile, composite-returning RPC exactly once.
  return (await db.query('select * from public.set_site_page_identity_decision($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [organizationId, clientId, reviewerId, sourceId, targetId, kind, reason, note, JSON.stringify(snapshot)])).rows[0];
}
async function state() {
  return (await db.query(`select
    (select jsonb_agg(t order by id) from public.site_page_identity_decisions t) as decisions,
    (select jsonb_agg(t order by source_site_page_id) from public.site_page_claims t) as claims`)).rows[0];
}
async function rejectsUnchanged(input, message) {
  const before = await state();
  await assert.rejects(decide(input), message);
  assert.deepEqual(await state(), before, 'failed decisions must leave both tables unchanged');
}

// Incorrect reviewer/tenant/page scope or evidence must fail before appending history.
await rejectsUnchanged({ reviewerId: otherReviewer }, /member/i);
await rejectsUnchanged({ reviewerId: null }, /member/i);
await rejectsUnchanged({ organizationId: otherOrg }, /scope|member/i);
await rejectsUnchanged({ targetId: foreignPage.id }, /scope/i);
await rejectsUnchanged({ targetId: source.id }, /self/i);
await rejectsUnchanged({ snapshot: { ...evidence, source: { ...evidence.source, snapshotId: foreignSnapshot.id } } }, /snapshot|evidence/i);
await rejectsUnchanged({ snapshot: { ...evidence, target: { ...evidence.target, snapshotId: sourceSnapshot.id } } }, /snapshot|evidence/i);
await rejectsUnchanged({ snapshot: { ...evidence, source: { ...evidence.source, pageId: third.id } } }, /scope|evidence/i);
await rejectsUnchanged({ snapshot: { ...evidence, source: { pageId: source.id } } }, /snapshot/i);
await rejectsUnchanged({ snapshot: { ...evidence, target: { pageId: target.id } } }, /snapshot/i);
await rejectsUnchanged({ snapshot: { ...evidence, signals: {} } }, /evidence/i);
await rejectsUnchanged({ snapshot: { ...evidence, version: 2 } }, /evidence/i);
await rejectsUnchanged({ snapshot: [] }, /evidence/i);
await rejectsUnchanged({ snapshot: {} }, /evidence/i);
await rejectsUnchanged({ snapshot: { ...evidence, extra: 'x'.repeat(262145) } }, /evidence/i);
await rejectsUnchanged({ reason: 'distinct_intent' }, /reason/i);
await rejectsUnchanged({ reason: 'invented' }, /reason/i);
await rejectsUnchanged({ reason: null }, /reason/i);
await rejectsUnchanged({ kind: 'invented' }, /kind/i);
await rejectsUnchanged({ kind: null }, /kind/i);
await rejectsUnchanged({ reason: 'other', note: ' \t\n' }, /note/i);
await rejectsUnchanged({ note: 'x'.repeat(2001) }, /note/i);
await rejectsUnchanged({ targetId: null }, /target/i);
await rejectsUnchanged({ kind: 'reopen', reason: 'new_evidence', targetId: null, snapshot: evidenceFor(source, sourceSnapshot) }, /independent|active claim/i);

// Claim/reopen only changes active edges; observations, URLs, and page IDs remain exact.
const history = (await db.query(`select
  (select jsonb_agg(t order by id) from public.site_pages t) as pages,
  (select jsonb_agg(t order by id) from public.site_page_urls t) as urls,
  (select jsonb_agg(t order by id) from public.site_page_snapshots t) as snapshots`)).rows[0];
const claimed = await decide();
assert.equal(claimed.decision_kind, 'claim_into');
assert.deepEqual(claimed.evidence_snapshot, evidence);
assert.equal((await db.query('select target_site_page_id from public.site_page_claims where source_site_page_id=$1', [source.id])).rows[0].target_site_page_id, target.id);
await assert.rejects(db.query(`insert into public.site_page_claims(source_site_page_id,organization_id,client_id,target_site_page_id,decision_id)
  values ($1,$2,$3,$4,$5)`, [source.id, org, client, target.id, claimed.id]), /unique/i);
await assert.rejects(db.query(`insert into public.site_page_claims(source_site_page_id,organization_id,client_id,target_site_page_id,decision_id)
  values ($1,$2,$3,$4,$5)`, [foreignPage.id, org, client, target.id, claimed.id]), /foreign key|unique/i);
await assert.rejects(db.query(`insert into public.site_page_identity_decisions(organization_id,client_id,source_site_page_id,target_site_page_id,decision_kind,reason_code,evidence_snapshot)
  values ($1,$2,$3,$4,'claim_into','redirect_alias','{}')`, [org, client, source.id, foreignPage.id]), /foreign key/i);
await rejectsUnchanged({}, /active claim|already claimed/i);
for (const [kind, reason] of [['keep_separate', 'distinct_intent'], ['needs_research', 'conflicting_signals']]) {
  await rejectsUnchanged({ kind, reason, targetId: null, snapshot: evidenceFor(source, sourceSnapshot) }, /active claim|already claimed/i);
}
await decide({ sourceId: target.id, targetId: third.id, snapshot: evidenceFor(target, targetSnapshot, third, thirdSnapshot) });
await rejectsUnchanged({ sourceId: third.id, targetId: source.id, snapshot: evidenceFor(third, thirdSnapshot, source, sourceSnapshot) }, /cycle/i);
await rejectsUnchanged({ kind: 'reopen', reason: 'new_evidence' }, /target/i);
const reopened = await decide({ kind: 'reopen', reason: 'new_evidence', targetId: null, snapshot: evidenceFor(source, sourceSnapshot) });
assert.equal(reopened.target_site_page_id, target.id, 'reopen must retain the removed target in history');
assert.equal((await db.query('select count(*)::int as count from public.site_page_claims where source_site_page_id=$1', [source.id])).rows[0].count, 0);
assert.equal((await db.query('select target_site_page_id from public.site_page_claims where source_site_page_id=$1', [target.id])).rows[0].target_site_page_id, third.id);
assert.deepEqual((await db.query(`select
  (select jsonb_agg(t order by id) from public.site_pages t) as pages,
  (select jsonb_agg(t order by id) from public.site_page_urls t) as urls,
  (select jsonb_agg(t order by id) from public.site_page_snapshots t) as snapshots`)).rows[0], history);

// Every allowed reason is accepted for its kind; cross-kind reasons are rejected.
const reasons = {
  claim_into: ['redirect_alias','canonical_alias','protocol_or_host_variant','duplicate_page','historical_url','other'],
  keep_separate: ['distinct_intent','distinct_location','distinct_language','intentional_variant','different_content','other'],
  needs_research: ['content_purpose_unknown','conflicting_signals','target_unfetched','ownership_unknown','other'],
  reopen: ['incorrect_decision','new_evidence','site_changed','other'],
};
for (const kind of ['keep_separate', 'needs_research']) {
  await rejectsUnchanged({ kind, reason: reasons[kind][0] }, /target/i);
  for (const reason of reasons[kind]) {
    assert.equal((await decide({ kind, reason, targetId: null, note: 'Reviewed.', snapshot: evidenceFor(source, sourceSnapshot) })).reason_code, reason);
  }
}
for (const reason of reasons.claim_into) {
  await decide({ reason, note: 'Reviewed.' });
  await decide({ kind: 'reopen', reason: 'new_evidence', targetId: null, snapshot: evidenceFor(source, sourceSnapshot) });
}
for (const reason of reasons.reopen) {
  await decide();
  await decide({ kind: 'reopen', reason, note: 'Reviewed.', targetId: null, snapshot: evidenceFor(source, sourceSnapshot) });
}

// A failure in the active-state write must also roll back the preceding ledger insert.
await db.exec(`reset role;
  create function public.test_reject_identity_claim() returns trigger language plpgsql as $$
  begin raise exception 'Injected active claim failure'; end; $$;
  create trigger test_reject_identity_claim before insert on public.site_page_claims
    for each row execute function public.test_reject_identity_claim();
  set role service_role`);
await rejectsUnchanged({}, /Injected active claim failure/);
await db.exec(`reset role; drop trigger test_reject_identity_claim on public.site_page_claims;
  drop function public.test_reject_identity_claim(); set role service_role`);

// Membership is checked again at write time, after evidence has been loaded.
await db.exec('reset role');
await db.query('delete from public.organization_members where organization_id=$1 and user_id=$2', [org, reviewer]);
await db.exec('set role service_role');
await rejectsUnchanged({}, /member/i);
await db.exec('reset role');
await db.query('insert into public.organization_members(organization_id,user_id) values ($1,$2)', [org, reviewer]);
await db.exec('set role service_role');

// Incoming and outgoing paths both count toward the 32-edge ceiling.
const chain = [];
for (let index = 0; index < 34; index++) {
  const node = await page();
  chain.push({ page: node, snapshot: await observe(node) });
}
const chainDecision = (from, to) => ({ sourceId: chain[from].page.id, targetId: chain[to].page.id,
  snapshot: evidenceFor(chain[from].page, chain[from].snapshot, chain[to].page, chain[to].snapshot) });
for (let index = 31; index >= 0; index--) await decide(chainDecision(index, index + 1));
assert.equal((await db.query('select count(*)::int as count from public.site_page_claims')).rows[0].count, 33);
await rejectsUnchanged(chainDecision(33, 0), /depth|32/i);
await rejectsUnchanged(chainDecision(32, 33), /depth|32/i);

// Newer observations, including newer completed runs, invalidate stale review forms.
await observe(source, '2026-09-11T11:00:00Z');
await rejectsUnchanged({}, /stale|snapshot/i);
const laterRun = await crawl(org, client, '2026-09-11T12:00:00Z');
await rejectsUnchanged({ sourceId: third.id, targetId: null, kind: 'needs_research', reason: 'conflicting_signals', snapshot: evidenceFor(third, thirdSnapshot) }, /stale|snapshot/i);
const latestSource = await observe(source, '2026-09-11T13:00:00Z', laterRun);
await rejectsUnchanged({ snapshot: evidenceFor(source, latestSource, target, targetSnapshot) }, /stale|snapshot/i);
await decide({ targetId: null, kind: 'keep_separate', reason: 'distinct_intent', snapshot: evidenceFor(source, latestSource) });
await decide({ organizationId: otherOrg, clientId: otherClient, reviewerId: otherReviewer, sourceId: foreignPage.id,
  targetId: null, kind: 'needs_research', reason: 'conflicting_signals', snapshot: evidenceFor(foreignPage, foreignSnapshot) });

// Service grants and trigger protect append-only evidence, even from privileged mistakes.
await assert.rejects(db.query('update public.site_page_identity_decisions set note=\'changed\' where id=$1', [claimed.id]), /permission denied/i);
await assert.rejects(db.query('delete from public.site_page_identity_decisions where id=$1', [claimed.id]), /permission denied/i);
await assert.rejects(db.query('update public.site_page_claims set target_site_page_id=$1 where source_site_page_id=$2', [source.id, target.id]), /permission denied/i);
await db.exec('reset role');
await assert.rejects(db.query('update public.site_page_identity_decisions set evidence_snapshot=\'{}\' where id=$1', [claimed.id]), /immutable|append.only/i);
await assert.rejects(db.query('delete from public.site_page_identity_decisions where id=$1', [claimed.id]), /immutable|append.only/i);
await assert.rejects(db.query('update public.site_page_snapshots set title=\'changed\' where id=$1', [sourceSnapshot.id]), /immutable/i);
await assert.rejects(db.query('delete from public.site_page_snapshots where id=$1', [sourceSnapshot.id]), /immutable/i);

// Authenticated membership reads both tables, but no browser role can mutate or invoke.
const ownCount = (await db.query('select count(*)::int as count from public.site_page_identity_decisions where organization_id=$1', [org])).rows[0].count;
await db.exec(`set role authenticated; set "test.uid"='${reviewer}'`);
assert.equal((await db.query('select count(*)::int as count from public.site_page_identity_decisions')).rows[0].count, ownCount);
assert.equal((await db.query('select count(*)::int as count from public.site_page_claims')).rows[0].count, 33);
await db.exec(`set "test.uid"='${otherReviewer}'`);
assert.equal((await db.query('select count(*)::int as count from public.site_page_identity_decisions')).rows[0].count, 1);
assert.equal((await db.query('select count(*)::int as count from public.site_page_claims')).rows[0].count, 0);
for (const role of ['authenticated', 'anon']) {
  await db.exec(`reset role; set role ${role}`);
  await assert.rejects(decide(), /permission denied/i);
  for (const table of ['site_page_identity_decisions', 'site_page_claims']) {
    await assert.rejects(db.query(`insert into public.${table} default values`), /permission denied/i);
    await assert.rejects(db.query(`update public.${table} set client_id=$1`, [client]), /permission denied/i);
    await assert.rejects(db.query(`delete from public.${table}`), /permission denied/i);
    if (role === 'anon') await assert.rejects(db.query(`select * from public.${table}`), /permission denied/i);
  }
}
await db.exec('reset role');
const grants = (await db.query(`select table_name,grantee,privilege_type from information_schema.role_table_grants
  where table_name in ('site_page_identity_decisions','site_page_claims') and grantee in ('PUBLIC','anon','authenticated','service_role')
  order by table_name,grantee,privilege_type`)).rows;
assert.deepEqual(grants, [
  { table_name: 'site_page_claims', grantee: 'authenticated', privilege_type: 'SELECT' },
  ...['DELETE','INSERT','SELECT'].map(privilege_type => ({ table_name: 'site_page_claims', grantee: 'service_role', privilege_type })),
  { table_name: 'site_page_identity_decisions', grantee: 'authenticated', privilege_type: 'SELECT' },
  ...['INSERT','SELECT'].map(privilege_type => ({ table_name: 'site_page_identity_decisions', grantee: 'service_role', privilege_type })),
]);
const functions = (await db.query(`select proname,prosecdef,proconfig from pg_proc where proname in
  ('set_site_page_identity_decision','guard_site_page_identity_decision_immutable') order by proname`)).rows;
assert.equal(functions.length, 2);
assert.ok(functions.every(fn => !fn.prosecdef && fn.proconfig.includes('search_path=pg_catalog, public')));
for (const fn of functions) {
  const signature = fn.proname === 'set_site_page_identity_decision' ? '(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb)' : '()';
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') as allowed', [role, `public.${fn.proname}${signature}`])).rows[0].allowed, role === 'service_role');
  }
}
console.log('PASS: reviewed identity reasons, evidence freshness/scope, atomic claim/reopen, 32-edge bounds, immutable history, RLS, minimal grants, and service-only invoker RPC');
await db.close();
