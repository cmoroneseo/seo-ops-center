-- Migration 141: Stored page key for seo_change_rest_position.
-- NOT APPLIED — needs owner approval.
-- This migration rewrites no data. Build the index and run the batched backfill
-- separately (see docs/seo-change-rest-position-page-key.md). The RPC fallback
-- keeps results correct before, during, and after the backfill.

-- Fail fast instead of queueing behind live traffic. ALTER TABLE and CREATE
-- TRIGGER need short ACCESS EXCLUSIVE and SHARE ROW EXCLUSIVE locks, respectively.
-- On timeout, re-run the migration: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE,
-- and DROP TRIGGER IF EXISTS make it idempotent.
set local lock_timeout = '5s';

create or replace function public.seo_change_page_key(p_page text)
returns text
language sql
immutable
parallel safe
security invoker
set search_path = pg_catalog
as $function$
  select regexp_replace(lower(url[1]), '^www[.]', '')
    || coalesce(nullif(lower(public.seo_change_decode_url_component(rtrim(url[2], '/'))), ''), '/')
  from regexp_match(
    p_page, '^https?://(?:[^/?#]*@)?([a-z0-9.-]+)(?::[0-9]+)?(/[^?#]*)?(?:[?]([^#]*))?(?:#.*)?$', 'i'
  ) as parsed(url);
$function$;

create or replace function public.seo_change_page_gbp_tagged(p_page text)
returns boolean
language sql
immutable
parallel safe
security invoker
set search_path = pg_catalog
as $function$
  -- Lowercase before decoding and keep the first value for each decoded name.
  select case when strpos(url[3], '=') > 0 then (
    select coalesce(
      max(value) filter (where name = 'utm_campaign') = 'gbp_listing'
      or max(value) filter (where name = 'utm_medium') = 'gbp'
      or (max(value) filter (where name = 'utm_source') = 'google'
          and max(value) filter (where name = 'utm_medium') = 'organic'),
      false
    )
    from (
      select distinct on (name) name, value
      from (
        select public.seo_change_decode_url_component(split_part(param, '=', 1)) as name,
               public.seo_change_decode_url_component(coalesce(substring(param from '=(.*)$'), '')) as value,
               ordinal
        from string_to_table(lower(url[3]), '&') with ordinality as split(param, ordinal)
      ) params
      where name in ('utm_campaign', 'utm_medium', 'utm_source')
      order by name, ordinal
    ) tags
  ) else false end
  from regexp_match(
    p_page, '^https?://(?:[^/?#]*@)?([a-z0-9.-]+)(?::[0-9]+)?(/[^?#]*)?(?:[?]([^#]*))?(?:#.*)?$', 'i'
  ) as parsed(url);
$function$;

revoke all on function public.seo_change_page_key(text) from public, anon, authenticated;
grant execute on function public.seo_change_page_key(text) to service_role;
revoke all on function public.seo_change_page_gbp_tagged(text) from public, anon, authenticated;
grant execute on function public.seo_change_page_gbp_tagged(text) to service_role;

alter table public.gsc_history_facts
  add column if not exists page_key text,
  add column if not exists page_gbp_tagged boolean;

create or replace function public.set_gsc_history_page_key()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if new.grain = 'page' then
    new.page_key := public.seo_change_page_key(new.page);
    new.page_gbp_tagged := public.seo_change_page_gbp_tagged(new.page);
  else
    new.page_key := null;
    new.page_gbp_tagged := null;
  end if;
  return new;
end;
$function$;

revoke all on function public.set_gsc_history_page_key() from public, anon, authenticated;

drop trigger if exists gsc_history_facts_set_page_key on public.gsc_history_facts;
create trigger gsc_history_facts_set_page_key
  before insert or update of page, grain on public.gsc_history_facts
  for each row execute function public.set_gsc_history_page_key();

create or replace function public.backfill_gsc_history_page_key_batch(
  p_after_id bigint,
  p_limit integer default 2000
) returns table (updated integer, last_id bigint)
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'page key backfill limit must be between 1 and 5000';
  end if;
  perform set_config('lock_timeout', '2s', true);

  return query
  with batch as (
    select f.id
    from public.gsc_history_facts f
    where f.grain = 'page'
      and f.page_gbp_tagged is null
      and f.id > coalesce(p_after_id, 0)
    order by f.id
    limit p_limit
    for update skip locked
  ), changed as (
    update public.gsc_history_facts f
    set page_key = public.seo_change_page_key(f.page),
        page_gbp_tagged = public.seo_change_page_gbp_tagged(f.page)
    from batch
    where f.id = batch.id
    returning f.id
  )
  select count(*)::integer, max(changed.id) from changed;
end;
$function$;

revoke all on function public.backfill_gsc_history_page_key_batch(bigint, integer) from public, anon, authenticated;
grant execute on function public.backfill_gsc_history_page_key_batch(bigint, integer) to service_role;

-- Invoke with a standalone CALL outside an explicit transaction block so the
-- procedure can commit each batch. Pass the last reported ID to resume, or
-- NULL to start from the beginning and sweep rows skipped by SKIP LOCKED.
create or replace procedure public.run_gsc_history_page_key_backfill(
  p_after_id bigint default null,
  p_batch_size integer default 2000,
  p_max_batches integer default 25
)
language plpgsql
security invoker
as $procedure$
declare
  v_batches integer := 0;
  v_rows integer := 0;
  v_updated integer;
  v_last_id bigint := p_after_id;
  v_batch_last_id bigint;
begin
  if p_max_batches is null or p_max_batches not between 1 and 200 then
    raise exception 'page key backfill max batches must be between 1 and 200';
  end if;

  while v_batches < p_max_batches loop
    select b.updated, b.last_id into v_updated, v_batch_last_id
    from public.backfill_gsc_history_page_key_batch(v_last_id, p_batch_size) b;
    commit;
    exit when v_updated = 0;

    v_batches := v_batches + 1;
    v_rows := v_rows + v_updated;
    v_last_id := v_batch_last_id;
  end loop;

  raise notice 'page key backfill: % batches, % rows, last id %', v_batches, v_rows, v_last_id;
end;
$procedure$;

revoke all on procedure public.run_gsc_history_page_key_backfill(bigint, integer, integer) from public, anon, authenticated;
grant execute on procedure public.run_gsc_history_page_key_backfill(bigint, integer, integer) to service_role;

create or replace function public.seo_change_rest_position(
  p_organization_id uuid,
  p_client_id uuid,
  p_property text,
  p_day_ids uuid[],
  p_excluded_page_keys text[]
) returns table (
  data_date date,
  clicks double precision,
  impressions double precision,
  position_weight double precision
)
language sql
stable
security invoker
set search_path = pg_catalog
as $function$
  select
    d.data_date,
    sum(f.clicks)::double precision,
    sum(f.impressions)::double precision,
    sum(f.position * f.impressions)
  from public.gsc_history_days d
  join public.gsc_history_facts f on f.day_id = d.id and f.grain = 'page'
  where cardinality(p_day_ids) between 1 and 84
    and d.id = any(p_day_ids)
    and d.organization_id = p_organization_id
    and d.client_id = p_client_id
    and d.property = p_property
    and d.search_type = 'web'
    and not d.is_incomplete
    and coalesce(nullif(f.surface, ''), 'organic') = 'organic'
    -- The flag marks computed rows, including URLs whose normalized key is NULL.
    and (
      case when f.page_gbp_tagged is null then coalesce(f.page_key, public.seo_change_page_key(f.page))
           else f.page_key
      end = any(p_excluded_page_keys)
    ) is not true
    and not coalesce(f.page_gbp_tagged, public.seo_change_page_gbp_tagged(f.page))
  group by d.data_date
  order by d.data_date;
$function$;

revoke all on function public.seo_change_rest_position(uuid, uuid, text, uuid[], text[]) from public, anon, authenticated;
grant execute on function public.seo_change_rest_position(uuid, uuid, text, uuid[], text[]) to service_role;
