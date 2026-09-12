-- Reviewed identity is a reversible claim layer, never a rewrite of crawl history.
create table public.site_page_identity_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  source_site_page_id uuid not null,
  target_site_page_id uuid,
  decision_kind text not null check (decision_kind in ('claim_into','keep_separate','needs_research','reopen')),
  reason_code text not null,
  note text check (note is null or length(note) <= 2000),
  evidence_snapshot jsonb not null check (jsonb_typeof(evidence_snapshot) = 'object' and pg_column_size(evidence_snapshot) <= 262144),
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  foreign key (source_site_page_id, organization_id, client_id)
    references public.site_pages(id, organization_id, client_id) on delete restrict,
  foreign key (target_site_page_id, organization_id, client_id)
    references public.site_pages(id, organization_id, client_id) on delete restrict,
  check (source_site_page_id <> target_site_page_id),
  check ((decision_kind in ('claim_into','reopen') and target_site_page_id is not null)
    or (decision_kind in ('keep_separate','needs_research') and target_site_page_id is null)),
  check (case decision_kind
    when 'claim_into' then reason_code in ('redirect_alias','canonical_alias','protocol_or_host_variant','duplicate_page','historical_url','other')
    when 'keep_separate' then reason_code in ('distinct_intent','distinct_location','distinct_language','intentional_variant','different_content','other')
    when 'needs_research' then reason_code in ('content_purpose_unknown','conflicting_signals','target_unfetched','ownership_unknown','other')
    when 'reopen' then reason_code in ('incorrect_decision','new_evidence','site_changed','other')
    else false end),
  check (reason_code <> 'other' or (note is not null and note ~ '[^[:space:]]')),
  unique (id, organization_id, client_id, source_site_page_id, target_site_page_id)
);
create index site_page_identity_decisions_client_created_idx
  on public.site_page_identity_decisions(organization_id, client_id, created_at desc);
create index site_page_identity_decisions_source_idx on public.site_page_identity_decisions(source_site_page_id, created_at desc);
create index site_page_identity_decisions_target_idx on public.site_page_identity_decisions(target_site_page_id);

create table public.site_page_claims (
  source_site_page_id uuid primary key,
  organization_id uuid not null,
  client_id uuid not null,
  target_site_page_id uuid not null,
  decision_id uuid not null unique references public.site_page_identity_decisions(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  check (source_site_page_id <> target_site_page_id),
  foreign key (source_site_page_id, organization_id, client_id)
    references public.site_pages(id, organization_id, client_id) on delete restrict,
  foreign key (target_site_page_id, organization_id, client_id)
    references public.site_pages(id, organization_id, client_id) on delete restrict,
  foreign key (decision_id, organization_id, client_id, source_site_page_id, target_site_page_id)
    references public.site_page_identity_decisions(id, organization_id, client_id, source_site_page_id, target_site_page_id) on delete restrict
);
create index site_page_claims_client_created_idx on public.site_page_claims(organization_id, client_id, created_at desc);
create index site_page_claims_target_idx on public.site_page_claims(target_site_page_id);

create or replace function public.guard_site_page_identity_decision_immutable()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  raise exception 'Site page identity decisions are immutable';
end;
$$;
create trigger site_page_identity_decisions_immutable before update or delete on public.site_page_identity_decisions
  for each row execute function public.guard_site_page_identity_decision_immutable();

create or replace function public.set_site_page_identity_decision(
  p_organization_id uuid, p_client_id uuid, p_created_by uuid,
  p_source_site_page_id uuid, p_target_site_page_id uuid,
  p_decision_kind text, p_reason_code text, p_note text, p_evidence_snapshot jsonb
)
returns public.site_page_identity_decisions
language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  v_decision public.site_page_identity_decisions%rowtype;
  v_claim public.site_page_claims%rowtype;
  v_target uuid;
  v_run uuid;
  v_snapshot uuid;
  v_current uuid;
  v_next uuid;
  v_path uuid[];
  v_target_depth integer := 0;
  v_incoming_depth integer;
begin
  -- All decisions for a client share this lock, including independent sources.
  -- This prevents write-skew cycles and ancestor-chain overflows. Claims have
  -- no UPDATE grant, so FOR UPDATE on claims is intentionally not used.
  perform pg_advisory_xact_lock(hashtextextended('site-page-identity:' || p_client_id::text, 0));

  if p_created_by is null or not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id and user_id = p_created_by
  ) then raise exception 'Reviewer must be an organization member'; end if;

  perform 1 from public.site_pages where id = p_source_site_page_id
    and organization_id = p_organization_id and client_id = p_client_id for update;
  if not found then raise exception 'Source page scope mismatch'; end if;
  select * into v_claim from public.site_page_claims where source_site_page_id = p_source_site_page_id
    and organization_id = p_organization_id and client_id = p_client_id;

  if p_decision_kind is null or p_decision_kind not in ('claim_into','keep_separate','needs_research','reopen') then
    raise exception 'Invalid identity decision kind';
  end if;
  if p_reason_code is null or not (case p_decision_kind
    when 'claim_into' then p_reason_code in ('redirect_alias','canonical_alias','protocol_or_host_variant','duplicate_page','historical_url','other')
    when 'keep_separate' then p_reason_code in ('distinct_intent','distinct_location','distinct_language','intentional_variant','different_content','other')
    when 'needs_research' then p_reason_code in ('content_purpose_unknown','conflicting_signals','target_unfetched','ownership_unknown','other')
    when 'reopen' then p_reason_code in ('incorrect_decision','new_evidence','site_changed','other')
    else false end) then raise exception 'Invalid identity reason code'; end if;
  if length(p_note) > 2000 or (p_reason_code = 'other' and (p_note is null or p_note !~ '[^[:space:]]')) then
    raise exception 'Invalid identity note';
  end if;

  if p_decision_kind = 'claim_into' then
    if p_target_site_page_id is null then raise exception 'Claim target is required'; end if;
    if p_target_site_page_id = p_source_site_page_id then raise exception 'Cannot self-claim'; end if;
    if v_claim.source_site_page_id is not null then raise exception 'Source already has an active claim'; end if;
    v_target := p_target_site_page_id;
  else
    if p_target_site_page_id is not null then raise exception 'This decision cannot nominate a target'; end if;
    if p_decision_kind = 'reopen' then
      if v_claim.source_site_page_id is null then raise exception 'Independent source has no active claim to reopen'; end if;
      v_target := v_claim.target_site_page_id;
    elsif v_claim.source_site_page_id is not null then
      raise exception 'Reopen the active claim before recording this decision';
    end if;
  end if;

  if v_target is not null then
    perform 1 from public.site_pages where id = v_target
      and organization_id = p_organization_id and client_id = p_client_id for update;
    if not found then raise exception 'Target page scope mismatch'; end if;
  end if;

  if p_evidence_snapshot is null or jsonb_typeof(p_evidence_snapshot) is distinct from 'object'
    or pg_column_size(p_evidence_snapshot) > 262144
    or p_evidence_snapshot->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_evidence_snapshot->'source') is distinct from 'object'
    or p_evidence_snapshot#>>'{source,pageId}' is distinct from p_source_site_page_id::text
    or jsonb_typeof(p_evidence_snapshot->'signals') is distinct from 'array' then
    raise exception 'Invalid identity evidence envelope';
  end if;

  select id into v_run from public.site_crawl_runs
    where organization_id = p_organization_id and client_id = p_client_id and status = 'completed'
    order by created_at desc, id desc limit 1;
  select id into v_snapshot from public.site_page_snapshots
    where organization_id = p_organization_id and client_id = p_client_id
      and run_id = v_run and site_page_id = p_source_site_page_id
    order by observed_at desc, id desc limit 1;
  if v_snapshot is null or p_evidence_snapshot#>>'{source,snapshotId}' is distinct from v_snapshot::text then
    raise exception 'Source snapshot is stale or outside review scope';
  end if;

  if p_decision_kind = 'claim_into' or p_evidence_snapshot ? 'target' then
    if v_target is null or jsonb_typeof(p_evidence_snapshot->'target') is distinct from 'object'
      or p_evidence_snapshot#>>'{target,pageId}' is distinct from v_target::text then
      raise exception 'Target evidence scope mismatch';
    end if;
    select id into v_snapshot from public.site_page_snapshots
      where organization_id = p_organization_id and client_id = p_client_id
        and run_id = v_run and site_page_id = v_target
      order by observed_at desc, id desc limit 1;
    if v_snapshot is null or p_evidence_snapshot#>>'{target,snapshotId}' is distinct from v_snapshot::text then
      raise exception 'Target snapshot is stale or outside review scope';
    end if;
  end if;

  if p_decision_kind = 'claim_into' then
    v_current := v_target;
    v_path := array[p_source_site_page_id];
    loop
      if v_current = any(v_path) then raise exception 'Identity claim cycle detected'; end if;
      v_path := array_append(v_path, v_current);
      select target_site_page_id into v_next from public.site_page_claims
        where source_site_page_id = v_current and organization_id = p_organization_id and client_id = p_client_id;
      exit when not found;
      v_target_depth := v_target_depth + 1;
      if v_target_depth >= 32 then raise exception 'Identity claim depth exceeds 32 edges'; end if;
      v_current := v_next;
    end loop;
    with recursive ancestors(page_id, depth, path) as (
      select p_source_site_page_id, 0, array[p_source_site_page_id]
      union all
      select c.source_site_page_id, a.depth + 1, array_append(a.path, c.source_site_page_id)
      from ancestors a join public.site_page_claims c on c.target_site_page_id = a.page_id
      where c.organization_id = p_organization_id and c.client_id = p_client_id
        and a.depth < 32 and not c.source_site_page_id = any(a.path)
    ) select max(depth) into v_incoming_depth from ancestors;
    if v_incoming_depth + 1 + v_target_depth > 32 then raise exception 'Identity claim depth exceeds 32 edges'; end if;
  end if;

  insert into public.site_page_identity_decisions(
    organization_id, client_id, source_site_page_id, target_site_page_id,
    decision_kind, reason_code, note, evidence_snapshot, created_by
  ) values (
    p_organization_id, p_client_id, p_source_site_page_id, v_target,
    p_decision_kind, p_reason_code, p_note, p_evidence_snapshot, p_created_by
  ) returning * into v_decision;

  if p_decision_kind = 'claim_into' then
    insert into public.site_page_claims(source_site_page_id, organization_id, client_id, target_site_page_id, decision_id)
      values (p_source_site_page_id, p_organization_id, p_client_id, v_target, v_decision.id);
  elsif p_decision_kind = 'reopen' then
    delete from public.site_page_claims where source_site_page_id = p_source_site_page_id
      and organization_id = p_organization_id and client_id = p_client_id;
  end if;
  return v_decision;
end;
$$;

alter table public.site_page_identity_decisions enable row level security;
alter table public.site_page_claims enable row level security;
create policy site_page_identity_decisions_read on public.site_page_identity_decisions for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));
create policy site_page_claims_read on public.site_page_claims for select to authenticated
  using (organization_id in (select public.get_user_org_ids()));
revoke all on public.site_page_identity_decisions, public.site_page_claims from public, anon, authenticated, service_role;
grant select on public.site_page_identity_decisions, public.site_page_claims to authenticated;
grant select, insert on public.site_page_identity_decisions to service_role;
grant select, insert, delete on public.site_page_claims to service_role;

revoke all on function public.guard_site_page_identity_decision_immutable() from public, anon, authenticated;
revoke all on function public.set_site_page_identity_decision(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.guard_site_page_identity_decision_immutable() to service_role;
grant execute on function public.set_site_page_identity_decision(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb) to service_role;
