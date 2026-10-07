begin;

-- Accepted agreement terms, effective history, and explicit future-work funding.
-- No automatic commercial backfill: staff record verified original terms first.
create table public.client_agreements (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id),
    client_id uuid not null references public.clients(id),
    previous_id uuid references public.client_agreements(id),
    request_id uuid not null unique,
    request_payload jsonb not null,
    kind text not null check (kind in ('initial','renewal','amendment')),
    title text not null check (length(trim(title)) between 1 and 160),
    starts_on date not null,
    ends_on date,
    mode text not null check (mode in ('monthly','custom')),
    hours numeric(8,2) check (hours >= 0 and hours <= 9999),
    hours_mode text not null check (hours_mode in ('committed','allowance','estimate')),
    proration text not null check (proration in ('daily','full_period')),
    timezone text not null,
    scope text not null check (length(trim(scope)) between 1 and 12000),
    services jsonb not null default '[]',
    evidence text check (length(evidence) <= 2000),
    note text check (length(note) <= 2000),
    plan_snapshot jsonb,
    recorded_at timestamptz not null default now(),
    recorded_by uuid not null references public.users(id),
    cancelled_at timestamptz,
    check (ends_on is null or ends_on >= starts_on),
    check ((mode = 'monthly' and hours is not null and hours_mode <> 'estimate') or (mode = 'custom' and hours_mode <> 'committed')),
    check ((kind = 'initial' and previous_id is null) or (kind <> 'initial' and previous_id is not null)),
    unique (id, organization_id, client_id)
);
create unique index client_agreements_initial_idx on public.client_agreements(client_id) where kind = 'initial' and cancelled_at is null;
create unique index client_agreements_successor_idx on public.client_agreements(previous_id) where previous_id is not null and cancelled_at is null;
create index client_agreements_period_idx on public.client_agreements(organization_id, client_id, starts_on);

create table public.client_agreement_work_funding (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id),
    client_id uuid not null references public.clients(id),
    task_id uuid not null references public.tasks(id),
    agreement_id uuid not null,
    transition_id uuid not null references public.client_agreements(id),
    effective_on date not null,
    recorded_at timestamptz not null default now(),
    recorded_by uuid not null references public.users(id),
    foreign key (agreement_id,organization_id,client_id) references public.client_agreements(id,organization_id,client_id),
    unique(task_id,transition_id)
);
create index client_agreement_funding_task_idx on public.client_agreement_work_funding(task_id,effective_on desc);

alter table public.tasks add column agreement_id uuid references public.client_agreements(id);
alter table public.time_logs add column agreement_id uuid references public.client_agreements(id);
alter table public.deliverable_commitments add column agreement_id uuid references public.client_agreements(id);
alter table public.deliverables add column agreement_id uuid references public.client_agreements(id);
alter table public.deliverables add column generation_key text;
create unique index deliverables_generation_key_idx on public.deliverables(generation_key);
create index time_logs_agreement_period_idx on public.time_logs(agreement_id,date);
create index commitments_agreement_idx on public.deliverable_commitments(agreement_id);

alter table public.client_agreements enable row level security;
alter table public.client_agreement_work_funding enable row level security;
create policy agreements_read on public.client_agreements for select to authenticated
    using (organization_id in (select public.get_user_org_ids()));
create policy agreement_funding_read on public.client_agreement_work_funding for select to authenticated
    using (organization_id in (select public.get_user_org_ids()));
revoke all on public.client_agreements,public.client_agreement_work_funding from anon,authenticated;
grant select on public.client_agreements,public.client_agreement_work_funding to authenticated;
grant all on public.client_agreements,public.client_agreement_work_funding to service_role;

-- The original agreed end remains immutable. Successors shorten operational coverage.
create function public.agreement_coverage_end(p_id uuid) returns date
language sql stable security definer set search_path = pg_catalog,public as $$
    select least(a.ends_on, (select min(b.starts_on)-1 from public.client_agreements b where b.previous_id=a.id and b.cancelled_at is null))
    from public.client_agreements a where a.id=p_id and a.cancelled_at is null;
$$;
create function public.agreement_at_date(p_client uuid,p_date date) returns uuid
language sql stable security definer set search_path = pg_catalog,public as $$
    select a.id from public.client_agreements a where a.client_id=p_client and a.cancelled_at is null
        and a.starts_on<=p_date and (public.agreement_coverage_end(a.id) is null or public.agreement_coverage_end(a.id)>=p_date)
    order by a.starts_on desc limit 1;
$$;
revoke all on function public.agreement_coverage_end(uuid),public.agreement_at_date(uuid,date) from public,anon,authenticated;
grant execute on function public.agreement_coverage_end(uuid),public.agreement_at_date(uuid,date) to service_role;

-- Classification never trusts an agreement ID supplied by a time-entry writer.
create function public.classify_agreement_time() returns trigger
language plpgsql security definer set search_path = pg_catalog,public as $$
declare v_agreement uuid;
begin
    if new.client_id is null then new.agreement_id := null; return new; end if;
    select f.agreement_id into v_agreement from public.client_agreement_work_funding f
        join public.client_agreements transition on transition.id=f.transition_id and transition.cancelled_at is null
        where f.task_id=new.task_id and f.client_id=new.client_id and f.organization_id=new.organization_id and f.effective_on<=new.date
        order by f.effective_on desc,f.recorded_at desc limit 1;
    new.agreement_id := coalesce(v_agreement,public.agreement_at_date(new.client_id,new.date));
    if new.agreement_id is null then
        select a.id into new.agreement_id from public.client_agreements a join public.clients c on c.id=a.client_id
        where a.client_id=new.client_id and a.organization_id=new.organization_id and a.kind='initial' and a.cancelled_at is null
        and c.setup_scope->>'onboardingBudget'='first_month' and new.date>=c.onboarding_date and new.date<a.starts_on;
    end if;
    if new.agreement_id is not null and not exists(select 1 from public.client_agreements a where a.id=new.agreement_id and a.client_id=new.client_id and a.organization_id=new.organization_id) then
        raise exception 'Agreement does not belong to this time entry';
    end if;
    return new;
end;
$$;
create trigger time_logs_agreement_scope before insert or update of date,task_id,client_id,organization_id,agreement_id on public.time_logs
    for each row execute function public.classify_agreement_time();

create function public.assign_work_agreement() returns trigger
language plpgsql security definer set search_path = pg_catalog,public as $$
declare v_timezone text;
begin
    if tg_op='INSERT' and new.agreement_id is null then
        if tg_table_name='deliverable_commitments' and exists(select 1 from public.client_agreements where client_id=new.client_id) then raise exception 'Use Change scope to add accepted agreement outputs'; end if;
        if tg_table_name='deliverables' and new.commitment_id is not null then
            select agreement_id into new.agreement_id from public.deliverable_commitments where id=new.commitment_id and client_id=new.client_id and organization_id=new.organization_id;
        end if;
        if new.agreement_id is null then
            select timezone into v_timezone from public.client_agreements where client_id=new.client_id and cancelled_at is null order by starts_on desc limit 1;
            new.agreement_id := public.agreement_at_date(new.client_id,(now() at time zone coalesce(v_timezone,'UTC'))::date);
        end if;
    end if;
    if tg_op='UPDATE' and old.agreement_id is not null and new.agreement_id is distinct from old.agreement_id then raise exception 'Original agreement attribution is preserved'; end if;
    if new.agreement_id is not null and not exists(select 1 from public.client_agreements a where a.id=new.agreement_id and a.client_id=new.client_id and a.organization_id=new.organization_id) then raise exception 'Agreement does not belong to this work'; end if;
    return new;
end;
$$;
create trigger tasks_agreement_origin before insert or update of agreement_id,client_id,organization_id on public.tasks for each row execute function public.assign_work_agreement();
create trigger deliverables_agreement_origin before insert or update of agreement_id,client_id,organization_id on public.deliverables for each row execute function public.assign_work_agreement();
create trigger commitments_agreement_origin before insert or update of agreement_id,client_id,organization_id on public.deliverable_commitments for each row execute function public.assign_work_agreement();

-- Direct API writers cannot attach a new promise to already accepted terms.
-- The confirm RPC runs as its trusted definer; ordinary PostgREST writes do not.
create function public.require_accepted_output_transaction() returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
    if current_user in ('authenticated','anon') and new.agreement_id is not null then raise exception 'Use Change scope to add accepted agreement outputs'; end if;
    return new;
end;
$$;
create trigger commitments_require_agreement_transaction before insert or update of agreement_id on public.deliverable_commitments for each row execute function public.require_accepted_output_transaction();

create function public.protect_agreement_commitment() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
    if old.agreement_id is not null then
        if tg_op='DELETE' then raise exception 'Accepted agreement outputs cannot be deleted'; end if;
        if new.title is distinct from old.title or new.counts_toward_hours is distinct from old.counts_toward_hours or new.is_active is distinct from old.is_active or new.quantity_per_month is distinct from old.quantity_per_month or new.total_quantity is distinct from old.total_quantity or new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on or new.cadence is distinct from old.cadence or new.engagement_model is distinct from old.engagement_model or new.type is distinct from old.type or new.subtype is distinct from old.subtype or new.custom_fields is distinct from old.custom_fields then
            raise exception 'Use Change scope to revise accepted agreement outputs';
        end if;
    end if;
    if tg_op='DELETE' then return old; end if; return new;
end;
$$;
create trigger commitments_protect_accepted_scope before update or delete on public.deliverable_commitments for each row execute function public.protect_agreement_commitment();

-- Preserve setup-time commitments once commercial history is recorded.
create or replace function public.activate_client_setup_scope() returns trigger language plpgsql security invoker set search_path = pg_catalog,public as $$
begin
    if new.setup_scope is null then return new; end if;
    if new.status='active' and (new.launch_date is null or new.launch_date>current_date or new.launch_date<new.onboarding_date) then raise exception 'Confirm an actual launched date before activating this client'; end if;
    if exists(select 1 from public.client_agreements where client_id=new.id) then return new; end if;
    if new.status is distinct from old.status or new.launch_date is distinct from old.launch_date or new.setup_scope is distinct from old.setup_scope then
        update public.deliverable_commitments set is_active=new.status='active' and new.setup_scope->>'mode'='monthly' and (new.setup_scope->>'contentPieces')::integer>0,starts_on=coalesce(new.launch_date,new.onboarding_date),quantity_per_month=(new.setup_scope->>'contentPieces')::integer
        where client_id=new.id and organization_id=new.organization_id and custom_fields->>'setupManaged'='true';
        if not found and new.setup_scope->>'mode'='monthly' and (new.setup_scope->>'contentPieces')::integer>0 then
            insert into public.deliverable_commitments(organization_id,client_id,type,title,quantity_per_month,cadence,engagement_model,starts_on,is_active,counts_toward_hours,custom_fields)
            values(new.organization_id,new.id,'Content','Content pieces',(new.setup_scope->>'contentPieces')::integer,'monthly','Retainer',coalesce(new.launch_date,new.onboarding_date),new.status='active',false,'{"setupManaged":true,"fulfillment":"delivered","mixedContent":true}');
        end if;
    end if;
    return new;
end;
$$;

create function public.protect_agreement_client_terms() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
    if exists(select 1 from public.client_agreements where client_id=old.id) and
       (new.seo_hours is distinct from old.seo_hours or new.engagement_model is distinct from old.engagement_model or new.setup_scope is distinct from old.setup_scope or new.blogs_due_per_month is distinct from old.blogs_due_per_month or new.campaign_total_hours is distinct from old.campaign_total_hours or new.campaign_start is distinct from old.campaign_start or new.campaign_end is distinct from old.campaign_end) then
        raise exception 'Use Manage agreements to change commercial terms';
    end if;
    if new.organization_id is distinct from old.organization_id and exists(select 1 from public.client_agreements where client_id=old.id) then raise exception 'An accepted client workspace cannot be moved to another organization'; end if;
    return new;
end;
$$;
create trigger clients_protect_agreement_terms before update on public.clients for each row execute function public.protect_agreement_client_terms();

create function public.agreement_review_token(p_client uuid) returns text
language sql stable security definer set search_path=pg_catalog,public as $$
    select md5(jsonb_build_object(
        'client',(select to_jsonb(c) from public.clients c where c.id=p_client),
        'agreements',(select jsonb_agg(to_jsonb(a) order by a.starts_on) from public.client_agreements a where a.client_id=p_client),
        'commitments',(select jsonb_agg(to_jsonb(c) order by c.id) from public.deliverable_commitments c where c.client_id=p_client),
        'tasks',(select jsonb_agg(jsonb_build_array(t.id,t.title,t.status) order by t.id) from public.tasks t where t.client_id=p_client and t.status not in ('done','approved')),
        'plan',(select jsonb_agg(to_jsonb(i) order by i.id) from public.marketing_plan_items i where i.client_id=p_client),
        'planHeader',(select jsonb_agg(to_jsonb(p) order by p.id) from public.marketing_plans p where p.client_id=p_client),
        'time',(select jsonb_agg(jsonb_build_array(t.id,t.date,t.hours,t.task_id,t.status,t.import_status,t.counts_toward_budget) order by t.id) from public.time_logs t where t.client_id=p_client),
        'reports',(select jsonb_agg(jsonb_build_array(r.id,r.status,r.report_month) order by r.id) from public.reports r where r.client_id=p_client)
    )::text);
$$;
revoke all on function public.agreement_review_token(uuid) from public,anon,authenticated;

create function public.preview_client_agreement(p_client uuid,p_start date) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_org uuid;
begin
    select organization_id into v_org from public.clients where id=p_client;
    if auth.uid() is null or not exists(select 1 from public.organization_members where organization_id=v_org and user_id=auth.uid() and role in ('owner','admin')) then raise exception 'Only organization owners and admins can manage agreements'; end if;
    return jsonb_build_object('token',public.agreement_review_token(p_client),
        'openTasks',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status) order by created_at) from public.tasks where client_id=p_client and organization_id=v_org and status not in ('done','approved')),'[]'::jsonb),
        'affectedHours',coalesce((select sum(hours) from public.time_logs where client_id=p_client and organization_id=v_org and date>=p_start and status='logged' and import_status='mapped' and counts_toward_budget),0),
        'affectedReports',(select count(*) from public.reports where client_id=p_client and organization_id=v_org and status='published' and report_month>=to_char(p_start,'YYYY-MM')),
        'commitmentCount',(select count(*) from public.deliverable_commitments where client_id=p_client and organization_id=v_org));
end;
$$;
revoke all on function public.preview_client_agreement(uuid,date) from public,anon;
grant execute on function public.preview_client_agreement(uuid,date) to authenticated;

create function public.confirm_client_agreement(p_client uuid,p_request uuid,p_input jsonb,p_token text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
    v_org uuid; v_client public.clients%rowtype; v_old public.client_agreements%rowtype; v_existing public.client_agreements%rowtype;
    v_id uuid:=gen_random_uuid(); v_start date; v_end date; v_hours numeric; v_service jsonb; v_task record; v_plan jsonb; v_old_id uuid; v_cadence text;
    v_source public.deliverable_commitments%rowtype; v_commitment uuid; v_root text; v_quantity integer; v_issued integer; v_services jsonb:='[]'::jsonb;
begin
    select * into v_client from public.clients where id=p_client for update; v_org:=v_client.organization_id;
    if auth.uid() is null or not exists(select 1 from public.organization_members where organization_id=v_org and user_id=auth.uid() and role in ('owner','admin')) then raise exception 'Only organization owners and admins can manage agreements'; end if;
    select * into v_existing from public.client_agreements where request_id=p_request;
    if found then
        if v_existing.client_id<>p_client or v_existing.organization_id<>v_org or v_existing.request_payload<>p_input then raise exception 'Request already used with different terms'; end if;
        return v_existing.id;
    end if;
    if p_token is null or p_token<>public.agreement_review_token(p_client) then raise exception 'Agreement review is out of date. Review the terms again'; end if;
    if p_input is null or jsonb_typeof(p_input)<>'object' or length(p_input::text)>100000 then raise exception 'Invalid agreement'; end if;
    v_start:=(p_input->>'startsOn')::date; v_end:=nullif(p_input->>'endsOn','')::date; v_hours:=nullif(p_input->>'hours','')::numeric;
    if v_start is null or (v_end is not null and v_end<v_start) then raise exception 'Choose valid agreement dates'; end if;
    if coalesce(p_input->>'kind','') not in ('initial','renewal','amendment') or coalesce(p_input->>'mode','') not in ('monthly','custom') or coalesce(p_input->>'hoursMode','') not in ('committed','allowance','estimate') or coalesce(p_input->>'proration','') not in ('daily','full_period') then raise exception 'Invalid agreement terms'; end if;
    if not exists(select 1 from pg_timezone_names where name=p_input->>'timezone') then raise exception 'Choose a valid time zone'; end if;
    if v_hours='NaN'::numeric or v_hours<0 or v_hours>9999 then raise exception 'Invalid hours'; end if;
    if length(coalesce(trim(p_input->>'scope'),'')) not between 1 and 12000 or length(coalesce(trim(p_input->>'title'),'')) not between 1 and 160 then raise exception 'Describe and name the agreed scope'; end if;
    if jsonb_typeof(p_input->'services') is distinct from 'array' or jsonb_array_length(p_input->'services')>50 or jsonb_typeof(p_input->'fundedTaskIds') is distinct from 'array' or jsonb_array_length(p_input->'fundedTaskIds')>250 then raise exception 'Invalid scope selections'; end if;
    if (select count(*) from jsonb_array_elements_text(p_input->'fundedTaskIds'))<>(select count(distinct value) from jsonb_array_elements_text(p_input->'fundedTaskIds')) then raise exception 'Duplicate task selections'; end if;
    if (select count(*) from jsonb_array_elements(p_input->'services') s where s->>'sourceId' is not null)<>(select count(distinct s->>'sourceId') from jsonb_array_elements(p_input->'services') s where s->>'sourceId' is not null) then raise exception 'Duplicate output selections'; end if;
    select * into v_old from public.client_agreements where client_id=p_client and cancelled_at is null order by starts_on desc limit 1;
    if p_input->>'kind'='initial' then
        if v_old.id is not null or nullif(p_input->>'previousId','') is not null then raise exception 'Original agreement already recorded'; end if;
        if v_start>(now() at time zone (p_input->>'timezone'))::date then raise exception 'Record the existing agreement before scheduling a renewal'; end if;
    else
        if v_old.id is null or v_old.id is distinct from nullif(p_input->>'previousId','')::uuid then raise exception 'Review the latest agreement before changing terms'; end if;
        if v_start<=v_old.starts_on then raise exception 'The effective date must follow the previous agreement start'; end if;
        if v_old.timezone<>p_input->>'timezone' then raise exception 'Keep the agreement time zone consistent'; end if;
        if p_input->>'kind'='renewal' and (v_old.ends_on is null or v_start<=v_old.ends_on) then raise exception 'Renewal must follow the previous end date. Use a scope amendment within the term'; end if;
        if p_input->>'kind'='amendment' and (v_old.ends_on is not null and v_start>v_old.ends_on or v_end is distinct from v_old.ends_on) then raise exception 'A scope amendment keeps the current term end date'; end if;
        v_old_id:=v_old.id;
    end if;
    if exists(select 1 from jsonb_array_elements_text(p_input->'fundedTaskIds') picked where not exists(select 1 from public.tasks t where t.id=picked.value::uuid and t.client_id=p_client and t.organization_id=v_org and t.status not in ('done','approved'))) then raise exception 'Selected work is no longer available'; end if;
    select jsonb_build_object('plan',to_jsonb(p),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order,i.id) from public.marketing_plan_items i where i.marketing_plan_id=p.id),'[]'::jsonb)) into v_plan from public.marketing_plans p where p.client_id=p_client and p.organization_id=v_org;
    v_plan:=coalesce(v_plan,'{}'::jsonb)||jsonb_build_object('commitments',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.deliverable_commitments c where c.client_id=p_client and c.organization_id=v_org),'[]'::jsonb));
    insert into public.client_agreements(id,organization_id,client_id,previous_id,request_id,request_payload,kind,title,starts_on,ends_on,mode,hours,hours_mode,proration,timezone,scope,services,evidence,note,plan_snapshot,recorded_by)
    values(v_id,v_org,p_client,v_old_id,p_request,p_input,p_input->>'kind',trim(p_input->>'title'),v_start,v_end,p_input->>'mode',v_hours,p_input->>'hoursMode',p_input->>'proration',p_input->>'timezone',trim(p_input->>'scope'),p_input->'services',nullif(trim(p_input->>'evidence'),''),nullif(trim(p_input->>'note'),''),v_plan,auth.uid());

    for v_service in select value from jsonb_array_elements(p_input->'services') loop
        v_cadence:=v_service->>'cadence';
        if length(coalesce(trim(v_service->>'title'),'')) not between 1 and 200 or coalesce(v_service->>'type','') not in ('Content','Backlink','GBP','Other') or coalesce(v_cadence,'') not in ('monthly','one_time') or (v_service->>'quantity')::numeric not between 1 and 999 or (v_service->>'quantity')::numeric<>trunc((v_service->>'quantity')::numeric) or v_service->>'quantity' is null then raise exception 'Invalid deliverable quantity or service'; end if;
        if p_input->>'mode'='custom' and v_cadence='monthly' then raise exception 'Custom scope uses one-time outputs'; end if;
        if v_service->>'sourceId' is not null and not exists(select 1 from public.deliverable_commitments where id=(v_service->>'sourceId')::uuid and organization_id=v_org and client_id=p_client) then raise exception 'Output does not belong to this client'; end if;
        if p_input->>'kind'='initial' and v_service->>'sourceId' is not null and not exists(select 1 from public.deliverable_commitments where id=(v_service->>'sourceId')::uuid and (case when cadence='one_time' then total_quantity else quantity_per_month end)=(v_service->>'quantity')::numeric and cadence=v_cadence and type=v_service->>'type' and title=v_service->>'title' and counts_toward_hours=coalesce((v_service->>'countsTowardHours')::boolean,false)) then raise exception 'Original outputs must match existing commitments. Record a scope change to revise them'; end if;
        select * into v_source from public.deliverable_commitments where id=nullif(v_service->>'sourceId','')::uuid and client_id=p_client and organization_id=v_org;
        if p_input->>'kind'='initial' and v_source.id is not null or p_input->>'kind'='amendment' and v_source.id is not null and v_source.cadence=v_cadence and v_source.type=v_service->>'type' and v_source.subtype is not distinct from v_service->>'subtype' and v_source.title=v_service->>'title' and v_source.counts_toward_hours=coalesce((v_service->>'countsTowardHours')::boolean,false) and (case when v_cadence='one_time' then coalesce((v_source.custom_fields->>'agreedTotalQuantity')::integer,v_source.total_quantity) else v_source.quantity_per_month end)=(v_service->>'quantity')::numeric then
            -- An hours-only amendment keeps the existing outputs and their identity.
            v_commitment:=v_source.id;
        else
            v_commitment:=gen_random_uuid();
            v_root:=case when p_input->>'kind'='amendment' and v_source.cadence=v_cadence and v_source.type=v_service->>'type' and v_source.subtype is not distinct from v_service->>'subtype' then coalesce(v_source.custom_fields->>'agreementOutputRoot',v_source.id::text) else v_commitment::text end;
            v_quantity:=(v_service->>'quantity')::integer;
            if p_input->>'kind'='amendment' and v_cadence='one_time' and v_source.cadence='one_time' and v_root<>v_commitment::text then
                select count(*) into v_issued from public.deliverables d join public.deliverable_commitments c on c.id=d.commitment_id where c.client_id=p_client and c.organization_id=v_org and (c.id::text=v_root or c.custom_fields->>'agreementOutputRoot'=v_root);
                v_quantity:=greatest(0,v_quantity-v_issued);
            end if;
            insert into public.deliverable_commitments(id,organization_id,client_id,agreement_id,type,subtype,title,quantity_per_month,cadence,engagement_model,total_quantity,starts_on,ends_on,is_active,counts_toward_hours,custom_fields)
            values(v_commitment,v_org,p_client,v_id,v_service->>'type',v_service->>'subtype',v_service->>'title',case when v_cadence='monthly' then (v_service->>'quantity')::numeric else 0 end,v_cadence,case when p_input->>'mode'='monthly' then 'Retainer' else 'Campaign' end,case when v_cadence='one_time' then v_quantity end,v_start,v_end,true,coalesce((v_service->>'countsTowardHours')::boolean,false),jsonb_build_object('agreementManaged',true,'agreementOutputRoot',v_root,'agreedTotalQuantity',(v_service->>'quantity')::integer));
        end if;
        v_services:=v_services||jsonb_build_array(v_service||jsonb_build_object('sourceId',v_commitment));
    end loop;
    update public.client_agreements set services=v_services where id=v_id;
    if p_input->>'kind'='initial' then
        -- Adopt existing records without recreating work or changing original quantities.
        update public.deliverable_commitments set agreement_id=v_id where client_id=p_client and organization_id=v_org and agreement_id is null and starts_on<=coalesce(v_end,'infinity'::date) and (ends_on is null or ends_on>=v_start);
        update public.deliverables d set agreement_id=v_id from public.deliverable_commitments c where d.commitment_id=c.id and c.agreement_id=v_id and d.client_id=p_client and d.organization_id=v_org and d.agreement_id is null;
        update public.tasks set agreement_id=v_id where client_id=p_client and organization_id=v_org and agreement_id is null and created_at::date>=v_start and created_at::date<=coalesce(v_end,'infinity'::date);
    else
        for v_task in select id,agreement_id from public.tasks where client_id=p_client and organization_id=v_org and status not in ('done','approved') loop
            insert into public.client_agreement_work_funding(organization_id,client_id,task_id,agreement_id,transition_id,effective_on,recorded_by)
            values(v_org,p_client,v_task.id,case when p_input->'fundedTaskIds' ? v_task.id::text then v_id else coalesce((select f.agreement_id from public.client_agreement_work_funding f join public.client_agreements a on a.id=f.transition_id and a.cancelled_at is null where f.task_id=v_task.id and f.effective_on<=v_start order by f.effective_on desc,f.recorded_at desc limit 1),v_task.agreement_id,v_old_id) end,v_id,v_start,auth.uid());
        end loop;
    end if;
    -- The reviewed effective date reclassifies affected entries; original work dates remain unchanged.
    update public.time_logs set agreement_id=null where client_id=p_client and organization_id=v_org and date>=case when p_input->>'kind'='initial' and v_client.setup_scope->>'onboardingBudget'='first_month' then least(v_start,v_client.onboarding_date) else v_start end;
    insert into public.client_activity_log(organization_id,client_id,event_type,actor_id,operation_id,metadata)
    values(v_org,p_client,'agreement.'||(p_input->>'kind'),auth.uid(),p_request,jsonb_build_object('agreementId',v_id,'previousId',v_old_id,'effectiveDate',v_start,'recordedAt',now()));
    return v_id;
end;
$$;
revoke all on function public.confirm_client_agreement(uuid,uuid,jsonb,text) from public,anon;
grant execute on function public.confirm_client_agreement(uuid,uuid,jsonb,text) to authenticated;

create function public.cancel_scheduled_agreement(p_client uuid,p_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_agreement public.client_agreements%rowtype;
begin
    perform 1 from public.clients where id=p_client for update;
    select * into v_agreement from public.client_agreements where id=p_id and client_id=p_client for update;
    if auth.uid() is null or not exists(select 1 from public.organization_members where organization_id=v_agreement.organization_id and user_id=auth.uid() and role in ('owner','admin')) then raise exception 'Only organization owners and admins can manage agreements'; end if;
    if v_agreement.cancelled_at is not null then return; end if;
    if v_agreement.starts_on<=(now() at time zone v_agreement.timezone)::date or exists(select 1 from public.client_agreements where previous_id=p_id and cancelled_at is null) then raise exception 'Only the latest future agreement can be cancelled'; end if;
    update public.client_agreements set cancelled_at=now() where id=p_id;
    update public.time_logs set agreement_id=null where client_id=p_client and date>=v_agreement.starts_on;
    insert into public.client_activity_log(organization_id,client_id,event_type,actor_id,metadata) values(v_agreement.organization_id,p_client,'agreement.cancelled',auth.uid(),jsonb_build_object('agreementId',p_id));
end;
$$;
revoke all on function public.cancel_scheduled_agreement(uuid,uuid) from public,anon;
grant execute on function public.cancel_scheduled_agreement(uuid,uuid) to authenticated;

-- Serialize custom generation with acceptance. A cron that started before an
-- amendment must re-check coverage and the total while holding the client lock.
create function public.guard_custom_agreement_generation() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_commitment public.deliverable_commitments%rowtype;
    v_agreement public.client_agreements%rowtype;
    v_output_agreement uuid; v_next uuid; v_end date; v_day date; v_root text; v_total integer; v_issued integer;
begin
    if new.generated_by is distinct from 'cron' or new.commitment_id is null then return new; end if;
    select * into v_commitment from public.deliverable_commitments where id=new.commitment_id;
    if v_commitment.agreement_id is null or v_commitment.cadence<>'one_time' then return new; end if;
    if v_commitment.client_id<>new.client_id or v_commitment.organization_id<>new.organization_id then raise exception 'Output does not belong to this work'; end if;
    perform 1 from public.clients where id=v_commitment.client_id for update;
    select * into v_agreement from public.client_agreements where id=v_commitment.agreement_id;
    v_day:=(now() at time zone v_agreement.timezone)::date;
    if v_agreement.cancelled_at is not null or v_commitment.starts_on>v_day or v_agreement.starts_on>v_day then return null; end if;
    v_output_agreement:=v_agreement.id;
    loop
        select id into v_next from public.client_agreements where previous_id=v_output_agreement and kind='amendment' and cancelled_at is null
            and exists(select 1 from jsonb_array_elements(services) s where s->>'sourceId'=v_commitment.id::text);
        exit when v_next is null;
        v_output_agreement:=v_next;
    end loop;
    v_end:=least(v_commitment.ends_on,public.agreement_coverage_end(v_output_agreement));
    if v_end<v_day or v_end<v_agreement.ends_on then return null; end if;
    v_root:=coalesce(v_commitment.custom_fields->>'agreementOutputRoot',v_commitment.id::text);
    v_total:=coalesce((v_commitment.custom_fields->>'agreedTotalQuantity')::integer,v_commitment.total_quantity,0);
    select count(*) into v_issued from public.deliverables d join public.deliverable_commitments c on c.id=d.commitment_id
        where c.organization_id=new.organization_id and c.client_id=new.client_id
        and (c.id::text=v_root or c.custom_fields->>'agreementOutputRoot'=v_root);
    if v_issued>=v_total then return null; end if;
    return new;
end;
$$;
revoke all on function public.guard_custom_agreement_generation() from public,anon,authenticated;
create trigger deliverables_guard_custom_generation before insert on public.deliverables for each row execute function public.guard_custom_agreement_generation();

commit;
