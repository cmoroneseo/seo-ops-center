-- Migration 135: Sheet mirror sync runs.
--
-- NOT APPLIED. Do not run this against the production Supabase project.
-- The owner reviews and applies it separately. Tests run it on PGlite only.

create table if not exists public.sheet_sync_runs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    sheet_id text not null,
    trigger text not null check (trigger in ('cron', 'manual')),
    requested_by uuid references public.users(id),
    status text not null check (status in ('running', 'succeeded', 'failed', 'skipped')),
    rows_written jsonb not null default '{}'::jsonb,
    error text check (char_length(error) <= 1000),
    started_at timestamptz not null default now(),
    finished_at timestamptz
);

create index if not exists sheet_sync_runs_client_started_idx
    on public.sheet_sync_runs (client_id, started_at desc);

create index if not exists sheet_sync_runs_running_sheet_idx
    on public.sheet_sync_runs (sheet_id) where status = 'running';

alter table public.sheet_sync_runs enable row level security;
drop policy if exists sheet_sync_runs_org_select on public.sheet_sync_runs;
create policy sheet_sync_runs_org_select on public.sheet_sync_runs
    for select to authenticated
    using (organization_id in (select public.get_user_org_ids()));

revoke all on public.sheet_sync_runs from anon, authenticated;
grant select on public.sheet_sync_runs to authenticated;
grant select, insert, update on public.sheet_sync_runs to service_role;

-- Reserve a run atomically. The six-minute lease covers the five-minute
-- function limit and lets a later run recover from a terminated invocation.
create or replace function public.reserve_sheet_sync_run(
    p_run_id uuid, p_client_id uuid, p_org_id uuid, p_sheet_id text,
    p_trigger text, p_requested_by uuid
) returns text
language plpgsql security invoker set search_path = ''
as $$
declare
    v_now timestamptz;
begin
    perform pg_advisory_xact_lock(hashtextextended('sheet-sync-client:' || p_client_id::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('sheet-sync-sheet:' || p_sheet_id, 0));
    v_now := clock_timestamp();

    if exists (select 1 from public.sheet_sync_runs where id = p_run_id) then
        return 'duplicate';
    end if;

    perform 1 from public.clients
    where id = p_client_id and organization_id = p_org_id and roadmap_sheet_id = p_sheet_id
    for share;
    if not found then return 'missing_sheet'; end if;

    if p_trigger = 'manual' and exists (
        select 1 from public.sheet_sync_runs where client_id = p_client_id
          and trigger = 'manual' and started_at > v_now - interval '2 minutes'
    ) then return 'rate_limited'; end if;

    update public.sheet_sync_runs
        set status = 'failed', error = 'Sheet mirror timed out', finished_at = v_now
        where sheet_id = p_sheet_id and status = 'running' and started_at <= v_now - interval '6 minutes';

    if exists (select 1 from public.sheet_sync_runs where sheet_id = p_sheet_id and status = 'running')
    then return 'busy'; end if;

    insert into public.sheet_sync_runs
        (id, organization_id, client_id, sheet_id, trigger, requested_by, status, started_at)
    values (p_run_id, p_org_id, p_client_id, p_sheet_id, p_trigger, p_requested_by, 'running', v_now);
    return 'reserved';
end;
$$;

revoke all on function public.reserve_sheet_sync_run(uuid, uuid, uuid, text, text, uuid)
    from public, anon, authenticated;
grant execute on function public.reserve_sheet_sync_run(uuid, uuid, uuid, text, text, uuid)
    to service_role;
