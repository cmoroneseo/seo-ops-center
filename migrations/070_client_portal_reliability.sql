-- Explicit publishing, client-safe updates, and reliable communication.
-- All writes remain service-role only and server routes derive tenant scope.
alter table public.client_portal_plan_shares add column snapshot jsonb,
    add column version integer not null default 1 check (version > 0);
alter table public.client_portal_plan_decisions add column plan_share_id uuid
    references public.client_portal_plan_shares(id) on delete set null;
alter table public.client_portal_report_shares add column snapshot jsonb;
alter table public.client_portal_waiting_items add column due_date date,
    add column impact text check (impact is null or char_length(impact) between 1 and 500);

create table public.client_portal_updates (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    author_id uuid references public.users(id) on delete set null,
    author_label text not null check (char_length(author_label) between 1 and 80),
    shipped text not null check (char_length(shipped) between 1 and 2000),
    impact text not null check (char_length(impact) between 1 and 2000),
    next_steps text not null check (char_length(next_steps) between 1 and 2000),
    blockers text check (blockers is null or char_length(blockers) between 1 and 2000),
    next_update_on date not null,
    published_at timestamptz not null default now()
);
create index client_portal_updates_scope_idx on public.client_portal_updates (organization_id, client_id, published_at desc);

create table public.client_portal_settings (
    client_id uuid primary key references public.clients(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    analytics_shared boolean not null default false
);
create index client_portal_settings_org_idx on public.client_portal_settings (organization_id);

create table public.client_portal_delivery_updates (
    deliverable_id uuid primary key references public.deliverables(id) on delete cascade,
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    timing_note text not null check (char_length(timing_note) between 1 and 2000),
    revised_due_date date,
    responsibility text not null check (responsibility in ('team', 'client')),
    updated_at timestamptz not null default now()
);
create index client_portal_delivery_updates_scope_idx on public.client_portal_delivery_updates (organization_id, client_id);

create table public.client_portal_conversations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    subject_type text not null check (subject_type in ('general', 'plan', 'waiting_item')),
    subject_id uuid not null,
    owner_id uuid references public.users(id) on delete set null,
    handled_through_at timestamptz,
    unique (organization_id, client_id, subject_type, subject_id),
    check (subject_type <> 'general' or subject_id = client_id)
);

create table public.client_portal_visits (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    contact_id uuid not null references public.client_portal_contacts(id) on delete cascade,
    visited_on date not null default current_date,
    visited_at timestamptz not null default now(),
    unique (contact_id, visited_on)
);
create index client_portal_visits_scope_idx on public.client_portal_visits (organization_id, client_id, visited_at desc);

create table public.client_portal_email_queue (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    contact_id uuid not null references public.client_portal_contacts(id) on delete cascade,
    event_kind text not null check (event_kind in ('plan', 'report', 'reply', 'update', 'request')),
    event_id uuid not null,
    next_path text not null check (next_path ~ '^/portal(/|$)'),
    attempts integer not null default 0 check (attempts between 0 and 6),
    available_at timestamptz not null default now(),
    claimed_at timestamptz,
    sent_at timestamptz,
    canceled_at timestamptz,
    failed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (event_kind, event_id, contact_id)
);
create index client_portal_email_queue_pending_idx on public.client_portal_email_queue (available_at)
    where sent_at is null and canceled_at is null and failed_at is null;

do $$
declare name text;
begin
    foreach name in array array['client_portal_updates', 'client_portal_settings', 'client_portal_delivery_updates',
        'client_portal_conversations', 'client_portal_visits', 'client_portal_email_queue'] loop
        execute format('alter table public.%I enable row level security', name);
        execute format('create policy %I on public.%I for select to authenticated using (organization_id in (select public.get_user_org_ids()))', name || '_staff_select', name);
        execute format('revoke all on table public.%I from public, anon, authenticated', name);
        execute format('grant select on table public.%I to authenticated', name);
        execute format('grant all on table public.%I to service_role', name);
    end loop;
end $$;
-- Email delivery details are service-only, even for staff.
revoke all on table public.client_portal_email_queue from authenticated;

-- Serialize publication on the canonical plan. Old revisions remain intact.
create function public.publish_client_portal_plan(p_org uuid, p_client uuid, p_plan uuid, p_actor uuid, p_snapshot jsonb)
returns uuid language plpgsql security invoker set search_path = public, pg_catalog as $$
declare new_id uuid; next_version integer;
begin
    perform 1 from public.marketing_plans where id = p_plan and client_id = p_client and organization_id = p_org for update;
    if not found then raise exception 'Unknown plan'; end if;
    if not exists(select 1 from public.organization_members where organization_id = p_org and user_id = p_actor and role <> 'viewer') then
        raise exception 'Forbidden';
    end if;
    if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object' then raise exception 'Snapshot required'; end if;
    select coalesce(max(version), 0) + 1 into next_version from public.client_portal_plan_shares where marketing_plan_id = p_plan;
    update public.client_portal_plan_shares set unshared_at = now() where marketing_plan_id = p_plan and unshared_at is null;
    insert into public.client_portal_plan_shares (organization_id,client_id,marketing_plan_id,shared_by,snapshot,version)
        values (p_org,p_client,p_plan,p_actor,p_snapshot,next_version) returning id into new_id;
    return new_id;
end $$;
revoke all on function public.publish_client_portal_plan(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.publish_client_portal_plan(uuid,uuid,uuid,uuid,jsonb) to service_role;

-- Lock the exact revision seen by the client. A concurrent republish makes
-- an old-page approval fail rather than approving content the client never saw.
create function public.record_client_portal_decision(p_contact uuid, p_user uuid, p_share uuid, p_decision text, p_note text)
returns boolean language plpgsql security invoker set search_path = public, pg_catalog as $$
declare contact public.client_portal_contacts%rowtype; revision public.client_portal_plan_shares%rowtype; latest text;
begin
    select * into contact from public.client_portal_contacts where id = p_contact and user_id = p_user and revoked_at is null for update;
    if not found then return false; end if;
    select * into revision from public.client_portal_plan_shares where id = p_share
        and organization_id = contact.organization_id and client_id = contact.client_id and unshared_at is null for update;
    if not found or revision.snapshot is null then return false; end if;
    select decision into latest from public.client_portal_plan_decisions where plan_share_id = p_share order by decided_at desc limit 1;
    if latest = p_decision then return false; end if;
    if p_decision = 'changes_requested' and coalesce(length(btrim(p_note)),0) = 0 then return false; end if;
    insert into public.client_portal_plan_decisions (organization_id,client_id,marketing_plan_id,plan_share_id,contact_id,actor_label,decision,note)
        values (contact.organization_id,contact.client_id,revision.marketing_plan_id,p_share,p_contact,contact.display_name,p_decision,p_note);
    if p_note is not null then
        insert into public.client_portal_feedback (organization_id,client_id,contact_id,author_label,subject_type,subject_id,body)
            values (contact.organization_id,contact.client_id,p_contact,contact.display_name,'plan',revision.marketing_plan_id,p_note);
    end if;
    return true;
end $$;
revoke all on function public.record_client_portal_decision(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_client_portal_decision(uuid,uuid,uuid,text,text) to service_role;

-- Notifications are queued in the same transaction as the saved content.
create function public.queue_client_portal_email() returns trigger language plpgsql security invoker
set search_path = public, pg_catalog as $$
declare kind text; path text;
begin
    if tg_table_name = 'client_portal_feedback' then
        if new.staff_user_id is null then return new; end if;
        -- Do not notify about notes on content which has been unshared/resolved.
        if new.subject_type = 'plan' and not exists(select 1 from public.client_portal_plan_shares where marketing_plan_id = new.subject_id and client_id = new.client_id and organization_id = new.organization_id and unshared_at is null) then return new; end if;
        if new.subject_type = 'waiting_item' and not exists(select 1 from public.client_portal_waiting_items where id = new.subject_id and client_id = new.client_id and organization_id = new.organization_id and resolved_at is null) then return new; end if;
        kind := 'reply'; path := case new.subject_type when 'plan' then '/portal/plan' when 'waiting_item' then '/portal/pending' else '/portal/messages' end;
    elsif tg_table_name = 'client_portal_plan_shares' then
        kind := 'plan'; path := '/portal/plan';
    elsif tg_table_name = 'client_portal_report_shares' then
        kind := 'report'; path := '/portal/reports/' || new.report_id;
    elsif tg_table_name = 'client_portal_updates' then
        kind := 'update'; path := '/portal';
    else
        kind := 'request'; path := '/portal/pending';
    end if;
    insert into public.client_portal_email_queue (organization_id,client_id,contact_id,event_kind,event_id,next_path)
        select new.organization_id,new.client_id,c.id,kind,new.id,path from public.client_portal_contacts c
        where c.organization_id = new.organization_id and c.client_id = new.client_id and c.revoked_at is null
        on conflict (event_kind,event_id,contact_id) do nothing;
    return new;
end $$;
revoke all on function public.queue_client_portal_email() from public,anon,authenticated;
grant execute on function public.queue_client_portal_email() to service_role;
create trigger client_portal_plan_email after insert on public.client_portal_plan_shares for each row execute function public.queue_client_portal_email();
create trigger client_portal_report_email after insert on public.client_portal_report_shares for each row execute function public.queue_client_portal_email();
create trigger client_portal_reply_email after insert on public.client_portal_feedback for each row execute function public.queue_client_portal_email();
create trigger client_portal_update_email after insert on public.client_portal_updates for each row execute function public.queue_client_portal_email();
create trigger client_portal_request_email after insert on public.client_portal_waiting_items for each row execute function public.queue_client_portal_email();

create function public.claim_client_portal_emails(p_limit integer default 20) returns setof public.client_portal_email_queue
language plpgsql security invoker set search_path = public, pg_catalog as $$
begin
    -- A worker can crash after its final claim. Expire that lease visibly.
    update public.client_portal_email_queue set failed_at = now(), claimed_at = null
    where sent_at is null and canceled_at is null and failed_at is null and attempts >= 6
        and (claimed_at is null or claimed_at < now() - interval '15 minutes');
    return query update public.client_portal_email_queue set claimed_at = now(), attempts = attempts + 1
    where id in (select id from public.client_portal_email_queue
        where sent_at is null and canceled_at is null and failed_at is null and attempts < 6 and available_at <= now()
        and (claimed_at is null or claimed_at < now() - interval '15 minutes')
        order by available_at for update skip locked limit greatest(0, least(p_limit, 50))) returning *;
end $$;
revoke all on function public.claim_client_portal_emails(integer) from public,anon,authenticated;
grant execute on function public.claim_client_portal_emails(integer) to service_role;
