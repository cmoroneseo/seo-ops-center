-- =============================================================================
-- 026: Weekly Planner — calendar events + the sidebar Priorities list
-- =============================================================================
-- planner_events is NOT strictly personal, unlike personal_notes and
-- personal_reminders: org members can read each other's non-private events so
-- the "Meet with <teammate>" filter can show their calendar. Writes stay
-- owner-only.
--
-- Scheduled tasks are NOT duplicated here. A task lands on the grid by having
-- tasks.start_date set; dragging it writes that column directly.
-- =============================================================================

create table public.planner_events (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  title text not null,
  description text,
  kind text not null default 'event' check (kind in ('meeting', 'focus', 'ooo', 'lunch', 'event')),
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  all_day boolean not null default false,
  location text,
  client_id uuid references public.clients(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  attendee_ids uuid[] not null default '{}',
  busy boolean not null default true,
  visibility text not null default 'default' check (visibility in ('default', 'private')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint planner_events_ends_after_starts check (ends_at > starts_at)
);

-- The week-range query: every visible event in an org between two timestamps
create index planner_events_org_range_idx
  on public.planner_events (organization_id, starts_at);

-- "My events"
create index planner_events_user_idx
  on public.planner_events (user_id, starts_at);

-- "Meet with" teammate filter
create index planner_events_attendees_idx
  on public.planner_events using gin (attendee_ids);

alter table public.planner_events enable row level security;

create policy "Org members can read visible planner events"
  on public.planner_events for select
  using (
    organization_id in (select get_user_org_ids())
    and (visibility = 'default' or user_id = auth.uid())
  );

create policy "Users can insert their own planner events"
  on public.planner_events for insert
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

create policy "Users can update their own planner events"
  on public.planner_events for update
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

create policy "Users can delete their own planner events"
  on public.planner_events for delete
  using ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

-- =============================================================================
-- planner_priorities — the reorderable Priorities list in the planner rail
-- =============================================================================
-- A priority is either a pinned real task (task_id) or free text (label).

create table public.planner_priorities (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete cascade,
  label text,
  sort_order integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint planner_priorities_needs_target check (task_id is not null or label is not null)
);

create index planner_priorities_user_idx
  on public.planner_priorities (user_id, sort_order);

alter table public.planner_priorities enable row level security;

create policy "Users can manage their own planner priorities"
  on public.planner_priorities for all
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );
