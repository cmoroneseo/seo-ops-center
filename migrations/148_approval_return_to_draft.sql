-- Migration 148: Return sent approval requests to draft and rotate their links on resend.

create or replace function public.return_approval_to_draft(
  p_actor uuid,
  p_request_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  r public.approval_requests%rowtype;
begin
  select * into r from public.approval_requests where id = p_request_id for update;
  if not found then return public.gbp_approval_fail('not_found'); end if;
  if not public.gbp_approval_writer(p_actor, r.organization_id)
    or exists (select 1 from public.approval_bot_actors where user_id = p_actor) then
    return public.gbp_approval_fail('forbidden');
  end if;
  if r.archived_at is not null then return public.gbp_approval_fail('archived'); end if;
  if r.stage <> 'sent' then return public.gbp_approval_fail('not_sent'); end if;
  if p_now is null then return public.gbp_approval_fail('invalid_request'); end if;

  with revoked as (
    update public.approval_links set revoked_at = p_now
    where request_id = r.id and revoked_at is null returning id
  )
  insert into public.approval_events (organization_id, request_id, actor_id, kind, detail, created_at)
    select r.organization_id, r.id, p_actor, 'link_revoked', '{}'::jsonb, p_now from revoked;

  update public.approval_requests
    set stage = 'draft', sent_at = null, sent_by = null, updated_at = p_now
    where id = r.id;
  return jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.send_approval_request(p_actor uuid,p_request_id uuid,p_token_hash text,p_expires_at timestamptz,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
 r public.approval_requests%rowtype;
 v_link public.approval_links%rowtype;
 link_id uuid;
 v_rotated boolean := false;
begin
 select * into r from public.approval_requests where id=p_request_id for update;
 if not found then return public.gbp_approval_fail('not_found'); end if;
 if not public.gbp_approval_writer(p_actor,r.organization_id)
 or exists(select 1 from public.approval_bot_actors where user_id=p_actor)
 or not (exists(select 1 from public.organization_members where organization_id=r.organization_id and user_id=p_actor and role in ('owner','admin'))
 or exists(select 1 from public.clients where id=r.client_id and account_manager_id=p_actor)) then return public.gbp_approval_fail('forbidden'); end if;
 if r.archived_at is not null then return public.gbp_approval_fail('archived'); end if;
 if r.stage<>'draft' then return public.gbp_approval_fail('already_sent'); end if;
 if p_now is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
 or p_expires_at is null or p_expires_at<=p_now or p_expires_at>p_now+interval '90 days' then return public.gbp_approval_fail('invalid_request'); end if;
 if not exists(select 1 from public.approval_items where request_id=r.id) or exists(
 select 1 from public.approval_items i left join public.approval_item_versions v on v.id=i.current_version_id
 where i.request_id=r.id and (v.id is null or public.approval_clean_item(i.item_type,v.payload,v.photo_path) is null)) then return public.gbp_approval_fail('invalid_request'); end if;
 select * into v_link from public.approval_links where request_id = r.id for update;
 if found then
   if v_link.revoked_at is null then return public.gbp_approval_fail('link_exists'); end if;
   update public.approval_links
     set token_hash = p_token_hash, expires_at = p_expires_at, revoked_at = null,
         extended_at = p_now, created_by = p_actor
     where id = v_link.id;
   link_id := v_link.id;
   v_rotated := true;
   insert into public.approval_events (organization_id, request_id, actor_id, kind, detail, created_at)
     values (r.organization_id, r.id, p_actor, 'link_rotated', '{}'::jsonb, p_now);
 else
   insert into public.approval_links(organization_id,request_id,token_hash,expires_at,created_by,created_at)
   values(r.organization_id,r.id,p_token_hash,p_expires_at,p_actor,p_now) returning id into link_id;
 end if;
 update public.approval_items set released_version_id=current_version_id where request_id=r.id;
 update public.approval_requests set stage='sent',sent_at=p_now,sent_by=p_actor,updated_at=p_now where id=r.id;
 insert into public.approval_events(organization_id,request_id,actor_id,kind,created_at) values(r.organization_id,r.id,p_actor,'request_sent',p_now);
 return jsonb_build_object('ok',true,'linkId',link_id,'rotated',v_rotated);
exception when unique_violation or check_violation then return public.gbp_approval_fail('invalid_request');
end $$;

create or replace function public.extend_gbp_approval_link(
  p_actor uuid,
  p_request_id uuid,
  p_expires_at timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_request public.approval_requests%rowtype;
  v_link public.approval_links%rowtype;
begin
  select * into v_request from public.approval_requests where id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if not public.gbp_approval_writer(p_actor, v_request.organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;
  select * into v_link from public.approval_links where request_id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if v_link.revoked_at is not null or v_request.stage <> 'sent' then
    return public.gbp_approval_fail('revoked');
  end if;
  p_expires_at := coalesce(p_expires_at, greatest(v_link.expires_at, p_now) + interval '14 days');
  if p_expires_at is null or p_expires_at <= p_now or p_expires_at > p_now + interval '90 days' then
    return public.gbp_approval_fail('invalid_request');
  end if;
  update public.approval_links
    set expires_at = p_expires_at, extended_at = p_now
    where id = v_link.id;
  insert into public.approval_events (organization_id, request_id, actor_id, kind, detail)
  values (
    v_request.organization_id, p_request_id, p_actor, 'link_extended',
    jsonb_build_object('expiresAt', p_expires_at)
  );
  return jsonb_build_object('ok', true, 'linkId', v_link.id, 'expiresAt', p_expires_at);
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
  -- Recheck the token after acquiring locks in the same order as send and revoke.
  select * into v_request from public.approval_requests where id = v_link.request_id for update;
  select * into v_link from public.approval_links where id = v_link.id and token_hash = p_token_hash for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  select name into v_client_name from public.clients where id = v_request.client_id;
  v_had := exists (select 1 from public.approval_submissions where request_id = v_request.id);

  if v_link.revoked_at is not null or v_request.stage <> 'sent' or v_link.expires_at <= p_now then
    return jsonb_build_object(
      'ok', true,
      'state', case when v_link.revoked_at is not null or v_request.stage <> 'sent' then 'revoked' else 'expired' end,
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

revoke all on function public.return_approval_to_draft(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.return_approval_to_draft(uuid, uuid, timestamptz) to service_role;

revoke all on function public.send_approval_request(uuid, uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.send_approval_request(uuid, uuid, text, timestamptz, timestamptz) to service_role;
