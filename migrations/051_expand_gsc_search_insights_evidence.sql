-- Expand the read-only Search Insights aggregate with page, deeper-visibility,
-- and overlapping-URL evidence. These are investigation candidates, not
-- diagnoses or predictions.
create or replace function public.get_gsc_search_insights(
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
 grouped_query_pages as materialized (
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
 ),
 grouped_pages as (
  select f.page,
   sum(f.clicks) as clicks,
   sum(f.impressions) as impressions,
   case when sum(f.impressions)>0
    then sum(f.position*f.impressions)/sum(f.impressions)
    else null
   end as position,
   count(distinct f.day_id)::integer as observed_days
  from public.gsc_history_facts f
  join selected_days d on d.id=f.day_id
  where f.grain='page'
  group by f.page
 ),
 ranking_queries as (
  select q.* from grouped_query_pages q
  where q.impressions>=100 and q.observed_days>=3 and q.position between 4 and 20
 ),
 visibility_queries as (
  select q.* from grouped_query_pages q
  where q.impressions>=100 and q.observed_days>=3 and q.position>20 and q.position<=50
 ),
 eligible_pages as (
  select p.* from grouped_pages p
  where p.impressions>=250 and p.observed_days>=3 and p.position between 4 and 50
 ),
 overlap_pages as materialized (
  select q.* from grouped_query_pages q
  where q.impressions>=10 and q.observed_days>=2
 ),
 overlap_queries as (
  select q.query,
   sum(q.clicks) as clicks,
   sum(q.impressions) as impressions,
   sum(q.position*q.impressions)/sum(q.impressions) as position,
   max(q.observed_days)::integer as observed_days
  from overlap_pages q
  group by q.query
  having count(*)>=2 and sum(q.impressions)>=100
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
   from ranking_queries q
  ),'[]'::jsonb),
  'pageRollups',coalesce((
   select jsonb_agg(jsonb_build_object(
    'page',p.page,
    'clicks',p.clicks,
    'impressions',p.impressions,
    'position',p.position,
    'ctr',case when p.impressions>0 then p.clicks::double precision/p.impressions::double precision else 0 end,
    'observedDays',p.observed_days
   ) order by p.impressions desc,p.page)
   from eligible_pages p
  ),'[]'::jsonb),
  'visibilityRollups',coalesce((
   select jsonb_agg(jsonb_build_object(
    'query',q.query,
    'page',q.page,
    'clicks',q.clicks,
    'impressions',q.impressions,
    'position',q.position,
    'ctr',case when q.impressions>0 then q.clicks::double precision/q.impressions::double precision else 0 end,
    'observedDays',q.observed_days
   ) order by q.impressions desc,q.query,q.page)
   from visibility_queries q
  ),'[]'::jsonb),
  'overlapRollups',coalesce((
   select jsonb_agg(jsonb_build_object(
    'query',o.query,
    'clicks',o.clicks,
    'impressions',o.impressions,
    'position',o.position,
    'ctr',case when o.impressions>0 then o.clicks::double precision/o.impressions::double precision else 0 end,
    'observedDays',o.observed_days,
    'pages',(
     select jsonb_agg(jsonb_build_object(
      'query',p.query,
      'page',p.page,
      'clicks',p.clicks,
      'impressions',p.impressions,
      'position',p.position,
      'ctr',case when p.impressions>0 then p.clicks::double precision/p.impressions::double precision else 0 end,
      'observedDays',p.observed_days
     ) order by p.impressions desc,p.page)
     from overlap_pages p where p.query=o.query
    )
   ) order by o.impressions desc,o.query)
   from overlap_queries o
  ),'[]'::jsonb)
 );
$$;

revoke all on function public.get_gsc_search_insights(uuid,uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.get_gsc_search_insights(uuid,uuid,text,date,date) to service_role;
