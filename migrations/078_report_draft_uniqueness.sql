-- 078: one monthly close draft per client per month.
-- 075 is reserved and unused. This file does not take it.
--
-- reports had no kind column and no (client_id, report_month, kind) uniqueness.
-- Builder reports can already share a client and month, so a full unique
-- constraint would fail on those rows or reject a second saved report.
-- Existing rows are labeled kind = custom and left in place. Nothing is deleted.
-- The unique index covers kind = monthly only, which is what the auto-draft
-- cron inserts. If monthly duplicates already exist, this file aborts before
-- creating the index.
--
-- Rollback:
-- drop index if exists public.reports_client_month_monthly_key;
-- alter table public.reports drop constraint if exists reports_kind_check;
-- alter table public.reports drop column if exists kind;

alter table public.reports
  add column if not exists kind text;

update public.reports
set kind = 'custom'
where kind is null;

alter table public.reports
  alter column kind set default 'custom';

alter table public.reports
  alter column kind set not null;

alter table public.reports
  drop constraint if exists reports_kind_check;

alter table public.reports
  add constraint reports_kind_check
  check (kind in ('monthly', 'custom'));

do $$
begin
  if exists (
    select 1
    from public.reports
    where client_id is not null
      and kind = 'monthly'
    group by client_id, report_month, kind
    having count(*) > 1
  ) then
    raise exception 'reports already has duplicate monthly rows for a client and month'
      using errcode = '23505';
  end if;
end $$;

create unique index if not exists reports_client_month_monthly_key
  on public.reports (client_id, report_month, kind)
  where client_id is not null
    and kind = 'monthly';
