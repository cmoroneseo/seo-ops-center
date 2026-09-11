-- Aggregate saved GSC facts in Postgres so Search Insights does not download
-- and combine every daily query/page row in the browser.
create function public.get_gsc_search_insights(
 p_organization_id uuid,
 p_client_id uuid,
 p_property text,
 p_start date,
 p_end date
)
returns jsonb
language sql
stable
security invoker
set search_path=pg_catalog,public
as $$
 with selected_days as materialized (
  select d.id,d.data_date,d.imported_at,d.page_limited,d.query_limited
  from public.gsc_history_days d
  where d.organization_id=p_organization_id
    and d.client_id=p_client_id
    and d.property=p_property
    and d.search_type='web'
    and d.data_date between p_start and p_end
 ),
 grouped_queries as (
  select f.query,f.page,
   sum(f.clicks) as clicks,
   sum(f.impressions) as impressions,
   case when sum(f.impressions)>0
    then sum(f.position*f.impressions)/sum(f.impressions)
    else null
   end as position,
   count(distinct f.day_id)::integer as observed_days
  from public.gsc_history_facts f
  join selected_days d on d.id=f.day_id
  where f.grain='query_page'
  group by f.query,f.page
  having sum(f.impressions)>=100 and count(distinct f.day_id)>=3
 ),
 eligible_queries as (
  select q.*
  from grouped_queries q
  where q.position between 4 and 20
 )
 select jsonb_build_object(
  'days',coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',d.id,
    'date',d.data_date,
    'importedAt',d.imported_at,
    'pageLimited',d.page_limited,
    'queryLimited',d.query_limited
   ) order by d.data_date)
   from selected_days d
  ),'[]'::jsonb),
  'propertyRows',coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',f.id,
    'dayId',f.day_id,
    'page',f.page,
    'query',f.query,
    'clicks',f.clicks,
    'impressions',f.impressions,
    'position',f.position
   ) order by d.data_date,f.id)
   from public.gsc_history_facts f
   join selected_days d on d.id=f.day_id
   where f.grain='property'
  ),'[]'::jsonb),
  'queryPageRollups',coalesce((
   select jsonb_agg(jsonb_build_object(
    'query',q.query,
    'page',q.page,
    'clicks',q.clicks,
    'impressions',q.impressions,
    'position',q.position,
    'ctr',case when q.impressions>0 then q.clicks::double precision/q.impressions::double precision else 0 end,
    'observedDays',q.observed_days
   ) order by q.impressions desc,q.query,q.page)
   from eligible_queries q
  ),'[]'::jsonb)
 );
$$;

revoke all on function public.get_gsc_search_insights(uuid,uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.get_gsc_search_insights(uuid,uuid,text,date,date) to service_role;
