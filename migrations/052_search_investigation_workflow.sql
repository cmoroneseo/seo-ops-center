-- Persist evidence-backed Search Insights decisions and atomically link tasks.
-- OAuth credentials remain private; the narrow property predicate exposes only
-- whether a member-selected client/property pair is current.

create or replace function public.is_selected_gsc_property(
  p_client_id uuid,
  p_property text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.clients c
    join public.client_integrations ci
      on ci.client_id = c.id
     and ci.organization_id = c.organization_id
     and ci.service = 'gsc'
     and ci.sync_status in ('active', 'error')
    where c.id = p_client_id
      and c.organization_id in (select public.get_user_org_ids())
      and ci.credentials ->> 'site_url' = p_property
  );
$$;

revoke all on function public.is_selected_gsc_property(uuid, text) from public, anon;
grant execute on function public.is_selected_gsc_property(uuid, text) to authenticated, service_role;

create table public.search_investigations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  property text not null check (length(property) between 1 and 2048),
  kind text not null check (kind in ('query_page', 'page', 'overlap')),
  identity_key text generated always as (
    md5(kind || chr(31) || lower(coalesce(query, '')) || chr(31) || coalesce(page, ''))
  ) stored,
  query text check (query is null or length(query) between 1 and 2048),
  page text check (page is null or length(page) between 1 and 8192),
  status text not null default 'open' check (status in ('open', 'dismissed', 'task_created')),
  task_id uuid references public.tasks(id) on delete set null,
  dismissal_reason text check (dismissal_reason in (
    'not_relevant', 'branded_or_navigational', 'wrong_or_unsafe_url',
    'already_addressed', 'insufficient_evidence', 'no_action_warranted',
    'duplicate_investigation'
  )),
  dismissal_note text check (dismissal_note is null or length(dismissal_note) <= 1000),
  evidence_snapshot jsonb not null check (pg_column_size(evidence_snapshot) <= 262144),
  status_history jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (
    (kind = 'query_page' and query is not null and page is not null) or
    (kind = 'page' and query is null and page is not null) or
    (kind = 'overlap' and query is not null and page is null)
  ),
  check ((status = 'dismissed') = (dismissal_reason is not null)),
  check ((status = 'task_created') = (task_id is not null)),
  unique (organization_id, client_id, property, kind, identity_key)
);

create index search_investigations_client_updated_idx
  on public.search_investigations (organization_id, client_id, updated_at desc);

create unique index tasks_search_investigation_source_idx
  on public.tasks (organization_id, (custom_fields ->> 'search_investigation_id'))
  where custom_fields ? 'search_investigation_id';

alter table public.search_investigations enable row level security;

create policy search_investigations_select
  on public.search_investigations for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));

create policy search_investigations_insert
  on public.search_investigations for insert to authenticated
  with check (organization_id in (select public.get_user_org_ids()));

create policy search_investigations_update
  on public.search_investigations for update to authenticated
  using (organization_id in (select public.get_user_org_ids()))
  with check (organization_id in (select public.get_user_org_ids()));

revoke all on public.search_investigations from anon, authenticated;
grant select, insert, update on public.search_investigations to authenticated;
grant all on public.search_investigations to service_role;

create or replace function public.guard_search_investigation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_actor uuid := auth.uid();
  v_event text := 'decision';
  v_history_event jsonb;
  v_snapshot_category text;
  v_page_evidence jsonb;
begin
  if tg_op = 'UPDATE' then
    if (new.organization_id, new.client_id, new.property, new.kind, new.query, new.page)
       is distinct from
       (old.organization_id, old.client_id, old.property, old.kind, old.query, old.page) then
      raise exception 'Investigation identity is immutable';
    end if;

    if old.status in ('dismissed', 'task_created')
       and new.evidence_snapshot is distinct from old.evidence_snapshot then
      raise exception 'Decided investigation evidence is immutable';
    end if;

    if old.status = 'task_created' and old.task_id is not null and new.task_id is null then
      new.status := 'open';
      new.dismissal_reason := null;
      new.dismissal_note := null;
      v_event := 'linked_task_deleted';
    end if;

    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.status_history := old.status_history;
  else
    if not public.is_selected_gsc_property(new.client_id, new.property) then
      raise exception 'Property is not the selected GSC property';
    end if;
    new.created_by := coalesce(v_actor, new.created_by);
    new.status_history := '[]'::jsonb;
  end if;

  if tg_op = 'UPDATE'
     and v_event <> 'linked_task_deleted'
     and not public.is_selected_gsc_property(new.client_id, new.property) then
    raise exception 'Property is not the selected GSC property';
  end if;

  if jsonb_typeof(new.evidence_snapshot) <> 'object'
     or new.evidence_snapshot ->> 'version' <> '1'
     or new.evidence_snapshot ->> 'property' is distinct from new.property
     or jsonb_typeof(new.evidence_snapshot -> 'limitations') <> 'array'
     or jsonb_array_length(new.evidence_snapshot -> 'limitations') = 0
     or exists (
       select 1 from jsonb_array_elements(new.evidence_snapshot -> 'limitations') item
       where jsonb_typeof(item) <> 'string' or length(btrim(item #>> '{}')) = 0
     ) then
    raise exception 'Invalid investigation evidence snapshot';
  end if;

  v_snapshot_category := new.evidence_snapshot ->> 'category';
  if (new.kind = 'query_page' and v_snapshot_category not in ('near_page_one', 'deeper_visibility'))
     or (new.kind = 'page' and v_snapshot_category <> 'page_visibility')
     or (new.kind = 'overlap' and v_snapshot_category <> 'overlapping_urls') then
    raise exception 'Evidence category does not match investigation kind';
  end if;

  if jsonb_typeof(new.evidence_snapshot -> 'clicks') <> 'number'
     or jsonb_typeof(new.evidence_snapshot -> 'impressions') <> 'number'
     or jsonb_typeof(new.evidence_snapshot -> 'ctr') <> 'number'
     or jsonb_typeof(new.evidence_snapshot -> 'position') <> 'number'
     or jsonb_typeof(new.evidence_snapshot -> 'observedDays') <> 'number'
     or (new.evidence_snapshot ->> 'clicks')::numeric < 0
     or (new.evidence_snapshot ->> 'clicks')::numeric <> trunc((new.evidence_snapshot ->> 'clicks')::numeric)
     or (new.evidence_snapshot ->> 'impressions')::numeric <= 0
     or (new.evidence_snapshot ->> 'impressions')::numeric <> trunc((new.evidence_snapshot ->> 'impressions')::numeric)
     or (new.evidence_snapshot ->> 'ctr')::numeric not between 0 and 1
     or (new.evidence_snapshot ->> 'position')::numeric < 0
     or (new.evidence_snapshot ->> 'observedDays')::numeric <= 0
     or (new.evidence_snapshot ->> 'observedDays')::numeric <> trunc((new.evidence_snapshot ->> 'observedDays')::numeric) then
    raise exception 'Invalid investigation evidence metrics';
  end if;

  if (new.evidence_snapshot ->> 'start')::date > (new.evidence_snapshot ->> 'end')::date then
    raise exception 'Invalid investigation evidence window';
  end if;

  if new.kind in ('query_page', 'overlap')
     and lower(regexp_replace(btrim(new.evidence_snapshot ->> 'query'), '[[:space:]]+', ' ', 'g'))
         is distinct from lower(new.query) then
    raise exception 'Evidence query does not match investigation identity';
  end if;

  if new.kind in ('query_page', 'page')
     and split_part(btrim(new.evidence_snapshot ->> 'page'), '#', 1) is distinct from new.page then
    raise exception 'Evidence page does not match investigation identity';
  end if;

  if new.kind = 'overlap'
     and (jsonb_typeof(new.evidence_snapshot -> 'pages') <> 'array'
          or jsonb_array_length(new.evidence_snapshot -> 'pages') < 2) then
    raise exception 'Overlap evidence requires at least two retained pages';
  end if;
  if new.kind = 'overlap' then
    for v_page_evidence in select value from jsonb_array_elements(new.evidence_snapshot -> 'pages') loop
      if jsonb_typeof(v_page_evidence) <> 'object'
         or coalesce(v_page_evidence ->> 'page', '') !~* '^https?://'
         or jsonb_typeof(v_page_evidence -> 'clicks') <> 'number'
         or jsonb_typeof(v_page_evidence -> 'impressions') <> 'number'
         or jsonb_typeof(v_page_evidence -> 'ctr') <> 'number'
         or jsonb_typeof(v_page_evidence -> 'position') <> 'number'
         or jsonb_typeof(v_page_evidence -> 'observedDays') <> 'number' then
        raise exception 'Invalid retained page evidence';
      end if;
      if (v_page_evidence ->> 'clicks')::numeric < 0
         or (v_page_evidence ->> 'clicks')::numeric <> trunc((v_page_evidence ->> 'clicks')::numeric)
         or (v_page_evidence ->> 'impressions')::numeric <= 0
         or (v_page_evidence ->> 'impressions')::numeric <> trunc((v_page_evidence ->> 'impressions')::numeric)
         or (v_page_evidence ->> 'ctr')::numeric not between 0 and 1
         or (v_page_evidence ->> 'position')::numeric < 0
         or (v_page_evidence ->> 'observedDays')::numeric <= 0
         or (v_page_evidence ->> 'observedDays')::numeric <> trunc((v_page_evidence ->> 'observedDays')::numeric) then
        raise exception 'Invalid retained page evidence metrics';
      end if;
    end loop;
  end if;

  if new.status = 'task_created' then
    perform 1
    from public.tasks t
    where t.id = new.task_id
      and t.organization_id = new.organization_id
      and t.client_id = new.client_id
      and t.custom_fields ->> 'search_investigation_id' = new.id::text;
    if not found then
      raise exception 'Linked task does not match investigation';
    end if;
  end if;

  new.updated_by := coalesce(v_actor, new.updated_by);
  new.updated_at := timezone('utc', now());

  if tg_op = 'INSERT' or new.status is distinct from old.status or v_event = 'linked_task_deleted' then
    v_history_event := jsonb_build_object(
      'version', 1,
      'status', new.status,
      'event', v_event,
      'at', new.updated_at
    );
    if v_actor is not null then
      v_history_event := v_history_event || jsonb_build_object('actorId', v_actor);
    end if;
    if new.dismissal_reason is not null then
      v_history_event := v_history_event || jsonb_build_object('reason', new.dismissal_reason);
    end if;
    if new.dismissal_note is not null then
      v_history_event := v_history_event || jsonb_build_object('note', new.dismissal_note);
    end if;
    new.status_history := new.status_history || jsonb_build_array(v_history_event);
  end if;

  return new;
end;
$$;

revoke all on function public.guard_search_investigation() from public, anon, authenticated;

create trigger guard_search_investigation_row
before insert or update on public.search_investigations
for each row execute function public.guard_search_investigation();

create or replace function public.set_search_investigation_decision(
  p_client_id uuid,
  p_property text,
  p_kind text,
  p_query text,
  p_page text,
  p_status text,
  p_dismissal_reason text,
  p_dismissal_note text,
  p_evidence_snapshot jsonb
)
returns public.search_investigations
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_organization_id uuid;
  v_query text;
  v_page text;
  v_identity_key text;
  v_existing public.search_investigations%rowtype;
  v_result public.search_investigations%rowtype;
begin
  if p_kind not in ('query_page', 'page', 'overlap') then
    raise exception 'Invalid investigation kind';
  end if;
  if p_status = 'task_created' then
    raise exception 'task_created requires atomic task creation';
  end if;
  if p_status not in ('open', 'dismissed') then
    raise exception 'Invalid investigation status';
  end if;
  if (p_status = 'dismissed') <> (p_dismissal_reason is not null) then
    raise exception 'A valid dismissal reason is required only for dismissal';
  end if;
  if p_dismissal_reason is not null and p_dismissal_reason not in (
    'not_relevant', 'branded_or_navigational', 'wrong_or_unsafe_url',
    'already_addressed', 'insufficient_evidence', 'no_action_warranted',
    'duplicate_investigation'
  ) then
    raise exception 'Invalid dismissal reason';
  end if;
  if p_dismissal_note is not null and length(btrim(p_dismissal_note)) > 1000 then
    raise exception 'Dismissal note is too long';
  end if;

  v_query := nullif(regexp_replace(btrim(p_query), '[[:space:]]+', ' ', 'g'), '');
  v_page := nullif(split_part(btrim(p_page), '#', 1), '');
  if (p_kind = 'query_page' and (v_query is null or v_page is null))
     or (p_kind = 'page' and (v_query is not null or v_page is null))
     or (p_kind = 'overlap' and (v_query is null or v_page is not null)) then
    raise exception 'Investigation identity is incomplete';
  end if;
  if v_page is not null and v_page !~* '^https?://' then
    raise exception 'Investigation page must use HTTP(S)';
  end if;

  select c.organization_id
  into v_organization_id
  from public.clients c
  where c.id = p_client_id
    and c.organization_id in (select public.get_user_org_ids());
  if not found then
    raise exception 'Client is not available to this user';
  end if;
  if not public.is_selected_gsc_property(p_client_id, p_property) then
    raise exception 'Property is not the selected GSC property';
  end if;

  v_identity_key := md5(p_kind || chr(31) || lower(coalesce(v_query, '')) || chr(31) || coalesce(v_page, ''));
  select * into v_existing
  from public.search_investigations
  where organization_id = v_organization_id
    and client_id = p_client_id
    and property = p_property
    and kind = p_kind
    and identity_key = v_identity_key
  for update;

  if not found then
    insert into public.search_investigations (
      organization_id, client_id, property, kind, query, page, status,
      dismissal_reason, dismissal_note, evidence_snapshot
    ) values (
      v_organization_id, p_client_id, p_property, p_kind, v_query, v_page, p_status,
      p_dismissal_reason, nullif(btrim(p_dismissal_note), ''), p_evidence_snapshot
    )
    returning * into v_result;
    return v_result;
  end if;

  if v_existing.status = 'task_created' then
    raise exception 'Investigation already has a linked task';
  end if;

  update public.search_investigations
  set status = p_status,
      dismissal_reason = p_dismissal_reason,
      dismissal_note = case when p_status = 'dismissed' then nullif(btrim(p_dismissal_note), '') else null end,
      evidence_snapshot = case when v_existing.status = 'dismissed' then v_existing.evidence_snapshot else p_evidence_snapshot end
  where id = v_existing.id
  returning * into v_result;
  return v_result;
end;
$$;

revoke all on function public.set_search_investigation_decision(uuid, text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.set_search_investigation_decision(uuid, text, text, text, text, text, text, text, jsonb) to authenticated, service_role;

create or replace function public.create_task_from_search_investigation(
  p_investigation_id uuid,
  p_task jsonb
)
returns public.tasks
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_investigation public.search_investigations%rowtype;
  v_task public.tasks%rowtype;
  v_title text;
  v_status text;
  v_priority text;
  v_assignee_ids uuid[];
  v_watcher_ids uuid[];
  v_tags text[];
begin
  if jsonb_typeof(p_task) <> 'object' then
    raise exception 'Task payload must be an object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_task) key
    where key <> all (array[
      'title', 'description', 'assigneeIds', 'watcherIds', 'dueDate', 'startDate',
      'priority', 'status', 'category', 'tags', 'estimatedHours', 'scheduledMinutes',
      'deliverableId', 'sortOrder', 'templateId', 'recurrence', 'campaignPhaseId'
    ])
  ) then
    raise exception 'Task payload contains unsupported fields';
  end if;

  select * into v_investigation
  from public.search_investigations
  where id = p_investigation_id
  for update;
  if not found then
    raise exception 'Investigation is not available to this user';
  end if;

  if v_investigation.task_id is not null then
    select * into v_task from public.tasks where id = v_investigation.task_id;
    if not found then
      raise exception 'Linked task is unavailable';
    end if;
    return v_task;
  end if;
  if v_investigation.status = 'dismissed' then
    raise exception 'Restore the investigation before creating a task';
  end if;

  v_title := btrim(p_task ->> 'title');
  v_status := coalesce(nullif(p_task ->> 'status', ''), 'todo');
  v_priority := coalesce(nullif(p_task ->> 'priority', ''), 'medium');
  if v_title is null or length(v_title) = 0 or length(v_title) > 500 then
    raise exception 'Task title must contain 1 to 500 characters';
  end if;
  if v_status not in ('todo', 'in_progress', 'review', 'approved', 'blocked', 'done') then
    raise exception 'Invalid task status';
  end if;
  if v_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'Invalid task priority';
  end if;
  if p_task ? 'assigneeIds' and jsonb_typeof(p_task -> 'assigneeIds') <> 'array' then
    raise exception 'Task assigneeIds must be an array';
  end if;
  if p_task ? 'watcherIds' and jsonb_typeof(p_task -> 'watcherIds') <> 'array' then
    raise exception 'Task watcherIds must be an array';
  end if;
  if p_task ? 'tags' and jsonb_typeof(p_task -> 'tags') <> 'array' then
    raise exception 'Task tags must be an array';
  end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_assignee_ids
  from jsonb_array_elements_text(coalesce(p_task -> 'assigneeIds', '[]'::jsonb));
  select coalesce(array_agg(value::uuid), '{}'::uuid[]) into v_watcher_ids
  from jsonb_array_elements_text(coalesce(p_task -> 'watcherIds', '[]'::jsonb));
  select coalesce(array_agg(btrim(value)), '{}'::text[]) into v_tags
  from jsonb_array_elements_text(coalesce(p_task -> 'tags', '[]'::jsonb));

  insert into public.tasks (
    organization_id, client_id, title, description, status, priority, category,
    tags, assignee_ids, watcher_ids, due_date, start_date, estimated_hours,
    scheduled_minutes, deliverable_id, sort_order, created_by, template_id,
    recurrence, campaign_phase_id, custom_fields
  ) values (
    v_investigation.organization_id,
    v_investigation.client_id,
    v_title,
    nullif(p_task ->> 'description', ''),
    v_status,
    v_priority,
    nullif(p_task ->> 'category', ''),
    v_tags,
    v_assignee_ids,
    v_watcher_ids,
    nullif(p_task ->> 'dueDate', '')::timestamptz,
    nullif(p_task ->> 'startDate', '')::timestamptz,
    nullif(p_task ->> 'estimatedHours', '')::numeric,
    nullif(p_task ->> 'scheduledMinutes', '')::integer,
    nullif(p_task ->> 'deliverableId', '')::uuid,
    coalesce(nullif(p_task ->> 'sortOrder', '')::integer, 0),
    auth.uid(),
    nullif(p_task ->> 'templateId', '')::uuid,
    p_task -> 'recurrence',
    nullif(p_task ->> 'campaignPhaseId', '')::uuid,
    jsonb_build_object(
      'search_investigation_id', v_investigation.id,
      'search_investigation_source', 'gsc'
    )
  )
  returning * into v_task;

  update public.search_investigations
  set status = 'task_created', task_id = v_task.id,
      dismissal_reason = null, dismissal_note = null
  where id = v_investigation.id;

  return v_task;
end;
$$;

revoke all on function public.create_task_from_search_investigation(uuid, jsonb) from public, anon;
grant execute on function public.create_task_from_search_investigation(uuid, jsonb) to authenticated, service_role;
