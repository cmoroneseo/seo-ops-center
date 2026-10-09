-- 073: metrics natural key, manual-entry protection, sync run outcomes.
-- Safe on live data as of Oct 8, 2026: 0 duplicate (client_id, source, metric_month) rows, 0 null keys.
-- Apply this file in the Supabase SQL editor before the app that calls write_metric is deployed.

do $$
begin
  if exists (
    select 1 from public.metrics
    where client_id is not null and metric_month is not null
    group by client_id, source, metric_month having count(*) > 1
  ) then
    raise exception '073: duplicate metrics (client_id, source, metric_month) rows exist; resolve manually first';
  end if;
end $$;

alter table public.metrics
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists entered_by uuid;           -- auth user id for manual entries; no FK on purpose

create unique index if not exists metrics_client_source_month_key
  on public.metrics (client_id, source, metric_month);

-- Never let any writer silently downgrade a manual row to auto.
create or replace function public.metrics_protect_manual()
returns trigger language plpgsql as $$
begin
  if old.source_type = 'manual' and new.source_type is distinct from 'manual' then
    raise exception 'metrics: manual rows cannot be overwritten by automatic sync' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists metrics_protect_manual on public.metrics;
create trigger metrics_protect_manual before update on public.metrics
  for each row execute function public.metrics_protect_manual();

create or replace function public.write_metric(
  p_organization_id uuid, p_client_id uuid, p_source text, p_metric_month text,
  p_data jsonb, p_source_type text, p_sync_run_id uuid default null, p_entered_by uuid default null)
returns text
language plpgsql security definer set search_path = public as $$
declare v_inserted boolean;
begin
  if p_source_type not in ('auto', 'manual') then raise exception 'write_metric: invalid source_type'; end if;
  if p_metric_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'write_metric: invalid month'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'write_metric: data must be an object'; end if;
  perform 1 from public.clients where id = p_client_id and organization_id = p_organization_id;
  if not found then raise exception 'write_metric: client does not belong to organization'; end if;

  insert into public.metrics as m
    (organization_id, client_id, source, metric_month, date, data, source_type, sync_run_id, entered_by, updated_at)
  values
    (p_organization_id, p_client_id, p_source, p_metric_month, (p_metric_month || '-01')::date,
     p_data, p_source_type, p_sync_run_id, p_entered_by, now())
  on conflict (client_id, source, metric_month) do update
    set data = excluded.data, source_type = excluded.source_type, sync_run_id = excluded.sync_run_id,
        entered_by = excluded.entered_by, date = excluded.date
    where m.organization_id = excluded.organization_id
      and (m.source_type is distinct from 'manual' or excluded.source_type = 'manual')
  returning (xmax = 0) into v_inserted;

  if not found then return 'skipped_manual'; end if;
  return case when v_inserted then 'inserted' else 'updated' end;
end $$;

revoke all on function public.write_metric(uuid, uuid, text, text, jsonb, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.write_metric(uuid, uuid, text, text, jsonb, text, uuid, uuid) to service_role;

alter table public.sync_runs
  add column if not exists target_month    text,
  add column if not exists trigger         text check (trigger in ('cron', 'manual')),
  add column if not exists clients_skipped integer not null default 0,
  add column if not exists source_outcomes jsonb   not null default '[]'::jsonb;
