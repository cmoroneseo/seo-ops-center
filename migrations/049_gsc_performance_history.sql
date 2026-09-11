-- Daily finalized GSC snapshots. Property identity is exact and survives reassignment.
create table public.gsc_history_days (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 client_id uuid not null references public.clients(id) on delete cascade,
 property text not null check (length(property)>0),
 data_date date not null,
 search_type text not null default 'web' check (search_type='web'),
 fetched_at timestamptz not null,
 imported_at timestamptz not null default now(),
 page_limited boolean not null,
 query_limited boolean not null,
 unique(client_id,property,data_date,search_type)
);
create index gsc_history_days_org_idx on public.gsc_history_days(organization_id,client_id,data_date);
create table public.gsc_history_facts (
 id bigint generated always as identity primary key,
 day_id uuid not null references public.gsc_history_days(id) on delete cascade,
 grain text not null check (grain in ('property','page','query_page')),
 page text not null default '',
 query text not null default '',
 clicks bigint not null check (clicks>=0),
 impressions bigint not null check (impressions>=0),
 position double precision not null check (position>=0 and position<'Infinity'::float8),
 row_key text generated always as (md5(query || chr(1) || page)) stored,
 check ((grain='property' and page='' and query='') or (grain='page' and page<>'' and query='') or (grain='query_page' and page<>'' and query<>'')),
 unique(day_id,grain,row_key)
);
alter table public.gsc_history_days enable row level security;
alter table public.gsc_history_facts enable row level security;
create policy gsc_history_days_read on public.gsc_history_days for select to authenticated
 using (organization_id in (select public.get_user_org_ids()));
create policy gsc_history_facts_read on public.gsc_history_facts for select to authenticated
 using (exists (select 1 from public.gsc_history_days d where d.id=day_id and d.organization_id in (select public.get_user_org_ids())));
revoke all on public.gsc_history_days,public.gsc_history_facts from anon,authenticated;
grant select on public.gsc_history_days,public.gsc_history_facts to authenticated;
grant all on public.gsc_history_days,public.gsc_history_facts to service_role;
grant usage,select on sequence public.gsc_history_facts_id_seq to service_role;

-- One transaction: never replace a good snapshot with a half-imported day.
-- Service-only execution; organization and selected property are rechecked while locked.
create function public.replace_gsc_history_day(p_organization_id uuid,p_client_id uuid,p_property text,p_date date,p_fetched_at timestamptz,p_page_limited boolean,p_query_limited boolean,p_facts jsonb)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_id uuid; v_previous timestamptz;
begin
 if p_date > (now() at time zone 'America/Los_Angeles')::date-3 then raise exception 'History requires finalized dates at least three days old'; end if;
 if p_facts is null or jsonb_typeof(p_facts)<>'array' or jsonb_array_length(p_facts)>10001 then raise exception 'Invalid history batch'; end if;
 perform 1 from public.clients where id=p_client_id and organization_id=p_organization_id;
 if not found then raise exception 'Client organization mismatch'; end if;
 perform 1 from public.client_integrations where client_id=p_client_id and organization_id=p_organization_id and service='gsc' and sync_status in ('active','error') and credentials->>'site_url'=p_property for update;
 if not found then raise exception 'GSC property changed; restart import'; end if;
 select id,fetched_at into v_id,v_previous from public.gsc_history_days where client_id=p_client_id and property=p_property and data_date=p_date and search_type='web' for update;
 if found and v_previous>p_fetched_at then return false; end if;
 if v_id is null then
  insert into public.gsc_history_days(organization_id,client_id,property,data_date,fetched_at,page_limited,query_limited)
  values(p_organization_id,p_client_id,p_property,p_date,p_fetched_at,p_page_limited,p_query_limited) returning id into v_id;
 else
  update public.gsc_history_days set fetched_at=p_fetched_at,imported_at=now(),page_limited=p_page_limited,query_limited=p_query_limited where id=v_id;
  delete from public.gsc_history_facts where day_id=v_id;
 end if;
 insert into public.gsc_history_facts(day_id,grain,page,query,clicks,impressions,position)
 select v_id,x.grain,x.page,x.query,x.clicks,x.impressions,x.position from jsonb_to_recordset(p_facts) as x(grain text,page text,query text,clicks bigint,impressions bigint,position double precision);
 return true;
end;
$$;
revoke all on function public.replace_gsc_history_day(uuid,uuid,text,date,timestamptz,boolean,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.replace_gsc_history_day(uuid,uuid,text,date,timestamptz,boolean,boolean,jsonb) to service_role;
