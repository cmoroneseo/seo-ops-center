-- =============================================================================
-- Migration 015: Deliverable Commitments — the contract layer
-- =============================================================================
-- Generated: 2026-06-11
-- Plan: ~/.claude/plans/improved-prompt-i-sharded-galaxy.md
--
-- Makes client agreement commitments first-class (e.g. "EcoWorkz: 2 blogs/month")
-- so fulfillment can be tracked against what was promised:
--   * adding public.deliverable_commitments  (contract layer; generates monthly
--     rows in the existing public.deliverables fulfillment layer via cron)
--   * extending public.deliverables          (commitment link, assignee,
--     published_url, subtype, generation provenance)
--   * adding public.commitment_change_log    (audit, mirrors client_change_log)
--   * extending public.notifications         (deliverable_* notification types)
--
-- Legacy clients.blogs_due_per_month / deliverables_spec stay for now (the
-- change-log trigger references them); app code syncs blogs_due_per_month from
-- the blog commitment until Phase 2 retires those fields.
--
-- Idempotent and safe to re-run. Mirrors the changes folded into schema.sql.
-- =============================================================================


-- =============================================================================
-- A. Deliverable Commitments — what the agreement promises, per client + type
-- =============================================================================
create table if not exists public.deliverable_commitments (
  id                  uuid default uuid_generate_v4() primary key,
  organization_id     uuid references public.organizations(id) on delete cascade not null,
  client_id           uuid references public.clients(id) on delete cascade not null,
  type                text not null check (type in ('Content', 'Backlink', 'GBP', 'Other')) default 'Content',
  subtype             text,             -- 'blog' | 'service_page' | 'city_page' | 'landing_page' |
                                        -- 'link_building' | 'gbp_management' | 'technical_seo' | custom
  title               text not null,    -- display name, e.g. "Blog Posts", "City Pages"
  quantity_per_month  numeric(5, 1) not null default 1,
  cadence             text not null default 'monthly'
                        check (cadence in ('monthly', 'quarterly', 'one_time')),
  engagement_model    text not null default 'Retainer'
                        check (engagement_model in ('Retainer', 'Campaign')),
  total_quantity      integer,          -- campaign cap; null for open-ended retainers
  starts_on           date not null,
  ends_on             date,             -- null = open-ended
  is_active           boolean not null default true,
  default_assignee_id uuid references public.users(id),
  due_day             smallint check (due_day between 1 and 28),  -- day-of-month for generated due dates
  counts_toward_hours boolean default true,
  task_template_id    uuid references public.task_templates(id) on delete set null,
  generate_tasks      boolean not null default false,  -- Phase 2: auto-create production tasks
  notes               text,
  custom_fields       jsonb not null default '{}'::jsonb,
  created_at          timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at          timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists deliverable_commitments_client_idx
  on public.deliverable_commitments (client_id, is_active);
create index if not exists deliverable_commitments_org_idx
  on public.deliverable_commitments (organization_id);


-- =============================================================================
-- B. Deliverables — extend the fulfillment layer
-- =============================================================================
alter table public.deliverables
  add column if not exists commitment_id     uuid references public.deliverable_commitments(id) on delete set null,
  add column if not exists assignee_id       uuid references public.users(id),
  add column if not exists published_url     text,
  add column if not exists word_count        integer,
  add column if not exists subtype           text,
  add column if not exists generated_by      text default 'manual',
  add column if not exists sequence_in_month smallint;  -- "Blog 2 of 4"

do $$ begin
  alter table public.deliverables
    add constraint deliverables_generated_by_check
    check (generated_by is null or generated_by in ('manual', 'cron', 'import'));
exception when duplicate_object then null; end $$;

create index if not exists deliverables_commitment_month_idx
  on public.deliverables (commitment_id, month);
create index if not exists deliverables_assignee_idx
  on public.deliverables (assignee_id) where assignee_id is not null;


-- =============================================================================
-- C. Commitment Change Log — audit trail for agreement changes
-- =============================================================================
create table if not exists public.commitment_change_log (
  id               uuid default uuid_generate_v4() primary key,
  organization_id  uuid references public.organizations(id) on delete cascade not null,
  client_id        uuid references public.clients(id) on delete cascade not null,
  commitment_id    uuid references public.deliverable_commitments(id) on delete set null,
  changed_by_id    uuid references public.users(id),
  change_type      text not null check (change_type in ('created', 'quantity', 'dates', 'paused', 'resumed', 'ended')),
  prev_values      jsonb,
  new_values       jsonb,
  effective_date   date,
  notes            text,
  created_at       timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists commitment_change_log_client_idx
  on public.commitment_change_log (client_id, created_at desc);


-- =============================================================================
-- D. Row Level Security
-- =============================================================================
alter table public.deliverable_commitments enable row level security;
alter table public.commitment_change_log   enable row level security;

drop policy if exists "Org members can manage deliverable_commitments" on public.deliverable_commitments;
create policy "Org members can manage deliverable_commitments"
  on public.deliverable_commitments for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );

drop policy if exists "Org members can manage commitment_change_log" on public.commitment_change_log;
create policy "Org members can manage commitment_change_log"
  on public.commitment_change_log for all
  using      ( organization_id in (select get_user_org_ids()) )
  with check ( organization_id in (select get_user_org_ids()) );


-- =============================================================================
-- E. Auto change-log: record commitment changes (mirrors log_client_change)
-- -----------------------------------------------------------------------------
-- Fires on insert ('created') and on updates to quantity/dates/active state.
-- The backfill importer sets app.suppress_change_log='on' to skip during load.
-- =============================================================================
create or replace function public.log_commitment_change()
returns trigger as $$
declare
  v_change_type text;
begin
  if coalesce(current_setting('app.suppress_change_log', true), 'off') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    insert into public.commitment_change_log (
      organization_id, client_id, commitment_id, changed_by_id,
      change_type, new_values, effective_date
    ) values (
      new.organization_id, new.client_id, new.id, auth.uid(),
      'created',
      jsonb_build_object(
        'type', new.type, 'subtype', new.subtype, 'title', new.title,
        'quantity_per_month', new.quantity_per_month, 'cadence', new.cadence,
        'starts_on', new.starts_on, 'ends_on', new.ends_on, 'total_quantity', new.total_quantity
      ),
      new.starts_on
    );
    return new;
  end if;

  -- UPDATE: classify the change; skip no-op updates
  if new.is_active is distinct from old.is_active then
    v_change_type := case when new.is_active then 'resumed' else 'paused' end;
  elsif new.ends_on is not null and old.ends_on is null then
    v_change_type := 'ended';
  elsif new.quantity_per_month is distinct from old.quantity_per_month
     or new.total_quantity is distinct from old.total_quantity then
    v_change_type := 'quantity';
  elsif new.starts_on is distinct from old.starts_on
     or new.ends_on is distinct from old.ends_on then
    v_change_type := 'dates';
  else
    return new;
  end if;

  insert into public.commitment_change_log (
    organization_id, client_id, commitment_id, changed_by_id,
    change_type, prev_values, new_values, effective_date
  ) values (
    new.organization_id, new.client_id, new.id, auth.uid(),
    v_change_type,
    jsonb_build_object(
      'quantity_per_month', old.quantity_per_month, 'total_quantity', old.total_quantity,
      'starts_on', old.starts_on, 'ends_on', old.ends_on, 'is_active', old.is_active
    ),
    jsonb_build_object(
      'quantity_per_month', new.quantity_per_month, 'total_quantity', new.total_quantity,
      'starts_on', new.starts_on, 'ends_on', new.ends_on, 'is_active', new.is_active
    ),
    current_date
  );
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_commitment_change on public.deliverable_commitments;
create trigger on_commitment_change
  after insert or update on public.deliverable_commitments
  for each row execute procedure public.log_commitment_change();


-- =============================================================================
-- F. Notifications — deliverable event types
-- =============================================================================
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'task_assigned', 'task_mentioned', 'note_mentioned',
    'deliverable_assigned', 'deliverable_overdue', 'deliverable_at_risk', 'deliverable_status'
  ));

alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('task', 'task_comment', 'client_note', 'deliverable'));

-- =============================================================================
-- End of migration 015
-- =============================================================================
