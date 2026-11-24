-- Migration 140: Daily rest-of-site position for SEO changes.
-- NOT APPLIED — needs owner approval.

-- Decode URL components used by normalizeResultUrl and isGbpTaggedUrl.
create or replace function public.seo_change_decode_url_component(p_value text)
returns text
language plpgsql
immutable
strict
parallel safe
security invoker
set search_path = pg_catalog
as $function$
declare
  v_hex text;
begin
  if strpos(p_value, '%') = 0 or p_value ~ '%(?![0-9a-fA-F]{2})' then
    return p_value;
  end if;
  select string_agg(coalesce(parts[1], encode(convert_to(parts[2], 'UTF8'), 'hex')), '' order by ordinal)
    into v_hex
  from regexp_matches(p_value, '%([0-9a-fA-F]{2})|([^%]+)', 'g') with ordinality as m(parts, ordinal);
  begin
    return convert_from(decode(v_hex, 'hex'), 'UTF8');
  exception
    when character_not_in_repertoire or untranslatable_character then
      return p_value;
  end;
end;
$function$;

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
  cross join lateral regexp_match(
    f.page, '^https?://(?:[^/?#]*@)?([a-z0-9.-]+)(?::[0-9]+)?(/[^?#]*)?(?:[?]([^#]*))?(?:#.*)?$', 'i'
  ) as parsed(url)
  where cardinality(p_day_ids) between 1 and 84
    and d.id = any(p_day_ids)
    and d.organization_id = p_organization_id
    and d.client_id = p_client_id
    and d.property = p_property
    and d.search_type = 'web'
    and not d.is_incomplete
    and coalesce(nullif(f.surface, ''), 'organic') = 'organic'
    -- Match the normalized test keys across scheme, www, slash, case and query variants.
    and (
      regexp_replace(lower(url[1]), '^www[.]', '')
      || coalesce(nullif(lower(public.seo_change_decode_url_component(rtrim(url[2], '/'))), ''), '/')
      = any(p_excluded_page_keys)
    ) is not true
    -- Legacy organic rows can carry GBP tags. URLSearchParams.get uses the first value.
    and not case when strpos(url[3], '=') > 0 then (
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
  group by d.data_date
  order by d.data_date;
$function$;

revoke all on function public.seo_change_decode_url_component(text) from public, anon, authenticated;
grant execute on function public.seo_change_decode_url_component(text) to service_role;
revoke all on function public.seo_change_rest_position(uuid, uuid, text, uuid[], text[]) from public, anon, authenticated;
grant execute on function public.seo_change_rest_position(uuid, uuid, text, uuid[], text[]) to service_role;
