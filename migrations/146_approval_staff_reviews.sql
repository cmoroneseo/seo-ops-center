-- Migration 146: Staff decisions during draft review, independent of client decisions and internal review links.

create table public.approval_staff_reviews (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  item_id uuid not null references public.approval_items(id) on delete cascade,
  version_id uuid not null references public.approval_item_versions(id) on delete cascade,
  reviewer_id uuid references public.users(id) on delete set null,
  decision text not null check (decision in ('approved', 'changes_requested')),
  note text check (char_length(note) <= 4000),
  tags text[] not null default '{}' check (
    tags <@ array['copy', 'photo', 'dates', 'cta', 'other']::text[] and cardinality(tags) <= 5
  ),
  created_at timestamptz not null default now(),
  check (decision <> 'changes_requested' or (note is not null and note ~ '[^[:space:]]'))
);

create index approval_staff_reviews_version_idx
  on public.approval_staff_reviews (version_id, id desc);
create index approval_staff_reviews_request_idx
  on public.approval_staff_reviews (request_id, id desc);

alter table public.approval_staff_reviews enable row level security;
revoke all on table public.approval_staff_reviews from public, anon, authenticated, service_role;
grant select on table public.approval_staff_reviews to service_role;

create function public.record_approval_staff_review(
  p_actor uuid, p_request_id uuid, p_item_id uuid, p_version_id uuid,
  p_decision text, p_note text, p_tags text[]
)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_request public.approval_requests%rowtype;
  v_version uuid;
  v_review public.approval_staff_reviews%rowtype;
  v_note text := nullif(regexp_replace(p_note, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  v_tags text[];
begin
  -- Match the lock order used by send, archive and version updates.
  select * into v_request from public.approval_requests where id = p_request_id for update;
  if not found then return public.gbp_approval_fail('not_found'); end if;
  if not public.gbp_approval_writer(p_actor, v_request.organization_id)
    or exists (select 1 from public.approval_bot_actors where user_id = p_actor) then
    return public.gbp_approval_fail('forbidden');
  end if;
  if v_request.stage <> 'draft' or v_request.archived_at is not null then
    return public.gbp_approval_fail('not_draft');
  end if;
  if p_decision is null or p_decision not in ('approved', 'changes_requested')
    or char_length(p_note) > 4000 or (p_decision = 'changes_requested' and v_note is null)
    or p_version_id is null or cardinality(p_tags) > 5
    or not coalesce(p_tags, '{}') <@ array['copy', 'photo', 'dates', 'cta', 'other']::text[] then
    return public.gbp_approval_fail('invalid_request');
  end if;
  select i.current_version_id into v_version from public.approval_items i
    join public.approval_item_versions v on v.id = i.current_version_id
      and v.item_id = i.id and v.request_id = i.request_id and v.organization_id = i.organization_id
    where i.id = p_item_id and i.request_id = v_request.id and i.organization_id = v_request.organization_id for share of i;
  if not found then return public.gbp_approval_fail('invalid_request'); end if;
  if v_version <> p_version_id then return public.gbp_approval_fail('refresh_required'); end if;

  select coalesce(array_agg(distinct tag order by tag), '{}') into v_tags from unnest(p_tags) tag;
  select * into v_review from public.approval_staff_reviews where version_id = v_version order by id desc limit 1;
  if not found or (v_review.reviewer_id, v_review.decision, v_review.note, v_review.tags)
    is distinct from (p_actor, p_decision, v_note, v_tags) then
    insert into public.approval_staff_reviews (organization_id, request_id, item_id, version_id, reviewer_id, decision, note, tags)
    values (v_request.organization_id, v_request.id, p_item_id, v_version, p_actor, p_decision, v_note, v_tags)
    returning * into v_review;
  end if;

  return jsonb_build_object('ok', true, 'reviewId', v_review.id, 'review', jsonb_build_object(
    'decision', v_review.decision, 'note', v_review.note, 'tags', v_review.tags,
    'reviewer_id', v_review.reviewer_id, 'reviewer_name', (select full_name from public.users where id = v_review.reviewer_id),
    'created_at', v_review.created_at, 'version_id', v_review.version_id
  ));
end;
$$;

revoke all on function public.record_approval_staff_review(uuid, uuid, uuid, uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.record_approval_staff_review(uuid, uuid, uuid, uuid, text, text, text[]) to service_role;
