-- Durable, service-only GSC work. Saved history remains the source of coverage.
create table public.gsc_sync_jobs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 client_id uuid not null references public.clients(id) on delete cascade,
 property text not null check (length(property)>0),
 status text not null default 'pending' check (status in ('pending','running','idle')),
 available_at timestamptz not null default now(),
 lease_token uuid,
 lease_until timestamptz,
 attempts integer not null default 0 check (attempts>=0),
 updated_at timestamptz not null default now(),
 unique(client_id,property)
);
create index gsc_sync_jobs_ready_idx on public.gsc_sync_jobs(available_at,updated_at);
alter table public.gsc_sync_jobs enable row level security;
revoke all on public.gsc_sync_jobs from anon,authenticated;
grant all on public.gsc_sync_jobs to service_role;

-- Enqueue is idempotent, honors retry cooldowns, and never steals a live lease.
create function public.enqueue_gsc_sync(p_organization_id uuid,p_client_id uuid)
returns boolean language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_property text;
begin
 select i.credentials->>'site_url' into v_property from public.client_integrations i
 join public.clients c on c.id=i.client_id and c.organization_id=i.organization_id
 where i.organization_id=p_organization_id and i.client_id=p_client_id and i.service='gsc'
 and i.sync_status in ('active','error') and length(i.credentials->>'site_url')>0;
 if v_property is null then return false; end if;
 insert into public.gsc_sync_jobs(organization_id,client_id,property)
 values(p_organization_id,p_client_id,v_property)
 on conflict(client_id,property) do update set status='pending',available_at=now()
 where gsc_sync_jobs.status='idle' and gsc_sync_jobs.available_at<=now();
 return true;
end;
$$;

create function public.claim_gsc_sync(p_client_id uuid default null)
returns setof public.gsc_sync_jobs language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 return query with candidate as (
 select j.id from public.gsc_sync_jobs j
 join public.client_integrations i on i.client_id=j.client_id and i.organization_id=j.organization_id
 join public.clients c on c.id=j.client_id and c.organization_id=j.organization_id
 where i.service='gsc' and i.sync_status in ('active','error') and i.credentials->>'site_url'=j.property
 and (p_client_id is null or j.client_id=p_client_id)
 and j.available_at<=now() and (j.status='pending' or (j.status='running' and j.lease_until<now()))
 order by j.updated_at,j.id for update of j skip locked limit 1
 ) update public.gsc_sync_jobs j set status='running',lease_token=gen_random_uuid(),
 lease_until=now()+interval '90 seconds',attempts=j.attempts+1,updated_at=now()
 from candidate where j.id=candidate.id returning j.*;
end;
$$;
revoke all on function public.enqueue_gsc_sync(uuid,uuid),public.claim_gsc_sync(uuid) from public,anon,authenticated;
grant execute on function public.enqueue_gsc_sync(uuid,uuid),public.claim_gsc_sync(uuid) to service_role;
