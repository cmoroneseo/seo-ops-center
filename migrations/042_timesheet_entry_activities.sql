-- Migration 042: an imported entry carries MULTIPLE activities
--
-- Real reviewed data (Basecamp, August 2026) settled this: 3 of 14 entries
-- describe more than one kind of work. One 2h block was GBP Optimization +
-- Keyword Research & Strategy + Content Strategy; one 4h block was Technical
-- SEO Audit + Internal Linking Optimization. The hours were deliberately NOT
-- split — the whole block carries all of its tags. Multi-select here is
-- tagging, not splitting, so `hours` is untouched.
--
-- `activity_key` (migration 040) stays in place. This repo's migrations are
-- additive: the column is left behind and simply stops being read or written.
--
-- The same data also proved budget eligibility is NOT derivable from the
-- activity — Account Management & Comms was billable for two clients and
-- non-billable for two others, Internal Admin billable three times and
-- non-billable once. `counts_toward_budget` therefore stays an independent
-- column that the user's explicit choice owns; the activity set only ever
-- supplies a first-selection default, in application code.

alter table public.time_logs
  add column if not exists activity_keys text[] not null default '{}';

-- Carry forward whatever single activity a row already had. Zero rows match
-- today (context capture shipped after the last backfill), so this is a no-op
-- in production — but it must be correct for any environment that is not.
update public.time_logs
   set activity_keys = array[activity_key]
 where activity_key is not null
   and cardinality(activity_keys) = 0;

-- ---------------------------------------------------------------------------
-- Supersede the migration 041 RPC
--
-- 041 is already applied to production, so it is never edited in place. This
-- redefines the same function to whitelist and apply `activity_keys` instead
-- of `activity_key`. Everything else — the tenant guard, the duplicate-id
-- guard, the lock-then-write ordering, the internal-project forcing of
-- counts_toward_budget/client_id — is carried over unchanged.
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

  update public.time_logs as target
     set activity_keys = case
           when p_updates ? 'activity_keys' then v_activity_keys
           else target.activity_keys
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
