-- Migration 146: Notify staff of comment-only GBP reviews.

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
  v_comment_only boolean;
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

  -- Comment-only GBP reviews notify staff without advancing the task.
  v_comment_only := v_request.item_type = 'gbp_post'
    and jsonb_array_length(p_payload->'decisions') = 0
    and not v_has_answers;

  select status, due_date into v_task_status, v_task_due
  from public.tasks where id = v_request.task_id;
  v_advanced := null;
  if not v_comment_only and v_pending = 0 and v_changes = 0 and v_approved > 0 and v_task_status = 'todo' then
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
