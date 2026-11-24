-- Migration 144: Internal review links for GBP draft posts.
--
-- NOT APPLIED. Do not run this against the production Supabase project.
-- The owner reviews and applies it separately. Tests run it on PGlite only.
--
-- These links and feedback are independent of the client send and approval lifecycle.

create table public.approval_internal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  request_id uuid references public.approval_requests(id) on delete cascade,
  scope text not null check (scope in ('request', 'client') and (scope = 'request') = (request_id is not null)),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  expires_in_days integer not null default 7 check (expires_in_days between 1 and 30),
  created_by uuid,
  created_by_bot_key_id uuid,
  idempotency_key text,
  revoked_at timestamptz,
  revoked_by uuid,
  view_count bigint not null default 0 check (view_count >= 0),
  last_viewed_at timestamptz,
  check (expires_at = created_at + expires_in_days * interval '24 hours'),
  check ((created_by is not null) <> (created_by_bot_key_id is not null)),
  check ((created_by_bot_key_id is not null) = (idempotency_key is not null)),
  check (idempotency_key is null or idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$'),
  check ((revoked_at is null) = (revoked_by is null)),
  unique (created_by_bot_key_id, idempotency_key)
);

create table public.approval_internal_feedback (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  link_id uuid not null references public.approval_internal_links(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  item_id uuid not null references public.approval_items(id) on delete cascade,
  version_id uuid not null references public.approval_item_versions(id) on delete cascade,
  reviewer_name text not null check (char_length(btrim(reviewer_name)) between 1 and 120),
  decision text check (decision in ('approved', 'changes_requested')),
  comment text check (char_length(comment) <= 4000),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$'),
  created_at timestamptz not null default now(),
  check (decision is not distinct from 'approved' or nullif(btrim(comment), '') is not null),
  unique (link_id, idempotency_key)
);

create index approval_internal_links_active_idx
  on public.approval_internal_links (organization_id, client_id, expires_at) where revoked_at is null;
create index approval_internal_feedback_link_date_idx
  on public.approval_internal_feedback (link_id, created_at);
create index approval_internal_feedback_link_version_idx
  on public.approval_internal_feedback (link_id, version_id, created_at, id);
create index approval_internal_feedback_request_date_idx
  on public.approval_internal_feedback (request_id, created_at, id);
create index approval_requests_internal_drafts_idx
  on public.approval_requests (organization_id, client_id)
  where item_type = 'gbp_post' and stage = 'draft' and archived_at is null;

alter table public.approval_internal_links enable row level security;
alter table public.approval_internal_feedback enable row level security;
revoke all on table public.approval_internal_links, public.approval_internal_feedback from public, anon, authenticated, service_role;
grant select on table public.approval_internal_links, public.approval_internal_feedback to service_role;
grant update (revoked_at, revoked_by) on public.approval_internal_links to service_role;

-- Request- and client-scoped links use the same live draft predicate.
create function public.approval_internal_review_requests(p_link public.approval_internal_links)
returns setof public.approval_requests
language sql stable set search_path = pg_catalog, public
as $$
  select r.* from public.approval_requests r
  where r.organization_id = p_link.organization_id and r.client_id = p_link.client_id
    and (p_link.scope = 'client' or r.id = p_link.request_id)
    and r.item_type = 'gbp_post' and r.stage = 'draft' and r.archived_at is null;
$$;

create function public.issue_approval_internal_link(
  p_actor uuid, p_bot_key_id uuid, p_request_id uuid, p_client_id uuid, p_token_hash text,
  p_expires_in_days integer, p_idempotency_key text, p_organization_id uuid, p_now timestamptz
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_request public.approval_requests%rowtype;
  v_link public.approval_internal_links%rowtype;
  v_client_id uuid := p_client_id;
  v_request_id uuid := case when p_client_id is null then p_request_id end;
  v_days integer := coalesce(p_expires_in_days, 7);
begin
  if p_now is null or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or v_days not between 1 and 30
    or (p_actor is null) = (p_bot_key_id is null) or (p_request_id is null and p_client_id is null) then
    return public.gbp_approval_fail('invalid_request');
  end if;

  if p_bot_key_id is not null then
    if (p_request_id is not null and p_client_id is not null)
      or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$' then
      return public.gbp_approval_fail('invalid_request');
    end if;
    perform 1 from public.bot_api_keys
    where id = p_bot_key_id and organization_id = p_organization_id and revoked_at is null for share;
    if not found then return public.gbp_approval_fail('forbidden'); end if;
    perform pg_advisory_xact_lock(hashtextextended('approval-internal:' || p_bot_key_id || ':' || p_idempotency_key, 0));
    select * into v_link from public.approval_internal_links
    where created_by_bot_key_id = p_bot_key_id and idempotency_key = p_idempotency_key;
    if found then
      if v_link.organization_id <> p_organization_id or v_link.request_id is distinct from v_request_id
        or (p_client_id is not null and v_link.client_id <> p_client_id)
        or v_link.expires_in_days <> v_days then
        return public.gbp_approval_fail('idempotency_conflict');
      end if;
      return jsonb_build_object('ok', true, 'idempotent', true, 'expiresAt', v_link.expires_at);
    end if;
  elsif p_request_id is null or p_idempotency_key is not null then
    return public.gbp_approval_fail('invalid_request');
  end if;

  if p_request_id is not null then
    select * into v_request from public.approval_requests
    where id = p_request_id and organization_id = p_organization_id and item_type = 'gbp_post'
      and (p_client_id is null or client_id = p_client_id) for share;
    if not found then return public.gbp_approval_fail('not_found'); end if;
    v_client_id := v_request.client_id;
  end if;

  perform 1 from public.clients where id = v_client_id and organization_id = p_organization_id;
  if not found then return public.gbp_approval_fail('not_found'); end if;
  if p_actor is not null and not public.gbp_approval_writer(p_actor, p_organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;
  if p_request_id is not null and (v_request.stage <> 'draft' or v_request.archived_at is not null) then
    return public.gbp_approval_fail('not_draft');
  end if;

  insert into public.approval_internal_links (
    organization_id, client_id, request_id, scope, token_hash, expires_at, expires_in_days,
    created_by, created_by_bot_key_id, idempotency_key, created_at
  ) values (
    p_organization_id, v_client_id, v_request_id, case when v_request_id is null then 'client' else 'request' end,
    p_token_hash, p_now + v_days * interval '24 hours', v_days, p_actor, p_bot_key_id, p_idempotency_key, p_now
  ) returning * into v_link;
  return jsonb_build_object('ok', true, 'id', v_link.id, 'expiresAt', v_link.expires_at);
end;
$$;

create function public.get_approval_internal_review(p_token_hash text, p_now timestamptz)
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
      'ctaUrl', v.payload->>'ctaUrl', 'ctaLabel', v.payload->>'ctaLabel', 'photoPath', v.photo_path,
      'feedback', coalesce((
        select jsonb_agg(jsonb_build_object(
          'reviewerName', f.reviewer_name, 'decision', f.decision, 'comment', f.comment
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

create function public.submit_approval_internal_feedback(
  p_token_hash text, p_item_id uuid, p_version_id uuid, p_reviewer_name text,
  p_decision text, p_comment text, p_idempotency_key text, p_now timestamptz
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

  select * into v_previous from public.approval_internal_feedback
  where link_id = v_link.id and idempotency_key = p_idempotency_key;
  if found then
    if (v_previous.item_id, v_previous.version_id, v_previous.reviewer_name, v_previous.decision, v_previous.comment)
      is distinct from (p_item_id, p_version_id, v_name, p_decision, v_comment) then
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
    organization_id, link_id, request_id, item_id, version_id, reviewer_name, decision, comment, idempotency_key, created_at
  ) values (
    v_link.organization_id, v_link.id, v_request_id, p_item_id, p_version_id, v_name, p_decision, v_comment, p_idempotency_key, p_now
  );
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.approval_internal_review_requests(public.approval_internal_links) from public, anon, authenticated, service_role;
revoke all on function public.issue_approval_internal_link(uuid, uuid, uuid, uuid, text, integer, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.get_approval_internal_review(text, timestamptz) from public, anon, authenticated;
revoke all on function public.submit_approval_internal_feedback(text, uuid, uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.issue_approval_internal_link(uuid, uuid, uuid, uuid, text, integer, text, uuid, timestamptz) to service_role;
grant execute on function public.get_approval_internal_review(text, timestamptz) to service_role;
grant execute on function public.submit_approval_internal_feedback(text, uuid, uuid, text, text, text, text, timestamptz) to service_role;
