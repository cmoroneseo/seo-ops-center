-- Migration 145: Ordered GBP post photos and version-scoped photo feedback.

alter table public.approval_item_versions add column if not exists photo_paths text[];

-- The version trigger normally disallows every update. Bypass it only for this
-- backfill, in the same statement transaction, while the table is locked.
do $$
begin
  alter table public.approval_item_versions disable trigger approval_version_scope;
  update public.approval_item_versions
    set photo_paths = array_remove(array[photo_path], null)
    where photo_paths is null;
  alter table public.approval_item_versions enable trigger approval_version_scope;
  alter table public.approval_item_versions alter column photo_paths set not null;
end $$;

alter table public.approval_comments
  add column if not exists photo_position integer check (photo_position between 1 and 10);
alter table public.approval_internal_feedback
  add column if not exists photo_position integer check (photo_position between 1 and 10);

-- An explicit gallery is an ordered JSON array of valid, nonempty photo paths.
-- Keep the two-argument sanitizer for existing single-photo callers.
create or replace function public.approval_photo_paths(p_photos jsonb)
returns text[] language plpgsql immutable set search_path = pg_catalog, public as $$
declare paths text[];
begin
  if jsonb_typeof(p_photos) is distinct from 'array' then return null; end if;
  if jsonb_array_length(p_photos) > 10 then return null; end if;
  if exists (select 1 from jsonb_array_elements(p_photos) e
    where jsonb_typeof(e) is distinct from 'string' or char_length(e#>>'{}') > 500
      or (e#>>'{}') !~ '^(https://\S+|(approval-assets|gbp-approvals)/[0-9a-f-]{36}/[0-9a-f-]{36})$')
  then return null; end if;
  select coalesce(array_agg(value order by ord), '{}') into paths
    from jsonb_array_elements_text(p_photos) with ordinality as a(value, ord);
  return paths;
end $$;

create or replace function public.gbp_approval_clean_post(p_payload jsonb, p_photo text, p_photos jsonb)
returns jsonb language plpgsql immutable set search_path = pg_catalog, public as $$
declare paths text[]; clean jsonb;
begin
  if p_photos is not null then
    paths := public.approval_photo_paths(p_photos);
    if paths is null then return null; end if;
    p_photo := paths[1];
  end if;
  clean := public.gbp_approval_clean_post(p_payload, case when p_photo like 'approval-assets/%' then null else p_photo end);
  if clean is null then return null; end if;
  if p_photo like 'approval-assets/%' then
    if public.approval_photo_paths(jsonb_build_array(p_photo)) is null then return null; end if;
    clean := jsonb_set(clean, '{photo}', to_jsonb(p_photo));
  end if;
  return clean || jsonb_build_object('photos', coalesce(paths, array_remove(array[clean->>'photo'], null)));
end $$;

create or replace function public.approval_clean_item_with_photos(p_type text, p_payload jsonb, p_photo text, p_photos jsonb)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  select case
    when p_type = 'gbp_post' then public.gbp_approval_clean_post(p_payload, p_photo, p_photos)
    when p_photos is null then public.approval_clean_item(p_type, p_payload, p_photo)
  end;
$$;

-- A legacy revision can still replace its primary photo. Preserve the rest.
create or replace function public.approval_replace_primary_photo(p_photo text, p_paths text[])
returns text[] language sql immutable set search_path = pg_catalog, public as $$
  select array_remove(array[p_photo] || p_paths[2:], null);
$$;


create or replace function public.approval_version_scope() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare t text; pk text; img jsonb; path text; s jsonb; b jsonb; sections text[] := '{}'; blocks text[] := '{}';
begin
 if tg_op <> 'INSERT' then
   -- Draft item removal cascades to its immutable versions; standalone deletes stay forbidden.
   if tg_op = 'DELETE' and pg_trigger_depth()>1 and not exists (select 1 from public.approval_items where id=old.item_id) then return old; end if;
   raise exception 'approval item versions are immutable' using errcode = '42501';
 end if;
 select item_type,page_kind into t,pk from public.approval_items where id=new.item_id and request_id=new.request_id and organization_id=new.organization_id;
 if t is null or (new.payload->>'schemaVersion') is distinct from new.schema_version::text
 or public.approval_clean_item(t,new.payload,new.photo_path) is null
 or pg_column_size(new.payload) > (case when t='page' then 1048576 else 16384 end)
 or (t='page' and new.payload->>'pageKind' is distinct from pk) then raise exception 'invalid version payload or scope' using errcode = '23514'; end if;
 -- Omitted arrays still work for single-photo callers and page mockups.
 new.photo_paths := coalesce(new.photo_paths, array_remove(array[new.photo_path], null));
 if new.photo_path is distinct from new.photo_paths[1]
   or (t='gbp_post' and new.photo_paths is distinct from public.approval_photo_paths(to_jsonb(new.photo_paths)))
   or (t='page' and new.photo_paths is distinct from array_remove(array[new.photo_path], null))
 then raise exception 'invalid photo paths' using errcode='23514'; end if;
 foreach path in array new.photo_paths loop
   if path like 'approval-assets/%' and not exists (select 1 from public.approval_assets
     where object_key=path and request_id=new.request_id and organization_id=new.organization_id
       and (item_id is null or item_id=new.item_id))
   then raise exception 'asset outside request' using errcode='23514'; end if;
   if t='gbp_post' and path like 'gbp-approvals/%' and path not like 'gbp-approvals/' || new.request_id::text || '/%'
   then raise exception 'image outside request' using errcode='23514'; end if;
 end loop;
 if t='page' then
   if new.photo_path like 'gbp-approvals/%' and not public.approval_replacement_key(new.photo_path,new.request_id) then raise exception 'image outside request' using errcode='23514'; end if;
   for img in select * from jsonb_path_query(new.payload->'body','strict $.** ? (@.type == "image")') loop
     if coalesce(img#>>'{attrs,src}','') !~ '^https://\S+$' and not exists (select 1 from public.approval_assets where object_key=img#>>'{attrs,src}' and request_id=new.request_id and organization_id=new.organization_id and (item_id is null or item_id=new.item_id)) and not public.approval_replacement_key(img#>>'{attrs,src}',new.request_id) then raise exception 'image outside request' using errcode='23514'; end if;
   end loop;
   new.body_hash := encode(sha256(convert_to(public.approval_canonical_json(new.payload->'body'),'UTF8')),'hex');
   for s in select value from jsonb_array_elements(coalesce(new.outline,'[]')) loop
     if jsonb_typeof(s) <> 'object' or coalesce(s->>'sectionId','') !~ '^[A-Za-z0-9._:-]{1,80}$' or (s->>'sectionId')=any(sections)
     or jsonb_typeof(s->'blocks') is distinct from 'array' or coalesce(s->>'hash','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid outline' using errcode='23514'; end if;
     sections := sections || (s->>'sectionId');
     for b in select value from jsonb_array_elements(s->'blocks') loop
       if coalesce(b->>'blockId','') !~ '^[A-Za-z0-9._:-]{1,80}$' or (b->>'blockId')=any(blocks)
       or jsonb_typeof(b->'len') is distinct from 'number' or coalesce(b->>'len','') !~ '^(0|[1-9][0-9]*)$'
       or (b->>'len')::numeric > 2147483647
       or coalesce(b->>'kind','') not in ('heading','paragraph','list','table','image','quote') or coalesce(b->>'hash','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid outline block' using errcode='23514'; end if;
       blocks := blocks || (b->>'blockId');
     end loop;
   end loop;
 elsif new.outline is not null or new.body_hash is not null then raise exception 'GBP outline not allowed' using errcode='23514'; end if;
 return new;
end $$;

create or replace function public.create_approval_request(
  p_actor uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_task_id uuid,
  p_item_type text,
  p_title text,
  p_due_at timestamptz,
  p_questions jsonb,
  p_items jsonb,
  p_created_via text default 'app',
  p_bot_key_id uuid default null,
  p_idempotency_key text default null,
  p_request_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_request_id uuid;
  v_item jsonb;
  v_question jsonb;
  v_clean jsonb;
  v_item_id uuid;
  v_version_id uuid;
  v_paths text[];
  v_count integer := 0;
  v_qcount integer := 0;
  v_position integer;
  v_seen integer[] := '{}';
  v_prompt text;
  v_item_position integer;
  v_question_item uuid;
  v_existing public.approval_requests%rowtype;
begin
  if p_actor is null or not public.gbp_approval_writer(p_actor, p_organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;
  if p_idempotency_key is not null then
    -- Serialize retries before inspecting or creating the org-scoped key.
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_idempotency_key, 0));
    select * into v_existing from public.approval_requests
      where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.request_hash is distinct from p_request_hash then
        return public.gbp_approval_fail('idempotency_conflict');
      end if;
      return jsonb_build_object('ok', true, 'requestId', v_existing.id, 'round', v_existing.round);
    end if;
  end if;
  if coalesce(p_item_type,'') not in ('gbp_post','page') or coalesce(p_created_via,'') not in ('app','bot') then return public.gbp_approval_fail('invalid_request'); end if;
  if p_bot_key_id is not null and not exists (select 1 from public.bot_api_keys where id=p_bot_key_id and organization_id=p_organization_id) then return public.gbp_approval_fail('forbidden'); end if;
  if p_title is null or char_length(btrim(p_title)) < 1 or char_length(btrim(p_title)) > 200 then
    return public.gbp_approval_fail('invalid_request');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return public.gbp_approval_fail('invalid_request');
  end if;
  if p_questions is null then
    p_questions := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) > 20 then
    return public.gbp_approval_fail('invalid_request');
  end if;

  insert into public.approval_requests (
    organization_id, client_id, task_id, title, due_at, created_by, idempotency_key, request_hash, item_type, created_via, owner_id, bot_key_id
  ) values (
    p_organization_id, p_client_id, p_task_id, btrim(p_title), p_due_at, p_actor, p_idempotency_key, p_request_hash, p_item_type, p_created_via, case when p_created_via='app' then p_actor end, p_bot_key_id
  ) returning id into v_request_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    if (v_item ? 'itemType' and v_item->>'itemType' is distinct from p_item_type) or (v_item ? 'item_type' and v_item->>'item_type' is distinct from p_item_type) then raise exception 'invalid_request' using errcode='P0001'; end if;
    v_position := (v_item->>'position')::integer;
    if v_position is null or v_position < 1 or v_position = any(v_seen) then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_position;
    v_clean := public.approval_clean_item_with_photos(p_item_type,v_item->'payload',v_item->>'photoPath',v_item->'photoPaths');
    if v_clean is null then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_paths := public.approval_photo_paths(v_clean->'photos');
    if v_clean->>'photo' like 'gbp-approvals/%'
       or exists (select 1 from unnest(v_paths) path where path like 'gbp-approvals/%') then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    insert into public.approval_items (
      organization_id, request_id, item_type, position, status, page_kind
    ) values (
      p_organization_id, v_request_id, p_item_type, v_position, 'pending', case when p_item_type='page' then v_item#>>'{payload,pageKind}' end
    ) returning id into v_item_id;
    insert into public.approval_item_versions (
      organization_id, request_id, item_id, version_no, schema_version,
      payload, photo_path, photo_paths, source, created_by, outline, source_ref
    ) values (
      p_organization_id, v_request_id, v_item_id, 1, 1,
      v_clean->'payload', nullif(v_clean->>'photo', ''), v_paths, 'create', p_actor, v_item->'outline', v_item->'sourceRef'
    ) returning id into v_version_id;
    update public.approval_items
      set current_version_id = v_version_id
      where id = v_item_id;
  end loop;

  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    v_qcount := v_qcount + 1;
    v_prompt := btrim(coalesce(v_question->>'prompt', ''));
    if char_length(v_prompt) < 1 or char_length(v_prompt) > 500 then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_question_item := null;
    if nullif(v_question->>'itemPosition', '') is not null then
      v_item_position := (v_question->>'itemPosition')::integer;
      select id into v_question_item
      from public.approval_items
      where request_id = v_request_id and position = v_item_position;
      if v_question_item is null then
        raise exception 'invalid_request' using errcode = 'P0001';
      end if;
    end if;
    insert into public.approval_questions (
      organization_id, request_id, item_id, position, prompt
    ) values (
      p_organization_id, v_request_id, v_question_item, v_qcount, v_prompt
    );
  end loop;

  insert into public.approval_events(organization_id,request_id,actor_id,kind) values(p_organization_id,v_request_id,p_actor,'request_created');
  if p_created_via='bot' then
    insert into public.notifications(organization_id,user_id,type,title,body,entity_type,entity_id,client_id)
    select p_organization_id,uid,'approval_draft_ready','Approval draft ready',p_title,'approval_request',v_request_id::text,p_client_id
    from (select unnest(assignee_ids) uid from public.tasks where id=p_task_id
      union select user_id from public.organization_members where organization_id=p_organization_id and role='owner'
      and not exists(select 1 from public.tasks where id=p_task_id and cardinality(assignee_ids)>0)) recipients;
  end if;
  return jsonb_build_object('ok', true, 'requestId', v_request_id, 'round', 1);
exception
  when sqlstate 'P0001' then
    return public.gbp_approval_fail(sqlerrm);
  when invalid_text_representation or numeric_value_out_of_range or check_violation then
    return public.gbp_approval_fail('invalid_request');
end;
$fn$;

create or replace function public.post_approval_version(
  p_actor uuid,
  p_request_id uuid,
  p_items jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_request public.approval_requests%rowtype;
  v_entry jsonb;
  v_item public.approval_items%rowtype;
  v_current public.approval_item_versions%rowtype;
  v_clean jsonb;
  v_paths text[];
  v_note text;
  v_source text;
  v_source_response uuid;
  v_changed boolean;
  v_any_changed boolean := false;
  v_version_id uuid;
  v_status text;
  v_locked_at timestamptz;
  v_lock_reason text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return public.gbp_approval_fail('invalid_request');
  end if;
  select * into v_request from public.approval_requests where id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if not public.gbp_approval_writer(p_actor, v_request.organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;

  for v_entry in select value from jsonb_array_elements(p_items)
  loop
    select * into v_item
    from public.approval_items
    where id = (v_entry->>'itemId')::uuid and request_id = p_request_id
    for update;
    if not found then
      raise exception 'out_of_scope' using errcode = 'P0001';
    end if;
    if (v_entry ? 'itemType' and v_entry->>'itemType' is distinct from v_item.item_type) then raise exception 'invalid_request' using errcode='P0001'; end if;
    select * into v_current from public.approval_item_versions where id = v_item.current_version_id;
    if v_entry ? 'expectedVersionId' and v_entry->>'expectedVersionId' is distinct from v_current.id::text then
      raise exception 'conflict' using errcode = 'P0001';
    end if;
    v_clean := public.approval_clean_item_with_photos(v_request.item_type,v_entry->'payload',v_entry->>'photoPath',v_entry->'photoPaths');
    if v_clean is null then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_paths := case when v_request.item_type <> 'gbp_post' then null
      when v_entry ? 'photoPaths' then public.approval_photo_paths(v_clean->'photos')
      when not (v_entry ? 'photoPath') and cardinality(v_current.photo_paths) > 1 then v_current.photo_paths
      else public.approval_replace_primary_photo(v_clean->>'photo', v_current.photo_paths)
    end;
    if v_clean->>'photo' like 'gbp-approvals/%' and v_clean->>'photo' not like 'gbp-approvals/' || p_request_id::text || '/%'
       or exists (select 1 from unnest(v_paths) path
          where path like 'gbp-approvals/%' and path not like 'gbp-approvals/' || p_request_id::text || '/%') then
      raise exception 'out_of_scope' using errcode = 'P0001';
    end if;
    v_note := nullif(btrim(coalesce(v_entry->>'changeNote', '')), '');
    v_source := coalesce(v_entry->>'source', 'manual');
    if v_source not in ('manual', 'accepted_suggestion', 'import') then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_source_response := nullif(v_entry->>'sourceResponseId', '')::uuid;
    if v_source = 'accepted_suggestion' and not exists (
      select 1 from public.approval_responses
      where id = v_source_response and item_id = v_item.id and request_id = p_request_id
    ) then
      raise exception 'out_of_scope' using errcode = 'P0001';
    end if;
    v_changed := public.approval_visible(v_request.item_type,v_current.payload, v_current.photo_path)
      is distinct from public.approval_visible(v_request.item_type,v_clean->'payload',
        case when v_request.item_type='gbp_post' then v_paths[1] else v_clean->>'photo' end)
      or (v_request.item_type='gbp_post' and v_current.photo_paths is distinct from v_paths);
    if v_changed and v_note is null and v_request.stage='sent' then
      raise exception 'change_note_required' using errcode = 'P0001';
    end if;
    if char_length(coalesce(v_note, '')) > 500 then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    if v_request.item_type='page' then
      update public.approval_items set page_kind=v_clean#>>'{payload,pageKind}' where id=v_item.id;
    end if;
    insert into public.approval_item_versions (
      organization_id, request_id, item_id, version_no, schema_version,
      payload, photo_path, photo_paths, change_note, source, source_response_id, created_by, outline, source_ref
    ) values (
      v_request.organization_id, p_request_id, v_item.id, v_current.version_no + 1, 1,
      v_clean->'payload', case when v_request.item_type='gbp_post' then v_paths[1] else nullif(v_clean->>'photo', '') end, v_paths, v_note, v_source, v_source_response, p_actor, v_entry->'outline', v_entry->'sourceRef'
    ) returning id into v_version_id;
    if v_request.stage='draft' then
      update public.approval_items set current_version_id=v_version_id where id=v_item.id;
      v_any_changed := v_any_changed or v_changed;
      continue;
    end if;
    if v_changed then
      v_status := 'pending';
      v_locked_at := null;
      v_lock_reason := null;
      v_any_changed := true;
    else
      v_status := v_item.status;
      if v_item.status in ('approved', 'changes_requested') then
        v_locked_at := p_now;
        v_lock_reason := 'agency_version';
      else
        v_locked_at := v_item.decision_locked_at;
        v_lock_reason := v_item.decision_lock_reason;
      end if;
    end if;
    update public.approval_items
      set current_version_id = v_version_id,
          previous_released_version_id = released_version_id, released_version_id = v_version_id,
          status = v_status,
          decision_locked_at = v_locked_at,
          decision_lock_reason = v_lock_reason
      where id = v_item.id;
  end loop;

  update public.approval_requests
    set round = case when v_any_changed and stage='sent' then round + 1 else round end,
        updated_at = p_now
    where id = p_request_id;

  return jsonb_build_object('ok', true, 'changed', v_any_changed);
exception
  when sqlstate 'P0001' then
    return public.gbp_approval_fail(sqlerrm);
  when invalid_text_representation or check_violation then
    return public.gbp_approval_fail('invalid_request');
end;
$fn$;

create or replace function public.update_approval_draft(p_actor uuid,p_request_id uuid,p_patch jsonb,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.approval_requests%rowtype; e jsonb; q jsonb; clean jsonb; iid uuid; vid uuid; pos integer; n integer; result jsonb; ids uuid[]; qid uuid;
begin
 select * into r from public.approval_requests where id=p_request_id for update;
 if not found then return public.gbp_approval_fail('not_found'); end if;
 if not public.gbp_approval_writer(p_actor,r.organization_id) then return public.gbp_approval_fail('forbidden'); end if;
 if r.stage<>'draft' or r.archived_at is not null then return public.gbp_approval_fail('not_draft'); end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_patch) k where k not in ('title','dueAt','questions','items','removeItemIds','itemOrder')) then return public.gbp_approval_fail('invalid_request'); end if;
 if p_patch ? 'title' then update public.approval_requests set title=p_patch->>'title' where id=r.id; end if;
 if p_patch ? 'dueAt' then update public.approval_requests set due_at=(p_patch->>'dueAt')::timestamptz where id=r.id; end if;
 for e in select value from jsonb_array_elements(coalesce(p_patch->'removeItemIds','[]')) loop
   iid := (e#>>'{}')::uuid;
   if not exists(select 1 from public.approval_items where id=iid and request_id=r.id) then raise exception 'out_of_scope' using errcode='P0001'; end if;
   delete from public.approval_items where id=iid;
 end loop;
 for e in select value from jsonb_array_elements(coalesce(p_patch->'items','[]')) loop
   if e ? 'itemType' and e->>'itemType' is distinct from r.item_type then raise exception 'invalid_request' using errcode='P0001'; end if;
   if e ? 'itemId' then
     result := public.post_approval_version(p_actor,r.id,jsonb_build_array(e),p_now);
     if result->>'ok'<>'true' then raise exception '%',result->>'code' using errcode='P0001'; end if;
   else
     clean := public.approval_clean_item_with_photos(r.item_type,e->'payload',e->>'photoPath',e->'photoPaths');
     if clean is null then raise exception 'invalid_request' using errcode='P0001'; end if;
     select coalesce(max(position),0)+1 into pos from public.approval_items where request_id=r.id;
     insert into public.approval_items(organization_id,request_id,item_type,page_kind,position)
     values(r.organization_id,r.id,r.item_type,case when r.item_type='page' then e#>>'{payload,pageKind}' end,coalesce((e->>'position')::integer,pos)) returning id into iid;
     insert into public.approval_item_versions(organization_id,request_id,item_id,version_no,schema_version,payload,photo_path,photo_paths,source,created_by,outline,source_ref)
     values(r.organization_id,r.id,iid,1,1,clean->'payload',clean->>'photo',public.approval_photo_paths(clean->'photos'),'create',p_actor,e->'outline',e->'sourceRef') returning id into vid;
     update public.approval_items set current_version_id=vid where id=iid;
   end if;
 end loop;
 if p_patch ? 'itemOrder' then
   select array_agg((value#>>'{}')::uuid order by ord) into ids from jsonb_array_elements(p_patch->'itemOrder') with ordinality x(value,ord);
   select count(*) into n from public.approval_items where request_id=r.id;
   if coalesce(cardinality(ids),0)<>n or (select count(distinct id) from unnest(ids) id)<>n
   or exists(select 1 from unnest(ids) id where not exists(select 1 from public.approval_items i where i.id=id and i.request_id=r.id)) then raise exception 'out_of_scope' using errcode='P0001'; end if;
   -- Two passes keep the existing immediate unique constraint satisfied.
   select coalesce(max(position),0)+1 into pos from public.approval_items where request_id=r.id;
   for n in 1..coalesce(cardinality(ids),0) loop update public.approval_items set position=pos+n where id=ids[n]; end loop;
   for n in 1..coalesce(cardinality(ids),0) loop update public.approval_items set position=n where id=ids[n]; end loop;
 end if;
 if p_patch ? 'questions' then
   if jsonb_typeof(p_patch->'questions')<>'array' or jsonb_array_length(p_patch->'questions')>20 then raise exception 'invalid_request' using errcode='P0001'; end if;
   delete from public.approval_questions where request_id=r.id;
   n := 0;
   for q in select value from jsonb_array_elements(p_patch->'questions') loop
     n := n+1; qid := null;
     if q ? 'itemPosition' then
       select id into qid from public.approval_items where request_id=r.id and position=(q->>'itemPosition')::integer;
       if qid is null then raise exception 'out_of_scope' using errcode='P0001'; end if;
     end if;
     insert into public.approval_questions(organization_id,request_id,item_id,position,prompt) values(r.organization_id,r.id,qid,n,q->>'prompt');
   end loop;
 end if;
 update public.approval_requests set updated_at=p_now where id=r.id;
 insert into public.approval_events(organization_id,request_id,actor_id,kind,created_at) values(r.organization_id,r.id,p_actor,'draft_edited',p_now);
 return jsonb_build_object('ok',true);
exception when sqlstate 'P0001' then return public.gbp_approval_fail(sqlerrm);
 when check_violation or not_null_violation or invalid_text_representation or unique_violation or datetime_field_overflow then return public.gbp_approval_fail('invalid_request');
end $$;

create or replace function public.accept_approval_suggestion(p_actor uuid,p_comment_id uuid,p_payload jsonb,p_photo text,p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare c public.approval_comments%rowtype; i public.approval_items%rowtype; v public.approval_item_versions%rowtype; clean jsonb; vid uuid;
begin
 select * into c from public.approval_comments where id=p_comment_id;
 if not found then return public.gbp_approval_fail('not_found'); end if;
 perform 1 from public.approval_requests where id=c.request_id for update;
 select * into c from public.approval_comments where id=p_comment_id for update;
 if not public.gbp_approval_writer(p_actor,c.organization_id) or exists(select 1 from public.approval_bot_actors where user_id=p_actor) then return public.gbp_approval_fail('forbidden'); end if;
 if c.suggestion_status is distinct from 'pending' then return public.gbp_approval_fail('invalid_request'); end if;
 select * into i from public.approval_items where id=c.item_id for update;
 select * into v from public.approval_item_versions where id=i.current_version_id;
 clean := public.approval_clean_item(i.item_type,p_payload,p_photo);
 if clean is null then return public.gbp_approval_fail('invalid_request'); end if;
 insert into public.approval_item_versions(organization_id,request_id,item_id,version_no,schema_version,payload,photo_path,photo_paths,source,created_by,outline,change_note)
 values(c.organization_id,c.request_id,c.item_id,v.version_no+1,1,clean->'payload',case when i.item_type='gbp_post' then coalesce(clean->>'photo', v.photo_paths[2]) else clean->>'photo' end,
   case when i.item_type='gbp_post' then public.approval_replace_primary_photo(clean->>'photo',v.photo_paths) end,'accepted_suggestion',p_actor,v.outline,'Accepted suggestion') returning id into vid;
 update public.approval_items set current_version_id=vid where id=i.id;
 update public.approval_comments set suggestion_status='accepted',suggestion_decided_at=p_now,suggestion_decided_by=p_actor,
 resolved_at=p_now,resolved_by=p_actor,resolved_in_version_id=vid where id=c.id;
 insert into public.approval_events(organization_id,request_id,item_id,kind,actor_id,created_at) values(c.organization_id,c.request_id,c.item_id,'suggestion_accepted',p_actor,p_now);
 return jsonb_build_object('ok',true,'versionId',vid);
exception when check_violation or not_null_violation then return public.gbp_approval_fail('invalid_request');
end $$;

create or replace function public.accept_approval_suggestion(p_actor uuid,p_comment_id uuid,p_payload jsonb,p_photo text,p_now timestamptz,p_outline jsonb,p_expected_version_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare c public.approval_comments%rowtype; i public.approval_items%rowtype; v public.approval_item_versions%rowtype; clean jsonb; vid uuid;
begin
 select * into c from public.approval_comments where id=p_comment_id;
 if not found then return public.gbp_approval_fail('not_found'); end if;
 perform 1 from public.approval_requests where id=c.request_id for update;
 select * into c from public.approval_comments where id=p_comment_id for update;
 if not public.gbp_approval_writer(p_actor,c.organization_id) or exists(select 1 from public.approval_bot_actors where user_id=p_actor) then return public.gbp_approval_fail('forbidden'); end if;
 if c.suggestion_status is distinct from 'pending' then return public.gbp_approval_fail('invalid_request'); end if;
 select * into i from public.approval_items where id=c.item_id for update;
 if i.current_version_id is distinct from p_expected_version_id then return public.gbp_approval_fail('conflict'); end if;
 select * into v from public.approval_item_versions where id=i.current_version_id;
 clean := public.approval_clean_item(i.item_type,p_payload,p_photo);
 if clean is null then return public.gbp_approval_fail('invalid_request'); end if;
 insert into public.approval_item_versions(organization_id,request_id,item_id,version_no,schema_version,payload,photo_path,photo_paths,source,created_by,outline,change_note)
 values(c.organization_id,c.request_id,c.item_id,v.version_no+1,1,clean->'payload',case when i.item_type='gbp_post' then coalesce(clean->>'photo', v.photo_paths[2]) else clean->>'photo' end,
   case when i.item_type='gbp_post' then public.approval_replace_primary_photo(clean->>'photo',v.photo_paths) end,'accepted_suggestion',p_actor,p_outline,'Accepted suggestion') returning id into vid;
 update public.approval_items set current_version_id=vid where id=i.id;
 update public.approval_comments set suggestion_status='accepted',suggestion_decided_at=p_now,suggestion_decided_by=p_actor,
 resolved_at=p_now,resolved_by=p_actor,resolved_in_version_id=vid where id=c.id;
 insert into public.approval_events(organization_id,request_id,item_id,kind,actor_id,created_at) values(c.organization_id,c.request_id,c.item_id,'suggestion_accepted',p_actor,p_now);
 return jsonb_build_object('ok',true,'versionId',vid);
exception when check_violation or not_null_violation then return public.gbp_approval_fail('invalid_request');
end $$;

create or replace function public.release_approval_revision(p_actor uuid,p_request_id uuid,p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.approval_requests%rowtype; i public.approval_items%rowtype; changed boolean;
begin
 select * into r from public.approval_requests where id=p_request_id for update;
 if not found then return public.gbp_approval_fail('not_found'); end if;
 if not public.gbp_approval_writer(p_actor,r.organization_id) or exists(select 1 from public.approval_bot_actors where user_id=p_actor) then return public.gbp_approval_fail('forbidden'); end if;
 if r.stage<>'sent' or r.archived_at is not null then return public.gbp_approval_fail('invalid_request'); end if;
 if not exists(select 1 from public.approval_items where request_id=r.id and current_version_id<>released_version_id) then return public.gbp_approval_fail('nothing_to_release'); end if;
 for i in select * from public.approval_items where request_id=r.id and current_version_id<>released_version_id for update loop
 select public.approval_visible(i.item_type,a.payload,a.photo_path) is distinct from public.approval_visible(i.item_type,b.payload,b.photo_path)
   or (i.item_type='gbp_post' and a.photo_paths is distinct from b.photo_paths) into changed
 from public.approval_item_versions a,public.approval_item_versions b where a.id=i.current_version_id and b.id=i.released_version_id;
 update public.approval_items set previous_released_version_id=released_version_id,released_version_id=current_version_id,
 status=case when changed then 'pending' else status end,
 decision_locked_at=case when changed then null when status in ('approved','changes_requested') then p_now else decision_locked_at end,
 decision_lock_reason=case when changed then null when status in ('approved','changes_requested') then 'agency_version' else decision_lock_reason end where id=i.id;
 end loop;
 update public.approval_requests set round=round+1,updated_at=p_now where id=r.id;
 insert into public.approval_events(organization_id,request_id,kind,actor_id,created_at) values(r.organization_id,r.id,'revision_released',p_actor,p_now);
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.purge_gbp_approval_retention(p_now timestamptz, p_removed_keys text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ips integer;
  v_orphans integer;
  v_hits integer;
  v_keys text[];
  v_assets text[];
  v_deleted integer;
begin
  perform set_config('gbp_approval.purge', 'on', true);
  update public.approval_submissions
    set ip_hash = null
    where ip_hash is not null
      and created_at < p_now - interval '12 months';
  get diagnostics v_ips = row_count;
  select coalesce(array_agg(k), '{}'::text[]) into v_keys
 from public.approval_upload_reservations u cross join lateral unnest(array[u.object_key,u.preview_key]) k
 where k is not null and ((u.status='reserved' and u.expires_at<=p_now and u.created_at<p_now-case when u.purpose='image_replacement' then interval '48 hours' else interval '24 hours' end)
 or (u.status='attached' and exists(select 1 from public.approval_requests r where r.id=u.request_id and r.created_at<p_now-interval '12 months')));
  select coalesce(array_agg(a.object_key),'{}') into v_assets from public.approval_assets a
  where a.created_at < p_now-interval '7 days' and not exists(select 1 from public.approval_item_versions v
    where a.object_key=any(v.photo_paths) or v.payload::text like '%' || a.object_key || '%');
  delete from public.approval_assets where object_key=any(v_assets) and object_key=any(p_removed_keys);
  get diagnostics v_deleted = row_count;
  v_keys := v_keys || v_assets;
  -- The caller removes these objects through Storage before acknowledging keys.
  delete from public.approval_upload_reservations
    where object_key=any(v_keys) and object_key=any(p_removed_keys) and (preview_key is null or preview_key=any(p_removed_keys));
  get diagnostics v_orphans = row_count;
  delete from public.approval_public_hits
    where created_at < p_now - interval '48 hours';
  get diagnostics v_hits = row_count;
  return jsonb_build_object('ok', true, 'ipHashesCleared', v_ips, 'orphansDeleted', v_orphans+v_deleted, 'objectKeys', to_jsonb(v_keys), 'hitsDeleted', v_hits);
end;
$fn$;

create or replace function public.get_gbp_approval_by_token(
  p_token_hash text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link public.approval_links%rowtype;
  v_request public.approval_requests%rowtype;
  v_client_name text;
  v_items jsonb;
  v_questions jsonb;
  v_approved integer;
  v_changes integer;
  v_pending integer;
  v_answered integer;
  v_question_count integer;
  v_had boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return public.gbp_approval_fail('not_found');
  end if;
  select * into v_link from public.approval_links where token_hash = p_token_hash;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  select * into v_request from public.approval_requests where id = v_link.request_id;
  select name into v_client_name from public.clients where id = v_request.client_id;
  v_had := exists (select 1 from public.approval_submissions where request_id = v_request.id);

  if v_link.revoked_at is not null or v_link.expires_at <= p_now then
    return jsonb_build_object(
      'ok', true,
      'state', case when v_link.revoked_at is not null then 'revoked' else 'expired' end,
      'title', v_request.title,
      'clientName', coalesce(v_client_name, 'your account'),
      'expiresAt', v_link.expires_at,
      'hadSubmission', v_had
    );
  end if;

  if public.gbp_approval_hit_count(p_token_hash, 'read', p_now) >= 120 then
    return public.gbp_approval_fail('rate_limited');
  end if;
  insert into public.approval_public_hits (token_hash, action, created_at)
  values (p_token_hash, 'read', p_now);
  update public.approval_links
    set view_count = view_count + 1, last_viewed_at = p_now
    where id = v_link.id;

  select coalesce(jsonb_agg(item_json order by position), '[]'::jsonb) into v_items
  from (
    select item.position,
      jsonb_build_object(
        'id', item.id,
        'position', item.position,
        'status', item.status,
        'locked', item.decision_locked_at is not null,
        'version', jsonb_build_object(
          'id', version.id,
          'versionNo', version.version_no,
          'payload', version.payload,
          'photoPath', version.photo_path,
          'photoPaths', version.photo_paths,
          'changeNote', version.change_note,
          'previous', (
            select jsonb_build_object(
              'versionNo', previous.version_no,
              'payload', previous.payload,
              'photoPath', previous.photo_path,
              'photoPaths', previous.photo_paths
            )
            from public.approval_item_versions as previous
            where previous.id = item.previous_released_version_id
          )
        ),
        'comments', coalesce((
          select jsonb_agg(jsonb_build_object('body', c.body, 'photoPosition', c.photo_position) order by c.created_at, c.id)
          from public.approval_comments c
          where item.item_type='gbp_post' and c.version_id=version.id and c.author_kind='client' and c.parent_id is null
        ), '[]'::jsonb),
        'decision', (
          select jsonb_build_object(
            'decision', response.decision,
            'comment', response.comment,
            'suggestedTitle', response.suggested_title,
            'suggestedBody', response.suggested_body,
            'replacementPhotoPath', response.replacement_photo_path
          )
          from public.approval_responses as response
          join public.approval_submissions as submission on submission.id = response.submission_id
          where response.item_id = item.id and response.version_id = version.id
          order by submission.created_at desc
          limit 1
        )
      ) as item_json
    from public.approval_items as item
    join public.approval_item_versions as version on version.id = item.released_version_id
    where item.request_id = v_request.id
  ) rows;

  select coalesce(jsonb_agg(question_json order by position), '[]'::jsonb) into v_questions
  from (
    select question.position,
      jsonb_build_object(
        'id', question.id,
        'prompt', question.prompt,
        'itemId', question.item_id,
        'answer', (
          select answer.answer
          from public.approval_question_answers as answer
          join public.approval_submissions as submission on submission.id = answer.submission_id
          where answer.question_id = question.id
          order by submission.created_at desc
          limit 1
        )
      ) as question_json
    from public.approval_questions as question
    where question.request_id = v_request.id
  ) rows;

  select count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'changes_requested'),
         count(*) filter (where status = 'pending')
    into v_approved, v_changes, v_pending
  from public.approval_items where request_id = v_request.id;
  select count(*) into v_question_count from public.approval_questions where request_id = v_request.id;
  select count(*) into v_answered
  from (
    select distinct on (answer.question_id) answer.answer
    from public.approval_question_answers as answer
    join public.approval_submissions as submission on submission.id = answer.submission_id
    where answer.request_id = v_request.id
    order by answer.question_id, submission.created_at desc
  ) latest
  where btrim(latest.answer) <> '';

  return jsonb_build_object(
    'ok', true,
    'state', 'active',
    'title', v_request.title,
    'clientName', coalesce(v_client_name, 'your account'),
    'dueAt', v_request.due_at,
    'round', v_request.round,
    'expiresAt', v_link.expires_at,
    'items', v_items,
    'questions', v_questions,
    'summary', jsonb_build_object(
      'approved', v_approved,
      'changesRequested', v_changes,
      'pending', v_pending,
      'questionsAnswered', v_answered,
      'questionsTotal', v_question_count
    )
  );
end;
$fn$;

create or replace function public.approval_comment_scope() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v public.approval_item_versions%rowtype;
begin
 if tg_op='INSERT' and (new.suggested_text is not null or new.suggested_image_key is not null) then new.suggestion_status := coalesce(new.suggestion_status,'pending'); end if;
 if tg_op='DELETE' then raise exception 'comments cannot be deleted' using errcode='42501'; end if;
 if tg_op='UPDATE' and (to_jsonb(new)-array['resolved_at','resolved_by','resolved_in_version_id','suggestion_status','suggestion_decided_at','suggestion_decided_by','suggestion_reply']) is distinct from (to_jsonb(old)-array['resolved_at','resolved_by','resolved_in_version_id','suggestion_status','suggestion_decided_at','suggestion_decided_by','suggestion_reply']) then raise exception 'comment is immutable' using errcode='42501'; end if;
 select ver.* into v from public.approval_item_versions ver join public.approval_items i on i.id=ver.item_id
 where ver.id=new.version_id and i.id=new.item_id and i.request_id=new.request_id and i.organization_id=new.organization_id and (i.item_type='page' or new.anchor_kind='page')
 and ver.request_id=new.request_id and ver.organization_id=new.organization_id;
 if not found then raise exception 'comment outside request' using errcode='23514'; end if;
 if new.photo_position is not null and (new.photo_position < 1 or new.photo_position > cardinality(v.photo_paths)
   or new.anchor_kind <> 'page' or new.parent_id is not null or not exists (
     select 1 from public.approval_items where id=v.item_id and item_type='gbp_post'
   )) then raise exception 'invalid photo position' using errcode='23514'; end if;
 if tg_op='INSERT' and new.author_kind='client' and not exists(select 1 from public.approval_items where id=new.item_id and released_version_id=new.version_id) then raise exception 'comment version is not released' using errcode='23514'; end if;
 if new.submission_id is not null and not exists (select 1 from public.approval_submissions where id=new.submission_id and request_id=new.request_id and organization_id=new.organization_id) then raise exception 'submission outside request' using errcode='23514'; end if;
 if new.resolved_in_version_id is not null and not exists (select 1 from public.approval_item_versions where id=new.resolved_in_version_id and item_id=new.item_id) then raise exception 'resolution outside item' using errcode='23514'; end if;
 if new.parent_id is not null then
   if not exists (select 1 from public.approval_comments where id=new.parent_id and parent_id is null and request_id=new.request_id and item_id=new.item_id and version_id=new.version_id and organization_id=new.organization_id) then raise exception 'invalid reply parent' using errcode='23514'; end if;
 elsif new.anchor_kind='highlight' or (new.anchor_kind='pin' and new.pin_target='block') then
   if not exists (select 1 from jsonb_array_elements(v.outline) s, jsonb_array_elements(s->'blocks') b
     where s->>'sectionId'=new.section_id and b->>'blockId'=new.block_id and b->>'hash'=new.target_hash
     and (new.suggested_image_key is null or b->>'kind'='image')
     and (new.anchor_kind<>'highlight' or new.range_end <= (b->>'len')::integer)) then raise exception 'invalid block anchor' using errcode='23514'; end if;
   if new.anchor_kind='highlight' and new.quote_hash is distinct from encode(sha256(convert_to(new.quote,'UTF8')),'hex') then raise exception 'invalid quote hash' using errcode='23514'; end if;
 elsif new.anchor_kind='pin' and new.pin_target='mockup' then
   if v.photo_path is null or new.target_hash is distinct from encode(sha256(convert_to(v.photo_path,'UTF8')),'hex') then raise exception 'invalid mockup anchor' using errcode='23514'; end if;
 end if;
 return new;
end $$;

create or replace function public.submit_approval(
  p_token_hash text,
  p_payload jsonb,
  p_ip_hash text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link public.approval_links%rowtype;
  v_request public.approval_requests%rowtype;
  v_existing public.approval_submissions%rowtype;
  v_key text;
  v_hash text;
  v_name text;
  v_email text;
  v_displayed uuid[];
  v_current uuid[];
  v_decision jsonb;
  v_answer jsonb;
  v_item public.approval_items%rowtype;
  v_prev public.approval_responses%rowtype;
  v_item_id uuid;
  v_version_id uuid;
  v_choice text;
  v_comment text;
  v_suggested_title text;
  v_suggested_body text;
  v_reservation_id uuid;
  v_reservation public.approval_upload_reservations%rowtype;
  v_seen uuid[] := '{}';
  v_verified uuid[];
  v_question_id uuid;
  v_answer_text text;
  v_submission_id uuid;
  v_response_id uuid;
  v_skip boolean;
  v_has_work boolean := false;
  v_has_answers boolean := false;
  v_approved integer;
  v_changes integer;
  v_pending integer;
  v_questions integer;
  v_answered integer;
  v_users uuid[];
  v_body text;
  v_advanced uuid;
  v_task_status text;
  v_task_due timestamptz;
  v_suggestion jsonb;
  v_c jsonb;
  v_k text;
  v_val jsonb;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload) <> 'object' then
    return public.gbp_approval_fail('not_found');
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    return public.gbp_approval_fail('invalid_request');
  end if;

  select * into v_link from public.approval_links where token_hash = p_token_hash;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  select * into v_request from public.approval_requests where id = v_link.request_id for update;
  select * into v_link from public.approval_links where id = v_link.id and token_hash = p_token_hash for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if v_link.revoked_at is not null then
    return public.gbp_approval_fail('revoked');
  end if;
  if v_link.expires_at <= p_now then
    return public.gbp_approval_fail('expired');
  end if;

  if v_request.item_type='gbp_post' then
    select jsonb_set(p_payload,'{decisions}',coalesce(jsonb_agg(d || jsonb_strip_nulls(jsonb_build_object(
      'suggestedTitle',coalesce(d->'suggestion'->'title',d->'suggestedTitle'),
      'suggestedBody',coalesce(d->'suggestion'->'body',d->'suggestedBody')))),'[]')) into p_payload
    from jsonb_array_elements(p_payload->'decisions') d;
  end if;
  v_key := p_payload->>'idempotencyKey';
  v_hash := p_payload->>'requestHash';
  if v_key is null or v_key !~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$' or v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    return public.gbp_approval_fail('invalid_request');
  end if;

  select * into v_existing
  from public.approval_submissions
  where link_id = v_link.id and idempotency_key = v_key;
  if found then
    if v_existing.request_hash = v_hash then
      return jsonb_build_object('ok', true, 'idempotent', true, 'submissionId', v_existing.id);
    end if;
    return public.gbp_approval_fail('idempotency_conflict');
  end if;

  if public.gbp_approval_hit_count(p_token_hash, 'submit', p_now) >= 10 then
    return public.gbp_approval_fail('rate_limited');
  end if;
  insert into public.approval_public_hits (token_hash, action, created_at)
  values (p_token_hash, 'submit', p_now);

  v_name := btrim(coalesce(p_payload->>'respondentName', ''));
  if v_name = '' then
    return public.gbp_approval_fail('name_required');
  end if;
  if char_length(v_name) > 120 or position(E'\n' in v_name) > 0 or position(E'\r' in v_name) > 0 then
    return public.gbp_approval_fail('invalid_request');
  end if;
  v_email := nullif(btrim(coalesce(p_payload->>'respondentEmail', '')), '');
  if v_email is not null and (
    char_length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    return public.gbp_approval_fail('invalid_request');
  end if;

  begin
    select coalesce(array_agg(distinct (value #>> '{}')::uuid order by (value #>> '{}')::uuid), '{}')
      into v_displayed
    from jsonb_array_elements(coalesce(p_payload->'displayedVersionIds', '[]'::jsonb));
    select coalesce(array_agg(distinct (value #>> '{}')::uuid), '{}')
      into v_verified
    from jsonb_array_elements(coalesce(p_payload->'verifiedReservationIds', '[]'::jsonb));
  exception
    when invalid_text_representation or datatype_mismatch then
      return public.gbp_approval_fail('invalid_request');
  end;

  select coalesce(array_agg(released_version_id order by released_version_id), '{}')
    into v_current
  from public.approval_items
  where request_id = v_request.id and released_version_id is not null;
  if v_displayed is distinct from v_current then
    return public.gbp_approval_fail('refresh_required');
  end if;

  if jsonb_typeof(p_payload->'decisions') is distinct from 'array'
     or jsonb_typeof(coalesce(p_payload->'answers', '[]'::jsonb)) is distinct from 'array' then
    return public.gbp_approval_fail('invalid_request');
  end if;

  if jsonb_typeof(coalesce(p_payload->'comments','[]')) is distinct from 'array' or jsonb_array_length(coalesce(p_payload->'comments','[]'))>100 then return public.gbp_approval_fail('invalid_request'); end if;
  for v_c in select value from jsonb_array_elements(coalesce(p_payload->'comments','[]')) loop
    if jsonb_typeof(v_c) is distinct from 'object' then return public.gbp_approval_fail('invalid_request'); end if;
    if exists (select 1 from jsonb_object_keys(v_c) k where k <> all(array['itemId','versionId','anchorKind','pinTarget','sectionId','blockId','targetHash','rangeStart','rangeEnd','quote','quotePrefix','quoteSuffix','body','suggestedText','suggestedImageReservationId','photoPosition']))
      or exists (select 1 from jsonb_each(v_c) e where case when e.key in ('rangeStart','rangeEnd') then
        jsonb_typeof(e.value) is distinct from 'number' or (e.value#>>'{}') !~ '^(0|[1-9][0-9]*)$'
        when e.key = 'photoPosition' then e.value <> 'null'::jsonb and
          (jsonb_typeof(e.value) is distinct from 'number' or (e.value#>>'{}') !~ '^([1-9]|10)$')
        else jsonb_typeof(e.value) is distinct from 'string' and not (e.key='body' and e.value='null'::jsonb and v_c ? 'suggestedImageReservationId') end)
      or coalesce(v_c->>'anchorKind','') not in ('highlight','pin','page')
      or (v_c ? 'photoPosition' and v_request.item_type<>'gbp_post')
      or (v_request.item_type='gbp_post' and (v_c->>'anchorKind'<>'page'
        or v_c ?| array['pinTarget','sectionId','blockId','targetHash','rangeStart','rangeEnd','quote','quotePrefix','quoteSuffix','suggestedText','suggestedImageReservationId']))
      then return public.gbp_approval_fail('invalid_request'); end if;
    if not exists(select 1 from public.approval_items where id=public.gbp_approval_uuid_or_null(v_c->>'itemId') and request_id=v_request.id and released_version_id=public.gbp_approval_uuid_or_null(v_c->>'versionId')) then return public.gbp_approval_fail('out_of_scope'); end if;
    if v_c->>'photoPosition' is not null and not exists (
      select 1 from public.approval_item_versions
      where id=(v_c->>'versionId')::uuid and cardinality(photo_paths)>=(v_c->>'photoPosition')::integer
    ) then return public.gbp_approval_fail('invalid_request'); end if;
    v_has_work := true;
  end loop;
  for v_decision in select value from jsonb_array_elements(p_payload->'decisions')
  loop
    v_has_work := true;
    v_item_id := public.gbp_approval_uuid_or_null(v_decision->>'itemId');
    v_version_id := public.gbp_approval_uuid_or_null(v_decision->>'versionId');
    if v_item_id is null or v_version_id is null then
      return public.gbp_approval_fail('invalid_request');
    end if;
    if v_item_id = any(v_seen) then
      return public.gbp_approval_fail('invalid_request');
    end if;
    v_seen := v_seen || v_item_id;
    select * into v_item from public.approval_items where id = v_item_id and request_id = v_request.id;
    if not found then
      return public.gbp_approval_fail('out_of_scope');
    end if;
    if v_item.released_version_id is distinct from v_version_id then
      return public.gbp_approval_fail('refresh_required');
    end if;
    v_choice := v_decision->>'decision';
    if v_choice not in ('approved', 'changes_requested') then
      return public.gbp_approval_fail('invalid_request');
    end if;
    v_comment := nullif(btrim(coalesce(v_decision->>'comment', '')), '');
    v_suggested_title := nullif(btrim(coalesce(v_decision->>'suggestedTitle', '')), '');
    v_suggested_body := nullif(regexp_replace(coalesce(v_decision->>'suggestedBody', ''), '^\s+|\s+$', '', 'g'), '');
    v_reservation_id := public.gbp_approval_uuid_or_null(nullif(v_decision->>'reservationId', ''));
    if v_request.item_type='gbp_post' and v_choice = 'approved' and (v_comment is not null or v_suggested_title is not null or v_suggested_body is not null or v_reservation_id is not null) then
      return public.gbp_approval_fail('invalid_request');
    end if;
    if v_choice = 'changes_requested' and ((v_request.item_type='gbp_post' and v_comment is null) or (v_request.item_type='page' and not exists (select 1 from jsonb_array_elements(coalesce(p_payload->'comments','[]')) c where c->>'itemId'=v_item.id::text))) then
      return public.gbp_approval_fail('comment_required');
    end if;
    if char_length(coalesce(v_comment, '')) > 4000
       or char_length(coalesce(v_suggested_title, '')) > 80
       or char_length(coalesce(v_suggested_body, '')) > 2000 then
      return public.gbp_approval_fail('invalid_request');
    end if;
    v_suggestion := v_decision->'suggestion';
    if v_request.item_type='page' and (v_suggested_title is not null or v_suggested_body is not null or v_reservation_id is not null) then return public.gbp_approval_fail('invalid_request'); end if;
    if v_suggestion is not null then
      if jsonb_typeof(v_suggestion)<>'object' or pg_column_size(v_suggestion)>8192 then return public.gbp_approval_fail('invalid_request'); end if;
      for v_k,v_val in select * from jsonb_each(v_suggestion) loop
        if jsonb_typeof(v_val)<>'string' or not(v_k=any(case when v_request.item_type='page' then array[]::text[] else array['title','body'] end)) then return public.gbp_approval_fail('invalid_request'); end if;
        if char_length(v_val#>>'{}')>(case v_k when 'body' then 2000 when 'metaDescription' then 320 when 'metaTitle' then 120 when 'slug' then 200 else case when v_request.item_type='page' then 200 else 80 end end)
        or (v_k<>'metaDescription' and char_length(v_val#>>'{}')=0)
        or (v_k='slug' and (v_val#>>'{}') !~ '^[a-z0-9]+(-[a-z0-9]+)*(/[a-z0-9]+(-[a-z0-9]+)*)*$') then return public.gbp_approval_fail('invalid_request'); end if;
      end loop;
    end if;
    if v_reservation_id is not null then
      if not (v_reservation_id = any(v_verified)) then
        return public.gbp_approval_fail('upload_not_verified');
      end if;
      select * into v_reservation
      from public.approval_upload_reservations
      where id = v_reservation_id
        and request_id = v_request.id
        and link_id = v_link.id
        and purpose = 'gbp_photo'
        and status = 'reserved'
        and expires_at > p_now
      for update;
      if not found or v_reservation.object_key is distinct from
         'gbp-approvals/' || v_request.id::text || '/' || v_reservation.id::text then
        return public.gbp_approval_fail('out_of_scope');
      end if;
    end if;
    if v_item.decision_locked_at is not null then
      select response.* into v_prev
      from public.approval_responses as response
      join public.approval_submissions as submission on submission.id = response.submission_id
      where response.item_id = v_item.id and response.version_id = v_item.released_version_id
      order by submission.created_at desc
      limit 1;
      if not found
         or v_prev.decision is distinct from v_choice
         or coalesce(v_prev.comment, '') is distinct from coalesce(v_comment, '')
         or coalesce(v_prev.suggested_title, '') is distinct from coalesce(v_suggested_title, '')
         or coalesce(v_prev.suggested_body, '') is distinct from coalesce(v_suggested_body, '')
         or coalesce(v_prev.suggestion,'{}') is distinct from coalesce(v_suggestion,'{}')
         or v_reservation_id is not null
      then
        return public.gbp_approval_fail('decision_locked');
      end if;
    end if;
  end loop;

  for v_answer in select value from jsonb_array_elements(coalesce(p_payload->'answers', '[]'::jsonb))
  loop
    v_answer_text := nullif(btrim(coalesce(v_answer->>'answer', '')), '');
    if v_answer_text is null then
      continue;
    end if;
    v_has_work := true;
    v_has_answers := true;
    if char_length(v_answer_text) > 2000 then
      return public.gbp_approval_fail('invalid_request');
    end if;
    v_question_id := public.gbp_approval_uuid_or_null(v_answer->>'questionId');
    if v_question_id is null then
      return public.gbp_approval_fail('invalid_request');
    end if;
    if not exists (
      select 1 from public.approval_questions
      where id = v_question_id and request_id = v_request.id
    ) then
      return public.gbp_approval_fail('out_of_scope');
    end if;
  end loop;

  if not v_has_work then
    return public.gbp_approval_fail('nothing_to_send');
  end if;

  select * into v_link from public.approval_links where id = v_link.id and token_hash = p_token_hash for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if v_link.revoked_at is not null then
    return public.gbp_approval_fail('revoked');
  end if;
  if v_link.expires_at <= p_now then
    return public.gbp_approval_fail('expired');
  end if;

  insert into public.approval_submissions (
    organization_id, request_id, link_id, idempotency_key, request_hash,
    respondent_name, respondent_email, ip_hash, created_at
  ) values (
    v_request.organization_id, v_request.id, v_link.id, v_key, v_hash,
    v_name, v_email, p_ip_hash, p_now
  ) returning id into v_submission_id;

  for v_decision in select value from jsonb_array_elements(p_payload->'decisions')
  loop
    v_item_id := (v_decision->>'itemId')::uuid;
    select * into v_item from public.approval_items where id = v_item_id for update;
    v_choice := v_decision->>'decision';
    v_comment := nullif(btrim(coalesce(v_decision->>'comment', '')), '');
    v_suggested_title := nullif(btrim(coalesce(v_decision->>'suggestedTitle', '')), '');
    v_suggested_body := nullif(regexp_replace(coalesce(v_decision->>'suggestedBody', ''), '^\s+|\s+$', '', 'g'), '');
    v_reservation_id := public.gbp_approval_uuid_or_null(nullif(v_decision->>'reservationId', ''));
    v_skip := v_item.decision_locked_at is not null;
    if v_skip then
      continue;
    end if;
    insert into public.approval_responses (
      organization_id, request_id, submission_id, item_id, version_id,
      decision, comment, suggested_title, suggested_body, replacement_photo_path, created_at, suggestion
    ) values (
      v_request.organization_id, v_request.id, v_submission_id, v_item.id, v_item.released_version_id,
      v_choice, v_comment, v_suggested_title, v_suggested_body,
      case when v_reservation_id is null then null
           else (select object_key from public.approval_upload_reservations where id = v_reservation_id)
      end,
      p_now, case when v_request.item_type='gbp_post' then jsonb_strip_nulls(jsonb_build_object('title',v_suggested_title,'body',v_suggested_body)) else v_decision->'suggestion' end
    ) returning id into v_response_id;
    if v_reservation_id is not null then
      update public.approval_upload_reservations
        set status = 'attached', response_id = v_response_id
        where id = v_reservation_id and status = 'reserved';
    end if;
    update public.approval_items
      set status = case when v_choice = 'approved' then 'approved' else 'changes_requested' end
      where id = v_item.id;
  end loop;

  for v_c in select value from jsonb_array_elements(coalesce(p_payload->'comments','[]')) loop
    v_reservation_id := null;
    if v_c ? 'suggestedImageReservationId' then
      v_reservation_id := public.gbp_approval_uuid_or_null(v_c->>'suggestedImageReservationId');
      select * into v_reservation from public.approval_upload_reservations where id=v_reservation_id
        and purpose='image_replacement' and request_id=v_request.id and item_id=(v_c->>'itemId')::uuid
        and version_id=(v_c->>'versionId')::uuid and status='reserved' and expires_at>p_now for update;
      if not found or not (v_reservation_id = any(v_verified)) or v_reservation.link_id<>v_link.id or v_reservation.preview_key is null then raise exception 'invalid image reservation' using errcode='23514'; end if;
      update public.approval_upload_reservations set status='attached', response_id=(select id from public.approval_responses where submission_id=v_submission_id and item_id=v_reservation.item_id limit 1) where id=v_reservation_id;
      update public.approval_comments set suggestion_status='superseded' where request_id=v_request.id
        and item_id=(v_c->>'itemId')::uuid and coalesce(block_id,'mockup')=coalesce(v_c->>'blockId','mockup')
        and suggestion_status='pending' and suggested_image_key is not null;
    end if;
    insert into public.approval_comments(organization_id,request_id,item_id,version_id,submission_id,author_kind,author_name,
      anchor_kind,pin_target,section_id,block_id,target_hash,range_start,range_end,body,suggested_text,suggested_image_key,quote,quote_hash,quote_prefix,quote_suffix,created_at,photo_position)
    values(v_request.organization_id,v_request.id,(v_c->>'itemId')::uuid,(v_c->>'versionId')::uuid,v_submission_id,'client',v_name,
      v_c->>'anchorKind',v_c->>'pinTarget',v_c->>'sectionId',v_c->>'blockId',v_c->>'targetHash',(v_c->>'rangeStart')::integer,(v_c->>'rangeEnd')::integer,v_c->>'body',v_c->>'suggestedText',case when v_reservation_id is not null then v_reservation.object_key end,v_c->>'quote',encode(sha256(convert_to(v_c->>'quote','UTF8')),'hex'),v_c->>'quotePrefix',v_c->>'quoteSuffix',p_now,(v_c->>'photoPosition')::integer);
  end loop;

  for v_answer in select value from jsonb_array_elements(coalesce(p_payload->'answers', '[]'::jsonb))
  loop
    v_answer_text := nullif(btrim(coalesce(v_answer->>'answer', '')), '');
    if v_answer_text is null then
      continue;
    end if;
    v_question_id := (v_answer->>'questionId')::uuid;
    insert into public.approval_question_answers (
      organization_id, request_id, submission_id, question_id, answer, created_at
    ) values (
      v_request.organization_id, v_request.id, v_submission_id, v_question_id, v_answer_text, p_now
    );
  end loop;

  select count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'changes_requested'),
         count(*) filter (where status = 'pending')
    into v_approved, v_changes, v_pending
  from public.approval_items
  where request_id = v_request.id;

  select count(*) into v_questions from public.approval_questions where request_id = v_request.id;
  select count(*) into v_answered
  from (
    select distinct on (answer.question_id) answer.answer
    from public.approval_question_answers as answer
    join public.approval_submissions as submission on submission.id = answer.submission_id
    where answer.request_id = v_request.id
    order by answer.question_id, submission.created_at desc
  ) latest
  where btrim(latest.answer) <> '';

  -- Comment-only GBP submissions just record feedback. Existing decisions and
  -- question answers retain their normal task and notification behavior.
  if v_request.item_type='gbp_post' and jsonb_array_length(p_payload->'decisions')=0
     and not v_has_answers then
    return jsonb_build_object('ok', true, 'idempotent', false, 'submissionId', v_submission_id,
      'summary', jsonb_build_object('approved',v_approved,'changesRequested',v_changes,'pending',v_pending,
        'questionsAnswered',v_answered,'questionsTotal',v_questions), 'taskAdvanced',false);
  end if;

  select status, due_date into v_task_status, v_task_due
  from public.tasks where id = v_request.task_id;
  v_advanced := null;
  if v_pending = 0 and v_changes = 0 and v_approved > 0 and v_task_status = 'todo' then
    update public.tasks
      set status = 'in_progress',
          status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'status', 'in_progress',
            'at', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'by', 'gbp-approval'
          ))
      where id = v_request.task_id and status = 'todo'
      returning id into v_advanced;
    if v_advanced is not null then
      insert into public.approval_events (organization_id, request_id, actor_id, kind, detail, created_at)
      values (
        v_request.organization_id, v_request.id, null, 'task_advanced',
        jsonb_build_object('from', 'todo', 'to', 'in_progress'), p_now
      );
    end if;
  end if;

  select coalesce(array_agg(distinct uid), '{}') into v_users
  from (
    select unnest(coalesce(task.assignee_ids, '{}'::uuid[])) as uid
    from public.tasks as task
    where task.id = v_request.task_id
    union
    select member.user_id
    from public.organization_members as member
    where member.organization_id = v_request.organization_id and member.role = 'owner'
  ) people
  where uid is not null;

  v_body := v_name || ' sent a review of ' || v_request.title || '. '
    || v_approved || ' approved, ' || v_changes || ' changes requested.';
  if v_advanced is not null then
    v_body := v_body || ' The task is now In Progress.';
  end if;
  insert into public.notifications (
    organization_id, user_id, type, title, body, entity_type, entity_id, client_id
  )
  select v_request.organization_id, uid, case when current_setting('approval.legacy_submit',true)='on' then 'gbp_approval_response' else 'approval_request_response' end,
         'A client sent a review', v_body, case when current_setting('approval.legacy_submit',true)='on' then 'gbp_approval_request' else 'approval_request' end, v_request.id::text, v_request.client_id
  from unnest(v_users) as uid;

  update public.approval_requests set updated_at = p_now where id = v_request.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'submissionId', v_submission_id,
    'summary', jsonb_build_object(
      'approved', v_approved,
      'changesRequested', v_changes,
      'pending', v_pending,
      'questionsAnswered', v_answered,
      'questionsTotal', v_questions
    ),
    'taskAdvanced', v_advanced is not null
  );
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation or unique_violation then
    return public.gbp_approval_fail('invalid_request');
end;
$fn$;

create or replace function public.get_approval_internal_review(p_token_hash text, p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_link public.approval_internal_links%rowtype;
  v_client_name text;
  v_batches jsonb;
  v_rate_hash text := encode(sha256(convert_to('internal-review:' || p_token_hash, 'UTF8')), 'hex');
begin
  select * into v_link from public.approval_internal_links
  where token_hash = p_token_hash and revoked_at is null and expires_at > p_now for update;
  if not found then return public.gbp_approval_fail('not_found'); end if;
  -- Use the client review's read window and cleanup job, with a separate hash namespace.
  if public.gbp_approval_hit_count(v_rate_hash, 'read', p_now) >= 120 then
    return public.gbp_approval_fail('not_found');
  end if;

  select c.name into v_client_name from public.clients c
  where c.id = v_link.client_id and c.organization_id = v_link.organization_id;
  if not found then return public.gbp_approval_fail('not_found'); end if;

  select jsonb_agg(jsonb_build_object('requestId', r.id, 'title', r.title, 'posts', batch.posts) order by r.created_at, r.id)
  into v_batches
  from public.approval_internal_review_requests(v_link) r
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
      'itemId', i.id, 'versionId', v.id, 'position', i.position,
      'title', v.payload->>'title', 'body', v.payload->>'body', 'postType', v.payload->>'postType',
      'scheduledDate', v.payload->>'scheduledDate', 'offerStart', v.payload->>'offerStart',
      'offerEnd', v.payload->>'offerEnd', 'terms', v.payload->>'terms',
      'ctaUrl', v.payload->>'ctaUrl', 'ctaLabel', v.payload->>'ctaLabel', 'photoPath', v.photo_path, 'photoPaths', v.photo_paths,
      'feedback', coalesce((
        select jsonb_agg(jsonb_build_object(
          'reviewerName', f.reviewer_name, 'decision', f.decision, 'comment', f.comment, 'photoPosition', f.photo_position
        ) order by f.created_at, f.id)
        from public.approval_internal_feedback f where f.link_id = v_link.id and f.version_id = v.id
      ), '[]'::jsonb)
    ) order by i.position) as posts
    from public.approval_items i
    join public.approval_item_versions v on v.id = i.current_version_id
      and v.item_id = i.id and v.request_id = r.id and v.organization_id = r.organization_id
    where i.request_id = r.id and i.organization_id = r.organization_id and i.item_type = 'gbp_post'
  ) batch
  where batch.posts is not null;
  if v_batches is null then return public.gbp_approval_fail('not_found'); end if;

  insert into public.approval_public_hits (token_hash, action, created_at) values (v_rate_hash, 'read', p_now);
  update public.approval_internal_links set view_count = view_count + 1, last_viewed_at = p_now where id = v_link.id;
  return jsonb_build_object('ok', true, 'clientName', v_client_name, 'batches', v_batches);
end;
$$;

create or replace function public.submit_approval_internal_feedback(
  p_token_hash text, p_item_id uuid, p_version_id uuid, p_reviewer_name text,
  p_decision text, p_comment text, p_idempotency_key text, p_now timestamptz, p_photo_position integer
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_link public.approval_internal_links%rowtype;
  v_item public.approval_items%rowtype;
  v_request_id uuid;
  v_previous public.approval_internal_feedback%rowtype;
  v_name text := btrim(p_reviewer_name);
  v_comment text := nullif(btrim(p_comment), '');
begin
  select * into v_link from public.approval_internal_links
  where token_hash = p_token_hash and revoked_at is null and expires_at > p_now;
  if not found then return public.gbp_approval_fail('not_found'); end if;

  -- Take the request lock before the link and item. Send, archive and version changes
  -- take the request lock first too, so a feedback write can't race past those changes.
  select r.id into v_request_id from public.approval_requests r
  join public.approval_items i on i.request_id = r.id and i.organization_id = r.organization_id
  where i.id = p_item_id and i.item_type = 'gbp_post'
    and r.organization_id = v_link.organization_id and r.client_id = v_link.client_id
    and (v_link.scope = 'client' or r.id = v_link.request_id)
    and r.item_type = 'gbp_post' and r.stage = 'draft' and r.archived_at is null
  for share of r;
  if not found then return public.gbp_approval_fail('not_found'); end if;

  select * into v_link from public.approval_internal_links
  where token_hash = p_token_hash and revoked_at is null and expires_at > p_now for update;
  if not found then return public.gbp_approval_fail('not_found'); end if;
  select i.* into v_item from public.approval_items i
  join public.approval_item_versions v on v.id = i.current_version_id and v.item_id = i.id
    and v.request_id = i.request_id and v.organization_id = i.organization_id
  where i.id = p_item_id and i.request_id = v_request_id for share of i;
  if not found then return public.gbp_approval_fail('not_found'); end if;
  if p_version_id is null or v_name is null or char_length(v_name) not between 1 and 120
    or char_length(v_comment) > 4000 or (p_decision is not null and p_decision not in ('approved', 'changes_requested'))
    or (p_decision is distinct from 'approved' and v_comment is null)
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$' then
    return public.gbp_approval_fail('invalid_request');
  end if;
  if v_item.current_version_id <> p_version_id then return public.gbp_approval_fail('refresh_required'); end if;

  if p_photo_position is not null and (p_photo_position < 1 or v_comment is null or not exists (
    select 1 from public.approval_item_versions where id=p_version_id and cardinality(photo_paths)>=p_photo_position
  )) then return public.gbp_approval_fail('invalid_request'); end if;

  select * into v_previous from public.approval_internal_feedback
  where link_id = v_link.id and idempotency_key = p_idempotency_key;
  if found then
    if (v_previous.item_id, v_previous.version_id, v_previous.reviewer_name, v_previous.decision, v_previous.comment, v_previous.photo_position)
      is distinct from (p_item_id, p_version_id, v_name, p_decision, v_comment, p_photo_position) then
      return public.gbp_approval_fail('idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  -- Use saved feedback for the submit limit so the only write is the feedback itself.
  if (select count(*) from public.approval_internal_feedback
      where link_id = v_link.id and created_at > p_now - interval '1 hour') >= 60 then
    return public.gbp_approval_fail('rate_limited');
  end if;
  insert into public.approval_internal_feedback (
    organization_id, link_id, request_id, item_id, version_id, reviewer_name, decision, comment, idempotency_key, created_at, photo_position
  ) values (
    v_link.organization_id, v_link.id, v_request_id, p_item_id, p_version_id, v_name, p_decision, v_comment, p_idempotency_key, p_now, p_photo_position
  );
  return jsonb_build_object('ok', true);
end;
$$;

-- Keep the original internal feedback signature for whole-post feedback.
create or replace function public.submit_approval_internal_feedback(
  p_token_hash text, p_item_id uuid, p_version_id uuid, p_reviewer_name text,
  p_decision text, p_comment text, p_idempotency_key text, p_now timestamptz
)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  select public.submit_approval_internal_feedback(p_token_hash,p_item_id,p_version_id,
    p_reviewer_name,p_decision,p_comment,p_idempotency_key,p_now,null);
$$;

revoke all on function public.approval_photo_paths(jsonb) from public, anon, authenticated;
revoke all on function public.gbp_approval_clean_post(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.approval_clean_item_with_photos(text, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.approval_replace_primary_photo(text, text[]) from public, anon, authenticated;
revoke all on function public.submit_approval_internal_feedback(text, uuid, uuid, text, text, text, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.submit_approval_internal_feedback(text, uuid, uuid, text, text, text, text, timestamptz, integer) to service_role;
