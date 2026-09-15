-- 056_topical_map_records.sql
-- Topical Map: content gap finder with silo-organized page specifications

-- ─── topical_maps ───────────────────────────────────────────────────────────
create table public.topical_maps (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    version integer not null default 1,
    status text not null default 'draft' check (status in ('draft', 'review', 'active', 'archived')),
    title text not null default '',
    architecture_summary text,
    seed_input jsonb not null default '{}'::jsonb,
    generation_metadata jsonb not null default '{}'::jsonb,
    created_by uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- One non-archived map per client
create unique index topical_maps_active_unique
    on public.topical_maps (organization_id, client_id)
    where status != 'archived';

create index topical_maps_client_idx on public.topical_maps (client_id);

alter table public.topical_maps enable row level security;
create policy topical_maps_auth on public.topical_maps
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.topical_maps to service_role;

-- ─── topical_map_silos ─────────────────────────────────────────────────────
create table public.topical_map_silos (
    id uuid primary key default gen_random_uuid(),
    map_id uuid not null references public.topical_maps(id) on delete cascade,
    organization_id uuid not null,
    name text not null,
    description text,
    hub_url text,
    search_intent text not null default 'informational'
        check (search_intent in ('transactional', 'commercial', 'informational', 'navigational')),
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

create index topical_map_silos_map_idx on public.topical_map_silos (map_id);

alter table public.topical_map_silos enable row level security;
create policy topical_map_silos_auth on public.topical_map_silos
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.topical_map_silos to service_role;

-- ─── topical_map_records ────────────────────────────────────────────────────
create table public.topical_map_records (
    id uuid primary key default gen_random_uuid(),
    silo_id uuid not null references public.topical_map_silos(id) on delete cascade,
    map_id uuid not null references public.topical_maps(id) on delete cascade,
    organization_id uuid not null,
    parent_record_id uuid references public.topical_map_records(id) on delete set null,
    page_type text not null default 'other'
        check (page_type in (
            'pillar', 'service', 'landing', 'product', 'collection', 'city',
            'blog_post', 'guide', 'faq', 'resource_center', 'knowledge_base',
            'homepage', 'comparison', 'case_study', 'other'
        )),
    content_category text,
    action text not null default 'create'
        check (action in ('create', 'replace', 'improve', 'keep')),
    title text not null,
    target_query text not null default '',
    word_count_min integer not null default 0,
    word_count_max integer not null default 0,
    build_phase integer not null default 1,
    refresh_interval_days integer,
    search_volume_monthly integer,
    keyword_difficulty integer check (keyword_difficulty is null or (keyword_difficulty >= 0 and keyword_difficulty <= 100)),
    scope_exclusions jsonb not null default '[]'::jsonb,
    outgoing_links jsonb not null default '[]'::jsonb,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'declined')),
    site_page_id uuid references public.site_pages(id) on delete set null,
    matched_url text,
    task_id uuid references public.tasks(id) on delete set null,
    reviewer_notes text,
    sort_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index topical_map_records_silo_idx on public.topical_map_records (silo_id);
create index topical_map_records_map_idx on public.topical_map_records (map_id);
create index topical_map_records_parent_idx on public.topical_map_records (parent_record_id) where parent_record_id is not null;
create index topical_map_records_task_idx on public.topical_map_records (task_id) where task_id is not null;

alter table public.topical_map_records enable row level security;
create policy topical_map_records_auth on public.topical_map_records
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.topical_map_records to service_role;

-- ─── Trigger: revert record status when linked task is deleted ──────────────
-- ON DELETE SET NULL nulls out task_id; this trigger detects that and reverts
-- the record back to 'pending' so it can be re-approved.
create or replace function public.revert_record_on_task_unlink()
returns trigger language plpgsql as $$
begin
    if OLD.task_id is not null and NEW.task_id is null and OLD.status = 'approved' then
        NEW.status := 'pending';
        NEW.updated_at := now();
    end if;
    return NEW;
end;
$$;

create trigger topical_map_record_task_unlink
    before update of task_id on public.topical_map_records
    for each row execute function public.revert_record_on_task_unlink();
