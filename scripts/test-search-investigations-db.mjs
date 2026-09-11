// Usage: node scripts/test-search-investigations-db.mjs [path-to-pglite-module]
// PGlite is an isolated test dependency and never connects to production.
const { PGlite } = await import(process.argv[2] ?? '@electric-sql/pglite');
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const db = new PGlite();
const org = '11111111-1111-1111-1111-111111111111';
const client = '22222222-2222-2222-2222-222222222222';
const user = '33333333-3333-3333-3333-333333333333';
const otherOrg = '99999999-9999-9999-9999-999999999999';
const otherClient = '88888888-8888-8888-8888-888888888888';
const otherUser = '77777777-7777-7777-7777-777777777777';

await db.exec(`
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.organizations(id uuid primary key);
create table public.users(
  id uuid primary key,
  organization_id uuid not null references public.organizations(id)
);
create table public.clients(
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  name text not null
);
create table public.client_integrations(
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  organization_id uuid not null references public.organizations(id),
  service text not null,
  sync_status text not null,
  credentials jsonb not null default '{}'::jsonb
);
create table public.tasks(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  project_id uuid,
  client_id uuid references public.clients(id),
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'todo' check (status in ('todo','in_progress','review','approved','blocked','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high','urgent')),
  category text,
  tags text[] not null default '{}',
  assignee_ids uuid[] not null default '{}',
  watcher_ids uuid[] not null default '{}',
  due_date timestamptz,
  start_date timestamptz,
  estimated_hours numeric(5,2),
  scheduled_minutes integer,
  deliverable_id uuid,
  parent_task_id uuid references public.tasks(id),
  sort_order integer not null default 0,
  created_by uuid references public.users(id),
  template_id uuid,
  recurrence jsonb,
  campaign_phase_id uuid,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create function public.get_user_org_ids() returns setof uuid language sql stable
as $$ select nullif(current_setting('test.org', true), '')::uuid $$;

alter table public.clients enable row level security;
alter table public.tasks enable row level security;
create policy clients_member on public.clients for select to authenticated
using (organization_id in (select public.get_user_org_ids()));
create policy tasks_member on public.tasks for all to authenticated
using (organization_id in (select public.get_user_org_ids()))
with check (organization_id in (select public.get_user_org_ids()));
grant select on public.clients to authenticated;
grant select, insert, update, delete on public.tasks to authenticated;

insert into public.organizations values ('${org}'), ('${otherOrg}');
insert into public.users values ('${user}', '${org}'), ('${otherUser}', '${otherOrg}');
insert into public.clients values
  ('${client}', '${org}', 'Ecoworkz'),
  ('${otherClient}', '${otherOrg}', 'Other');
insert into public.client_integrations(client_id, organization_id, service, sync_status, credentials)
values
  ('${client}', '${org}', 'gsc', 'active', '{"site_url":"sc-domain:ecoworkz.net","refresh_token":"secret"}'),
  ('${otherClient}', '${otherOrg}', 'gsc', 'active', '{"site_url":"sc-domain:other.test","refresh_token":"other-secret"}');
`);

await db.exec(readFileSync('migrations/052_search_investigation_workflow.sql', 'utf8'));

const deeperSnapshot = {
    version: 1,
    category: 'deeper_visibility',
    property: 'sc-domain:ecoworkz.net',
    start: '2026-09-01',
    end: '2026-09-07',
    query: 'hardscape contractor',
    page: 'https://www.ecoworkz.net/corona-ca/',
    clicks: 0,
    impressions: 237,
    ctr: 0,
    position: 33,
    observedDays: 7,
    limitations: ['Observed visibility is not proof of a ranking opportunity.'],
};
const nearSnapshot = { ...deeperSnapshot, category: 'near_page_one', position: 12 };
const pageSnapshot = {
    ...deeperSnapshot,
    category: 'page_visibility',
    query: undefined,
};
const overlapSnapshot = {
    ...deeperSnapshot,
    category: 'overlapping_urls',
    page: undefined,
    query: 'backyard remodel',
    pages: [
        { page: 'https://www.ecoworkz.net/a/', clicks: 0, impressions: 70, ctr: 0, position: 18, observedDays: 4 },
        { page: 'https://www.ecoworkz.net/b/', clicks: 0, impressions: 50, ctr: 0, position: 22, observedDays: 3 },
    ],
};

const decide = async ({
    clientId = client,
    property = 'sc-domain:ecoworkz.net',
    kind = 'query_page',
    query = 'hardscape contractor',
    page = 'https://www.ecoworkz.net/corona-ca/#services',
    status = 'open',
    reason = null,
    note = null,
    snapshot = deeperSnapshot,
} = {}) => db.query(`
select (public.set_search_investigation_decision(
  $1::uuid, $2::text, $3::text, $4::text, $5::text,
  $6::text, $7::text, $8::text, $9::jsonb
)).*
`, [clientId, property, kind, query, page, status, reason, note, JSON.stringify(snapshot)]);

await db.exec(`set role authenticated; set "test.org"='${org}'; set "test.uid"='${user}'`);

const opened = (await decide()).rows[0];
assert.equal(opened.status, 'open');
assert.equal(opened.query, 'hardscape contractor');
assert.equal(opened.page, 'https://www.ecoworkz.net/corona-ca/');

const refreshed = (await decide({
    query: ' Hardscape   Contractor ',
    page: 'https://www.ecoworkz.net/corona-ca/',
    snapshot: nearSnapshot,
})).rows[0];
assert.equal(refreshed.id, opened.id);
assert.equal((await db.query('select count(*)::int as count from public.search_investigations')).rows[0].count, 1);
assert.equal(refreshed.evidence_snapshot.category, 'near_page_one');

await decide({ kind: 'page', query: null, snapshot: pageSnapshot });
await decide({ kind: 'overlap', query: 'backyard remodel', page: null, snapshot: overlapSnapshot });
assert.equal((await db.query('select count(*)::int as count from public.search_investigations')).rows[0].count, 3);

await assert.rejects(decide({
    query: 'fractional metrics',
    page: 'https://www.ecoworkz.net/fractional/',
    snapshot: {
        ...deeperSnapshot,
        query: 'fractional metrics',
        page: 'https://www.ecoworkz.net/fractional/',
        impressions: 1.5,
    },
}), /evidence metrics/i);
await assert.rejects(decide({
    kind: 'overlap',
    query: 'invalid overlap',
    page: null,
    snapshot: { ...overlapSnapshot, query: 'invalid overlap', pages: [{}, {}] },
}), /retained page evidence/i);

await assert.rejects(decide({ status: 'dismissed' }), /dismissal reason/i);
await assert.rejects(decide({ status: 'dismissed', reason: 'invented_reason' }), /dismissal reason/i);
await assert.rejects(decide({ status: 'task_created' }), /task_created/i);

const reasons = [
    'not_relevant',
    'branded_or_navigational',
    'wrong_or_unsafe_url',
    'already_addressed',
    'insufficient_evidence',
    'no_action_warranted',
    'duplicate_investigation',
];
for (const reason of reasons) {
    const dismissed = (await decide({ status: 'dismissed', reason, note: 'Reviewed.' })).rows[0];
    assert.equal(dismissed.dismissal_reason, reason);
    const restored = (await decide({ status: 'open', snapshot: nearSnapshot })).rows[0];
    assert.equal(restored.status, 'open');
    assert.equal(restored.dismissal_reason, null);
}
const history = (await db.query('select status_history from public.search_investigations where id=$1::uuid', [opened.id])).rows[0].status_history;
assert.ok(history.length >= 15);
assert.ok(history.some(event => event.status === 'dismissed' && event.reason === 'insufficient_evidence'));

const createTask = task => db.query(`select (public.create_task_from_search_investigation($1::uuid, $2::jsonb)).*`, [opened.id, JSON.stringify(task)]);
const taskPayload = {
    title: 'Investigate hardscape contractor',
    description: 'Observed evidence only.',
    priority: 'medium',
    status: 'todo',
    category: 'strategy',
    tags: ['gsc', 'search-insights'],
    assigneeIds: [user],
};
const task = (await createTask(taskPayload)).rows[0];
const retriedTask = (await createTask(taskPayload)).rows[0];
assert.equal(retriedTask.id, task.id);
assert.equal((await db.query('select count(*)::int as count from public.tasks where custom_fields->>\'search_investigation_id\'=$1', [opened.id])).rows[0].count, 1);
assert.equal((await db.query('select status, task_id from public.search_investigations where id=$1::uuid', [opened.id])).rows[0].status, 'task_created');

await db.query('delete from public.tasks where id=$1::uuid', [task.id]);
const reopened = (await db.query('select status, task_id, status_history from public.search_investigations where id=$1::uuid', [opened.id])).rows[0];
assert.equal(reopened.status, 'open');
assert.equal(reopened.task_id, null);
assert.equal(reopened.status_history.at(-1).event, 'linked_task_deleted');

const failureInvestigation = (await decide({
    query: 'failure case',
    page: 'https://www.ecoworkz.net/failure/',
    snapshot: { ...deeperSnapshot, query: 'failure case', page: 'https://www.ecoworkz.net/failure/' },
})).rows[0];
const taskCount = (await db.query('select count(*)::int as count from public.tasks')).rows[0].count;
await assert.rejects(
    db.query(`select public.create_task_from_search_investigation($1::uuid, $2::jsonb)`, [failureInvestigation.id, JSON.stringify({ ...taskPayload, title: ' ' })]),
    /title/i,
);
assert.equal((await db.query('select count(*)::int as count from public.tasks')).rows[0].count, taskCount);
assert.equal((await db.query('select status from public.search_investigations where id=$1::uuid', [failureInvestigation.id])).rows[0].status, 'open');

await assert.rejects(decide({ property: 'sc-domain:stale.example' }), /selected GSC property/i);
await assert.rejects(db.query('select credentials from public.client_integrations'), /permission denied/i);

await db.exec(`reset role; update public.client_integrations set credentials='{"site_url":"sc-domain:new.example","refresh_token":"secret"}' where client_id='${client}'; set role authenticated; set "test.org"='${org}'; set "test.uid"='${user}'`);
await assert.rejects(decide({
    query: 'failure case',
    page: 'https://www.ecoworkz.net/failure/',
    snapshot: { ...deeperSnapshot, query: 'failure case', page: 'https://www.ecoworkz.net/failure/' },
}), /selected GSC property/i);
await assert.rejects(
    db.query(`select public.create_task_from_search_investigation($1::uuid, $2::jsonb)`, [failureInvestigation.id, JSON.stringify(taskPayload)]),
    /selected GSC property/i,
);
assert.equal((await db.query('select count(*)::int as count from public.tasks')).rows[0].count, taskCount);

await db.exec(`set "test.org"='${otherOrg}'; set "test.uid"='${otherUser}'`);
assert.equal((await db.query('select count(*)::int as count from public.search_investigations')).rows[0].count, 0);
await assert.rejects(decide(), /client|property|permission/i);

await db.exec('reset role; set role anon');
await assert.rejects(db.query('select * from public.search_investigations'), /permission denied/i);
await assert.rejects(decide(), /permission denied/i);
await assert.rejects(db.query(`select public.create_task_from_search_investigation('${opened.id}', '{}'::jsonb)`), /permission denied/i);

await db.exec('reset role');
const grants = await db.query(`
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema='public' and table_name='search_investigations'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type
`);
assert.deepEqual(grants.rows, [
    { grantee: 'authenticated', privilege_type: 'INSERT' },
    { grantee: 'authenticated', privilege_type: 'SELECT' },
    { grantee: 'authenticated', privilege_type: 'UPDATE' },
]);

const functionGrants = await db.query(`
select routine_name, grantee
from information_schema.role_routine_grants
where specific_schema='public'
  and routine_name in (
    'is_selected_gsc_property',
    'set_search_investigation_decision',
    'create_task_from_search_investigation'
  )
  and grantee in ('anon', 'authenticated')
order by routine_name, grantee
`);
assert.deepEqual(functionGrants.rows, [
    { routine_name: 'create_task_from_search_investigation', grantee: 'authenticated' },
    { routine_name: 'is_selected_gsc_property', grantee: 'authenticated' },
    { routine_name: 'set_search_investigation_decision', grantee: 'authenticated' },
]);

console.log('PASS: 7 dismissal reasons, restore history, semantic identities, selected-property guard, atomic task idempotency/rollback, linked-task reopen, tenant RLS, and anon denial');
await db.close();
