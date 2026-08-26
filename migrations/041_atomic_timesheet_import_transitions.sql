-- Migration 041: atomic and tenant-safe import review mutations
--
-- Migration 040 may already be applied. This additive RPC closes the
-- validation-to-write race without rewriting that migration.

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
      'activity_key',
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
     set activity_key = case
           when p_updates ? 'activity_key' then p_updates ->> 'activity_key'
           else target.activity_key
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
