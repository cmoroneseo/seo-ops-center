-- Migration 141: Stored page key for seo_change_rest_position.
-- NOT APPLIED — needs owner approval.
-- Prod gsc_history_facts is ~1402 MB total (864 MB heap), ~3.49M rows,
-- including 395,413 page rows. The database is ~1483 MB.
-- Nullable column adds are metadata-only. The batched backfill rewrites only
-- those page rows, creating roughly 125–150 MB of new heap tuples at the table's
-- average row size with 64–128 added bytes per row for the key and flag.
-- Autovacuum can reclaim the old tuple space for reuse.
-- Use a regular index build, which scans the heap and blocks writes while it
-- builds, because CREATE INDEX CONCURRENTLY cannot run in a migration transaction.
-- In that transaction the ALTER TABLE lock is also held until commit.

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

create or replace function public.backfill_gsc_history_page_key(p_from bigint, p_to bigint)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
declare
  v_count integer;
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to::numeric - p_from > 100000 then
    raise exception 'page key backfill range must be a positive span of at most 100000 ids';
  end if;
  update public.gsc_history_facts
  set page_key = public.seo_change_page_key(page),
      page_gbp_tagged = public.seo_change_page_gbp_tagged(page)
  where id >= p_from
    and id < p_to
    and grain = 'page'
    and page_key is null
    and page_gbp_tagged is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.backfill_gsc_history_page_key(bigint, bigint) from public, anon, authenticated;
grant execute on function public.backfill_gsc_history_page_key(bigint, bigint) to service_role;

do $$
declare
  v_min bigint;
  v_max bigint;
  v_lo bigint;
  v_span constant bigint := 100000;
begin
  select min(id), max(id) into v_min, v_max from public.gsc_history_facts;
  v_lo := v_min;
  while v_lo <= v_max loop
    perform public.backfill_gsc_history_page_key(v_lo, v_lo + v_span);
    v_lo := v_lo + v_span;
  end loop;
end $$;

-- Look up only page facts for the requested day IDs. Fetch payloads from the
-- heap so unbounded URL keys cannot exceed the B-tree tuple size limit.
create index if not exists gsc_history_facts_page_key_day_idx
  on public.gsc_history_facts (day_id) where grain = 'page';

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
