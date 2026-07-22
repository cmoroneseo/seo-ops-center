-- =============================================================================
-- 024: Personal Notes — ClickUp-style personal notepad (UserMenu → Personal Tools)
-- =============================================================================
-- Strictly personal: RLS restricts rows to the creating user (auth.uid()),
-- not just the org. Rich text stored as HTML. task_id links a note promoted
-- to a real task (no completion sync back).
-- =============================================================================

create table public.personal_notes (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  title text not null default '',
  content_html text not null default '',
  task_id uuid references public.tasks(id) on delete set null,
  archived_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index personal_notes_user_idx on public.personal_notes (user_id, updated_at desc);

alter table public.personal_notes enable row level security;

create policy "Users can manage their own personal notes"
  on public.personal_notes for all
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );
