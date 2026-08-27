-- Migration 044: an imported entry can be linked to a task
--
-- A teammate's reviewed August notes repeatedly reference Basecamp to-dos
-- ("Checked off Basecamp to-do's", "Added roadmap To-do's to basecamp"), yet
-- zero of his fourteen imported entries carry a task link: every one was
-- logged at the Basecamp PROJECT level rather than against a to-do, so the
-- CSV has nothing to attach.
--
-- The link therefore has to be made during review, and it is made in SEO PM
-- only. A Basecamp timesheet entry cannot be re-parented in place --
-- `updateBasecampTimesheetEntry` accepts date/hours/description/person and
-- nothing else -- and deleting and recreating it would mint a new
-- `basecamp_entry_id`, destroying the dedupe identity the whole import design
-- rests on. So `time_logs.task_id` carries the attribution and the Basecamp
-- entry stays exactly where it is.
--
-- No new column: `time_logs.task_id` has existed since 001. What is new is
-- that the review RPC may write it.
--
-- ---------------------------------------------------------------------------
-- Supersede the migration 043 RPC
--
-- 041 defined this function, 042 and 043 redefined it; all three are already
-- applied to production, so none is ever edited in place. This fourth
-- definition adds `task_id` to the patch-key whitelist and validates that the
-- referenced task exists, belongs to `p_organization_id`, and belongs to the
-- same client as every row being patched. Every earlier guard -- the tenant
-- scope, the duplicate-id guard, the lock-then-write ordering, the
-- internal-project forcing of counts_toward_budget/client_id, the activity
-- and reference-link shape checks -- is carried over unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.apply_timesheet_import_transition(
  p_organization_id uuid,
  p_ids uuid[],
  p_authorized_user_id uuid,
  p_expected_status text,
  p_updates jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target_count integer;
  v_changed_count integer;
  v_client_id uuid;
  v_activity_keys text[];
  v_task_id uuid;
  v_task_client_id uuid;
begin
  if p_organization_id is null
     or p_ids is null
     or cardinality(p_ids) = 0
     or array_position(p_ids, null) is not null
     or cardinality(p_ids) <> (
       select count(distinct requested_id)
       from unnest(p_ids) as requested(requested_id)
     ) then
    raise exception 'invalid timesheet import transition target'
      using errcode = '22023';
  end if;

  if p_expected_status not in ('needs_context', 'pending_review') then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates is null or jsonb_typeof(p_updates) <> 'object' then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_updates) as patch_key(key)
    where patch_key.key not in (
      'activity_keys',
      'reference_links',
      'task_id',
      'description',
      'counts_toward_budget',
      'client_id',
      'import_status',
      'submitted_at',
      'submitted_by',
      'reviewed_at',
      'reviewed_by',
      'review_note'
    )
  ) then
    raise exception 'invalid timesheet import transition patch'
      using errcode = '22023';
  end if;

  if p_updates ? 'activity_keys' then
    if jsonb_typeof(p_updates -> 'activity_keys') <> 'array' then
      raise exception 'invalid timesheet import transition activities'
        using errcode = '22023';
    end if;

    select coalesce(array_agg(element.value order by element.ordinality), '{}'::text[])
      into v_activity_keys
      from jsonb_array_elements_text(p_updates -> 'activity_keys')
        with ordinality as element(value, ordinality);

    if array_position(v_activity_keys, null) is not null then
      raise exception 'invalid timesheet import transition activities'
        using errcode = '22023';
    end if;
  end if;

  -- A reference link is a {label, url} object and nothing else. Both fields
  -- must be strings: a number or a nested object here would reach the review
  -- UI as an href, and the column is the artifact list a client-month review
  -- will read back.
  if p_updates ? 'reference_links' then
    if jsonb_typeof(p_updates -> 'reference_links') <> 'array' then
      raise exception 'invalid timesheet import transition reference links'
        using errcode = '22023';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_updates -> 'reference_links') as link(value)
      where jsonb_typeof(link.value) <> 'object'
         or jsonb_typeof(link.value -> 'label') is distinct from 'string'
         or jsonb_typeof(link.value -> 'url') is distinct from 'string'
    ) then
      raise exception 'invalid timesheet import transition reference links'
        using errcode = '22023';
    end if;
  end if;

  if p_updates ? 'import_status'
     and coalesce(p_updates ->> 'import_status', '') not in (
       'needs_context',
       'pending_review',
       'mapped',
       'voided'
     ) then
    raise exception 'invalid timesheet import transition status'
      using errcode = '22023';
  end if;

  if p_updates ? 'client_id'
     and jsonb_typeof(p_updates -> 'client_id') <> 'null' then
    begin
      v_client_id := (p_updates ->> 'client_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid timesheet import transition client'
          using errcode = '22023';
    end;

    perform clients.id
    from public.clients
    where clients.id = v_client_id
      and clients.organization_id = p_organization_id
    for key share;

    if not found then
      raise exception 'timesheet_import_transition_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  -- A task link may only point at a task inside this tenant. Resolved and
  -- locked exactly the way `client_id` is, so a task deleted or moved mid
  -- review cannot be linked by a racing patch.
  if p_updates ? 'task_id'
     and jsonb_typeof(p_updates -> 'task_id') <> 'null' then
    begin
      v_task_id := (p_updates ->> 'task_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'invalid timesheet import transition task'
          using errcode = '22023';
    end;

    select tasks.client_id
      into v_task_client_id
      from public.tasks
      where tasks.id = v_task_id
        and tasks.organization_id = p_organization_id
      for key share;

    if not found then
      raise exception 'timesheet_import_transition_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  -- Lock the complete authorized target set before deciding whether to write.
  select count(*)
    into v_target_count
    from (
      select time_logs.id
      from public.time_logs
      where time_logs.organization_id = p_organization_id
        and time_logs.id = any(p_ids)
        and time_logs.import_status = p_expected_status
        and (
          p_authorized_user_id is null
          or time_logs.user_id = p_authorized_user_id
        )
      for update
    ) as locked_targets;

  if v_target_count <> cardinality(p_ids) then
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  -- The task must belong to the SAME client as every row being patched,
  -- counting the client this very patch sets. Linking a task from another
  -- client would silently mis-attribute billable time to that client's work.
  if p_updates ? 'task_id' and v_task_id is not null then
    if exists (
      select 1
      from public.time_logs
      where time_logs.organization_id = p_organization_id
        and time_logs.id = any(p_ids)
        and (case
               when p_updates ? 'client_id' then v_client_id
               else time_logs.client_id
             end) is distinct from v_task_client_id
    ) then
      raise exception 'timesheet_import_transition_conflict'
        using errcode = 'P0001';
    end if;
  end if;

  update public.time_logs as target
     set activity_keys = case
           when p_updates ? 'activity_keys' then v_activity_keys
           else target.activity_keys
         end,
         task_id = case
           when p_updates ? 'task_id' then v_task_id
           else target.task_id
         end,
         reference_links = case
           when p_updates ? 'reference_links' then p_updates -> 'reference_links'
           else target.reference_links
         end,
         description = case
           when p_updates ? 'description' then p_updates ->> 'description'
           else target.description
         end,
         counts_toward_budget = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then false
           when p_updates ? 'counts_toward_budget'
             then (p_updates ->> 'counts_toward_budget')::boolean
           else target.counts_toward_budget
         end,
         client_id = case
           when exists (
             select 1
             from public.basecamp_project_roles
             where basecamp_project_roles.organization_id = target.organization_id
               and basecamp_project_roles.basecamp_project_id = target.basecamp_project_id
               and basecamp_project_roles.role = 'internal'
           ) then null
           when p_updates ? 'client_id' then v_client_id
           else target.client_id
         end,
         import_status = case
           when p_updates ? 'import_status' then p_updates ->> 'import_status'
           else target.import_status
         end,
         submitted_at = case
           when p_updates ? 'submitted_at' then (p_updates ->> 'submitted_at')::timestamptz
           else target.submitted_at
         end,
         submitted_by = case
           when p_updates ? 'submitted_by' then (p_updates ->> 'submitted_by')::uuid
           else target.submitted_by
         end,
         reviewed_at = case
           when p_updates ? 'reviewed_at' then (p_updates ->> 'reviewed_at')::timestamptz
           else target.reviewed_at
         end,
         reviewed_by = case
           when p_updates ? 'reviewed_by' then (p_updates ->> 'reviewed_by')::uuid
           else target.reviewed_by
         end,
         review_note = case
           when p_updates ? 'review_note' then p_updates ->> 'review_note'
           else target.review_note
         end
   where target.organization_id = p_organization_id
     and target.id = any(p_ids)
     and target.import_status = p_expected_status
     and (
       p_authorized_user_id is null
       or target.user_id = p_authorized_user_id
     );

  get diagnostics v_changed_count = row_count;
  if v_changed_count <> cardinality(p_ids) then
    -- Raising rolls this function call back, including any rows just updated.
    raise exception 'timesheet_import_transition_conflict'
      using errcode = 'P0001';
  end if;

  return v_changed_count;
end;
$$;

revoke execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_timesheet_import_transition(uuid, uuid[], uuid, text, jsonb)
  to service_role;
