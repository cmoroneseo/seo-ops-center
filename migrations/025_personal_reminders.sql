-- =============================================================================
-- 025: Personal Reminders — ClickUp-style reminders (UserMenu → Personal Tools)
-- =============================================================================
-- Strictly personal: RLS restricts rows to the creating user (auth.uid()).
-- A 5-minute Vercel cron (/api/cron/fire-reminders) turns due reminders into
-- bell notifications (type 'reminder_due'). Recurrence advances on completion.
-- notify_offset_minutes: 0 = notify on due date, N = notify N minutes before,
-- NULL = don't notify (reminder only shows in the panel).
-- =============================================================================

create table public.personal_reminders (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  title text not null,
  notes text,
  due_at timestamp with time zone not null,
  notify_offset_minutes integer default 0,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  client_id uuid references public.clients(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  notified_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Cron sweep: pending, not-yet-notified reminders ordered by due time
create index personal_reminders_cron_idx
  on public.personal_reminders (due_at)
  where status = 'pending' and notified_at is null;

-- Panel queries: a user's reminders by status and due time
create index personal_reminders_user_idx
  on public.personal_reminders (user_id, status, due_at);

alter table public.personal_reminders enable row level security;

create policy "Users can manage their own personal reminders"
  on public.personal_reminders for all
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

-- =============================================================================
-- Notifications — allow the reminder_due type and reminder entity
-- =============================================================================
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'task_assigned', 'task_mentioned', 'note_mentioned',
    'deliverable_assigned', 'deliverable_overdue', 'deliverable_at_risk', 'deliverable_status',
    'reminder_due'
  ));

alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('task', 'task_comment', 'client_note', 'deliverable', 'reminder'));
