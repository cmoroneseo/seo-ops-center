-- Migration 149: One verified GBP video or up to ten photos per post version.

update storage.buckets
set file_size_limit = 78643200,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime']
where id = 'gbp-approval-uploads';

do $$
declare constraint_name text;
begin
  for constraint_name in
    select c.conname from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.conrelid = 'public.approval_assets'::regclass and c.contype = 'c'
      and a.attname in ('content_type', 'byte_size', 'kind')
    group by c.conname
  loop
    execute format('alter table public.approval_assets drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.approval_assets
  add column video_verified_at timestamptz,
  add constraint approval_assets_media_check check (
    (kind in ('mockup', 'doc_image', 'client_replacement', 'video_poster')
      and content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
      and byte_size between 1 and 10485760 and video_verified_at is null)
    or (kind = 'video' and content_type in ('video/mp4', 'video/quicktime')
      and byte_size between 1 and 78643200)
  );

alter table public.approval_item_versions
  add column video_path text,
  add column video_poster_path text,
  add constraint approval_versions_video_path_check check (
    video_path is null or (char_length(video_path) <= 500
      and video_path ~ '^(https://\S+|(approval-assets|gbp-approvals)/[0-9a-f-]{36}/[0-9a-f-]{36})$')
  ),
  add constraint approval_versions_video_poster_check check (
    video_poster_path is null or (video_path is not null and video_poster_path <> video_path and char_length(video_poster_path) <= 500
      and video_poster_path ~ '^(https://\S+|(approval-assets|gbp-approvals)/[0-9a-f-]{36}/[0-9a-f-]{36})$')
  ),
  add constraint approval_versions_media_exclusion_check check (
    not (video_path is not null and (photo_path is not null or coalesce(array_length(photo_paths, 1), 0) > 0))
  );

create function public.approval_clean_item_with_media(p_type text, p_item jsonb)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare clean jsonb; video text := p_item->>'videoPath'; poster text := p_item->>'videoPosterPath';
begin
  clean := public.approval_clean_item_with_photos(p_type,p_item->'payload',p_item->>'photoPath',p_item->'photoPaths');
  if clean is null then return null; end if;
  if video is not null and (
    p_type <> 'gbp_post' or jsonb_typeof(p_item->'videoPath') <> 'string'
    or public.approval_photo_paths(jsonb_build_array(video)) is null
    or p_item->>'photoPath' is not null or jsonb_array_length(clean->'photos') > 0
  ) then return null; end if;
  if poster is not null and (
    video is null or poster = video or jsonb_typeof(p_item->'videoPosterPath') <> 'string'
    or public.approval_photo_paths(jsonb_build_array(poster)) is null
  ) then return null; end if;
  return clean || jsonb_build_object('video',video,'videoPoster',poster);
end $$;

create function public.approval_visible_with_media(
  p_type text, p_payload jsonb, p_photo text, p_photos text[], p_video text, p_poster text
)
returns jsonb language sql security definer set search_path = pg_catalog, public as $$
  select public.approval_visible(p_type,p_payload,p_photo) || case when p_type = 'gbp_post'
    then jsonb_build_object('photos',p_photos,'video',p_video,'videoPoster',p_poster) else '{}'::jsonb end;
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
 if new.video_path is not null then
   if t <> 'gbp_post' or new.photo_path is not null or cardinality(new.photo_paths) > 0 then
     raise exception 'invalid GBP media selection' using errcode='23514';
   end if;
 end if;
 foreach path in array array_remove(array[new.video_path,new.video_poster_path], null) loop
   if path like 'approval-assets/%' and not exists (select 1 from public.approval_assets
     where object_key=path and request_id=new.request_id and organization_id=new.organization_id
       and (item_id is null or item_id=new.item_id)
       and (case when path=new.video_path then kind='video' and video_verified_at is not null
         else kind='video_poster' end))
   then raise exception 'unverified video or media outside request' using errcode='23514'; end if;
   if path like 'gbp-approvals/%' and path not like 'gbp-approvals/' || new.request_id::text || '/%'
   then raise exception 'media outside request' using errcode='23514'; end if;
 end loop;
 foreach path in array new.photo_paths loop
   if path like 'approval-assets/%' and not exists (select 1 from public.approval_assets
     where object_key=path and request_id=new.request_id and organization_id=new.organization_id
       and (item_id is null or item_id=new.item_id) and kind not in ('video','video_poster'))
   then raise exception 'asset outside request' using errcode='23514'; end if;
   if t='gbp_post' and path like 'gbp-approvals/%' and path not like 'gbp-approvals/' || new.request_id::text || '/%'
   then raise exception 'image outside request' using errcode='23514'; end if;
 end loop;
 if t='page' then
   if new.photo_path like 'gbp-approvals/%' and not public.approval_replacement_key(new.photo_path,new.request_id) then raise exception 'image outside request' using errcode='23514'; end if;
   for img in select * from jsonb_path_query(new.payload->'body','strict $.** ? (@.type == "image")') loop
     if coalesce(img#>>'{attrs,src}','') !~ '^https://\S+$' and not exists (select 1 from public.approval_assets where object_key=img#>>'{attrs,src}' and request_id=new.request_id and organization_id=new.organization_id and (item_id is null or item_id=new.item_id) and kind not in ('video','video_poster')) and not public.approval_replacement_key(img#>>'{attrs,src}',new.request_id) then raise exception 'image outside request' using errcode='23514'; end if;
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
    v_clean := public.approval_clean_item_with_media(p_item_type,v_item);
    if v_clean is null then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_paths := public.approval_photo_paths(v_clean->'photos');
    if v_clean->>'photo' like 'gbp-approvals/%' or v_clean->>'video' like 'gbp-approvals/%'
       or v_clean->>'videoPoster' like 'gbp-approvals/%'
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
      payload, photo_path, photo_paths, video_path, video_poster_path, source, created_by, outline, source_ref
    ) values (
      p_organization_id, v_request_id, v_item_id, 1, 1,
      v_clean->'payload', nullif(v_clean->>'photo', ''), v_paths, v_clean->>'video', v_clean->>'videoPoster', 'create', p_actor, v_item->'outline', v_item->'sourceRef'
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
  v_video text;
  v_poster text;
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
    v_clean := public.approval_clean_item_with_media(v_request.item_type,v_entry);
    if v_clean is null then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_video := v_clean->>'video';
    v_poster := v_clean->>'videoPoster';
    if v_request.item_type='gbp_post' and not (v_entry ? 'videoPath')
      and v_entry->>'photoPath' is null and coalesce(jsonb_array_length(v_clean->'photos'),0)=0 then
      v_video := v_current.video_path;
      v_poster := v_current.video_poster_path;
    end if;
    v_paths := case when v_request.item_type <> 'gbp_post' then null
      when v_video is not null then '{}'::text[]
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
    v_changed := public.approval_visible_with_media(v_request.item_type,v_current.payload,v_current.photo_path,
        v_current.photo_paths,v_current.video_path,v_current.video_poster_path)
      is distinct from public.approval_visible_with_media(v_request.item_type,v_clean->'payload',
        case when v_request.item_type='gbp_post' then v_paths[1] else v_clean->>'photo' end,v_paths,v_video,v_poster);
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
      payload, photo_path, photo_paths, video_path, video_poster_path, change_note, source, source_response_id, created_by, outline, source_ref
    ) values (
      v_request.organization_id, p_request_id, v_item.id, v_current.version_no + 1, 1,
      v_clean->'payload', case when v_request.item_type='gbp_post' then v_paths[1] else nullif(v_clean->>'photo', '') end, v_paths, v_video, v_poster, v_note, v_source, v_source_response, p_actor, v_entry->'outline', v_entry->'sourceRef'
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
     clean := public.approval_clean_item_with_media(r.item_type,e);
     if clean is null then raise exception 'invalid_request' using errcode='P0001'; end if;
     select coalesce(max(position),0)+1 into pos from public.approval_items where request_id=r.id;
     insert into public.approval_items(organization_id,request_id,item_type,page_kind,position)
     values(r.organization_id,r.id,r.item_type,case when r.item_type='page' then e#>>'{payload,pageKind}' end,coalesce((e->>'position')::integer,pos)) returning id into iid;
     insert into public.approval_item_versions(organization_id,request_id,item_id,version_no,schema_version,payload,photo_path,photo_paths,video_path,video_poster_path,source,created_by,outline,source_ref)
     values(r.organization_id,r.id,iid,1,1,clean->'payload',clean->>'photo',public.approval_photo_paths(clean->'photos'),clean->>'video',clean->>'videoPoster','create',p_actor,e->'outline',e->'sourceRef') returning id into vid;
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
 insert into public.approval_item_versions(organization_id,request_id,item_id,version_no,schema_version,payload,photo_path,photo_paths,video_path,video_poster_path,source,created_by,outline,change_note)
 values(c.organization_id,c.request_id,c.item_id,v.version_no+1,1,clean->'payload',case when i.item_type='gbp_post' then coalesce(clean->>'photo', v.photo_paths[2]) else clean->>'photo' end,
   case when i.item_type='gbp_post' then public.approval_replace_primary_photo(clean->>'photo',v.photo_paths) end,case when p_photo is null then v.video_path end,case when p_photo is null then v.video_poster_path end,'accepted_suggestion',p_actor,v.outline,'Accepted suggestion') returning id into vid;
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
 insert into public.approval_item_versions(organization_id,request_id,item_id,version_no,schema_version,payload,photo_path,photo_paths,video_path,video_poster_path,source,created_by,outline,change_note)
 values(c.organization_id,c.request_id,c.item_id,v.version_no+1,1,clean->'payload',case when i.item_type='gbp_post' then coalesce(clean->>'photo', v.photo_paths[2]) else clean->>'photo' end,
   case when i.item_type='gbp_post' then public.approval_replace_primary_photo(clean->>'photo',v.photo_paths) end,case when p_photo is null then v.video_path end,case when p_photo is null then v.video_poster_path end,'accepted_suggestion',p_actor,p_outline,'Accepted suggestion') returning id into vid;
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
 select public.approval_visible_with_media(i.item_type,a.payload,a.photo_path,a.photo_paths,a.video_path,a.video_poster_path)
   is distinct from public.approval_visible_with_media(i.item_type,b.payload,b.photo_path,b.photo_paths,b.video_path,b.video_poster_path) into changed
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

create or replace function public.reserve_approval_asset(p_actor uuid,p_request_id uuid,p_item_id uuid,p_kind text,p_content_type text,p_size integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.approval_requests%rowtype; aid uuid := gen_random_uuid(); k text;
begin
 select * into r from public.approval_requests where id=p_request_id for update;
 if not found then return public.gbp_approval_fail('not_found'); end if;
 if not public.gbp_approval_writer(p_actor,r.organization_id) then return public.gbp_approval_fail('forbidden'); end if;
 if p_item_id is not null and not exists(select 1 from public.approval_items where id=p_item_id and request_id=r.id) then return public.gbp_approval_fail('out_of_scope'); end if;
 if p_kind in ('video','video_poster') and r.item_type <> 'gbp_post' then return public.gbp_approval_fail('invalid_request'); end if;
 k := 'approval-assets/' || r.id::text || '/' || aid::text;
 insert into public.approval_assets(id,organization_id,request_id,item_id,object_key,content_type,byte_size,kind,created_by)
 values(aid,r.organization_id,r.id,p_item_id,k,p_content_type,p_size,p_kind,p_actor);
 return jsonb_build_object('ok',true,'assetId',aid,'objectKey',k);
exception when check_violation or not_null_violation then return public.gbp_approval_fail('invalid_request');
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
  where (a.created_at < p_now-interval '7 days' and not exists(select 1 from public.approval_item_versions v
    where v.request_id=a.request_id and (a.object_key=any(v.photo_paths) or a.object_key=v.video_path
      or a.object_key=v.video_poster_path or v.payload::text like '%' || a.object_key || '%')))
  or (a.kind in ('video','video_poster') and exists (
    select 1 from public.approval_requests r
    left join public.approval_links l on l.request_id=r.id
    where r.id=a.request_id and (
      r.archived_at < p_now-interval '12 months'
      or (r.archived_at is null and coalesce(l.revoked_at,l.expires_at) < p_now-interval '12 months'
        and not exists (select 1 from public.approval_internal_links il
          where il.organization_id=r.organization_id and il.client_id=r.client_id
            and il.revoked_at is null and il.expires_at>p_now
            and exists (select 1 from public.approval_internal_review_requests(il) ir where ir.id=r.id)))
    )));
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
          'videoPath', version.video_path,
          'videoPosterPath', version.video_poster_path,
          'changeNote', version.change_note,
          'previous', (
            select jsonb_build_object(
              'versionNo', previous.version_no,
              'payload', previous.payload,
              'photoPath', previous.photo_path,
              'photoPaths', previous.photo_paths,
              'videoPath', previous.video_path,
              'videoPosterPath', previous.video_poster_path
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
      'videoPath', v.video_path, 'videoPosterPath', v.video_poster_path,
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

revoke all on function
  public.approval_clean_item_with_media(text, jsonb),
  public.approval_visible_with_media(text, jsonb, text, text[], text, text),
  public.create_approval_request(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb, jsonb, text, uuid, text, text),
  public.post_approval_version(uuid, uuid, jsonb, timestamptz),
  public.update_approval_draft(uuid, uuid, jsonb, timestamptz),
  public.accept_approval_suggestion(uuid, uuid, jsonb, text, timestamptz),
  public.release_approval_revision(uuid, uuid, timestamptz),
  public.reserve_approval_asset(uuid, uuid, uuid, text, text, integer),
  public.purge_gbp_approval_retention(timestamptz, text[]),
  public.get_gbp_approval_by_token(text, timestamptz),
  public.get_approval_internal_review(text, timestamptz),
  public.accept_approval_suggestion(uuid, uuid, jsonb, text, timestamptz, jsonb, uuid) from public, anon, authenticated;

grant execute on function
  public.create_approval_request(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb, jsonb, text, uuid, text, text),
  public.post_approval_version(uuid, uuid, jsonb, timestamptz),
  public.update_approval_draft(uuid, uuid, jsonb, timestamptz),
  public.accept_approval_suggestion(uuid, uuid, jsonb, text, timestamptz),
  public.release_approval_revision(uuid, uuid, timestamptz),
  public.reserve_approval_asset(uuid, uuid, uuid, text, text, integer),
  public.purge_gbp_approval_retention(timestamptz, text[]),
  public.get_gbp_approval_by_token(text, timestamptz),
  public.get_approval_internal_review(text, timestamptz),
  public.accept_approval_suggestion(uuid, uuid, jsonb, text, timestamptz, jsonb, uuid) to service_role;
