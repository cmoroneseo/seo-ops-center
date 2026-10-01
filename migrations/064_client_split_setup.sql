-- Selected client setup: atomic creation, planned scope, explicit launch.
alter table public.clients
    add column onboarding_date date,
    add column setup_scope jsonb;
alter table public.clients add constraint clients_setup_scope_check check (
    setup_scope is null or (
        coalesce(setup_scope->>'version' = '1' and setup_scope->>'mode' in ('monthly', 'custom')
        and setup_scope->>'hoursMode' in ('committed', 'allowance')
        and setup_scope->>'onboardingBudget' in ('separate', 'first_month')
        and (setup_scope->>'contentPieces')::numeric between 0 and 999
        and (setup_scope->>'contentPieces')::numeric = trunc((setup_scope->>'contentPieces')::numeric), false)
    )
);

create function public.create_client_with_setup(
    p_request_id uuid, p_organization_id uuid, p_name text, p_domain text,
    p_account_manager_id uuid, p_onboarding_date date, p_launch_date date,
    p_seo_hours numeric, p_scope jsonb, p_steps jsonb, p_items jsonb
) returns uuid language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
    v_manager text;
    v_plan uuid;
    v_item jsonb;
    v_order integer := 0;
    v_content integer;
begin
    if auth.uid() is null or not exists (select 1 from public.organization_members where organization_id = p_organization_id and user_id = auth.uid() and role in ('owner', 'admin', 'member')) then
        raise exception 'You cannot create clients in this organization';
    end if;
    -- Retry after a lost response returns the original client; never duplicates work.
    perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
    if exists (select 1 from public.clients where id = p_request_id and organization_id = p_organization_id) then return p_request_id; end if;
    if nullif(trim(p_name), '') is null or length(p_name) > 200 then raise exception 'Enter a client name (200 characters maximum)'; end if;
    if p_onboarding_date is null or p_onboarding_date > current_date or p_launch_date < p_onboarding_date or p_launch_date > current_date then raise exception 'Choose valid onboarding and launched dates'; end if;
    if p_domain is not null and (length(p_domain) > 2048 or p_domain !~ '^https?://[^[:space:]]+$') then raise exception 'Enter a valid website URL'; end if;
    if p_seo_hours is null or p_seo_hours < 0 or p_seo_hours > 9999 or p_seo_hours = 'NaN'::numeric then raise exception 'Invalid SEO hours'; end if;
    if p_scope is null or p_scope->>'version' is distinct from '1' or coalesce(p_scope->>'mode', '') not in ('monthly', 'custom') or coalesce(p_scope->>'hoursMode', '') not in ('committed', 'allowance') or coalesce(p_scope->>'onboardingBudget', '') not in ('separate', 'first_month') then raise exception 'Invalid service scope'; end if;
    v_content := (p_scope->>'contentPieces')::integer;
    if v_content is null or v_content < 0 or v_content > 999 then raise exception 'Invalid content quantity'; end if;
    if p_scope->>'targetDate' is not null and (p_scope->>'targetDate')::date < p_onboarding_date then raise exception 'Invalid target date'; end if;
    if p_scope->>'mode' = 'monthly' and p_seo_hours = 0 and v_content = 0 and not coalesce((p_scope->>'gbp')::boolean, false) and not coalesce((p_scope->>'listings')::boolean, false) then raise exception 'Choose at least one service'; end if;
    if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then raise exception 'Invalid SEO plan'; end if;
    if p_account_manager_id is not null then
        select u.full_name into v_manager from public.organization_members m join public.users u on u.id = m.user_id where m.organization_id = p_organization_id and m.user_id = p_account_manager_id;
        if not found then raise exception 'Account manager must belong to this organization'; end if;
    end if;
    insert into public.clients (id, organization_id, name, domain, account_manager_id, account_manager_name, onboarding_date, launch_date, seo_hours, engagement_model, status, tier, blogs_due_per_month, setup_scope, campaign_end, campaign_total_hours)
    values (p_request_id, p_organization_id, trim(p_name), p_domain, p_account_manager_id, v_manager, p_onboarding_date, p_launch_date, p_seo_hours, case when p_scope->>'mode' = 'monthly' then 'Retainer' else 'Campaign' end, 'onboarding', 1, 0, p_scope, (p_scope->>'targetDate')::date, case when p_scope->>'mode' = 'custom' then p_seo_hours end);
    if p_scope->>'mode' = 'monthly' and v_content > 0 then
        insert into public.deliverable_commitments (organization_id, client_id, type, title, quantity_per_month, cadence, engagement_model, starts_on, is_active, counts_toward_hours, custom_fields)
        values (p_organization_id, p_request_id, 'Content', 'Content pieces', v_content, 'monthly', 'Retainer', coalesce(p_launch_date, p_onboarding_date), false, false, '{"setupManaged":true,"fulfillment":"delivered","mixedContent":true}');
    end if;
    insert into public.marketing_plans (organization_id, client_id, title, steps) values (p_organization_id, p_request_id, trim(p_name) || ' — SEO Plan', p_steps) returning id into v_plan;
    for v_item in select value from jsonb_array_elements(p_items) loop
        if nullif(trim(v_item->>'title'), '') is null or length(v_item->>'title') > 500 or not exists (select 1 from jsonb_array_elements(p_steps) s where s->>'key' = v_item->>'stepKey') then raise exception 'Invalid plan item'; end if;
        insert into public.marketing_plan_items (marketing_plan_id, organization_id, client_id, step_key, title, description, priority, sort_order, is_custom, roadmap_included, roadmap_phase)
        values (v_plan, p_organization_id, p_request_id, v_item->>'stepKey', v_item->>'title', v_item->>'description', v_item->>'priority', v_order, (v_item->>'custom')::boolean, (v_item->>'included')::boolean, v_item->>'phase');
        v_order := v_order + 1;
    end loop;
    return p_request_id;
end;
$$;
revoke all on function public.create_client_with_setup(uuid, uuid, text, text, uuid, date, date, numeric, jsonb, jsonb, jsonb) from public;
grant execute on function public.create_client_with_setup(uuid, uuid, text, text, uuid, date, date, numeric, jsonb, jsonb, jsonb) to authenticated;

create function public.activate_client_setup_scope() returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
    if new.setup_scope is null then return new; end if;
    if new.status = 'active' and (new.launch_date is null or new.launch_date > current_date or new.launch_date < new.onboarding_date) then raise exception 'Confirm an actual launched date before activating this client'; end if;
    if new.status is distinct from old.status or new.launch_date is distinct from old.launch_date or new.setup_scope is distinct from old.setup_scope then
        update public.deliverable_commitments set is_active = new.status = 'active' and new.setup_scope->>'mode' = 'monthly' and (new.setup_scope->>'contentPieces')::integer > 0, starts_on = coalesce(new.launch_date, new.onboarding_date), quantity_per_month = (new.setup_scope->>'contentPieces')::integer
        where client_id = new.id and organization_id = new.organization_id and custom_fields->>'setupManaged' = 'true';
        if not found and new.setup_scope->>'mode' = 'monthly' and (new.setup_scope->>'contentPieces')::integer > 0 then
            insert into public.deliverable_commitments (organization_id, client_id, type, title, quantity_per_month, cadence, engagement_model, starts_on, is_active, counts_toward_hours, custom_fields)
            values (new.organization_id, new.id, 'Content', 'Content pieces', (new.setup_scope->>'contentPieces')::integer, 'monthly', 'Retainer', coalesce(new.launch_date, new.onboarding_date), new.status = 'active', false, '{"setupManaged":true,"fulfillment":"delivered","mixedContent":true}');
        end if;
    end if;
    return new;
end;
$$;
create trigger clients_activate_setup after update of status, launch_date, setup_scope on public.clients for each row execute function public.activate_client_setup_scope();
