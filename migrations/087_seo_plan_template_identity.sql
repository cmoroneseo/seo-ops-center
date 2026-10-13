-- SEO Plan template identity. Additive only.
-- Existing rows keep a null template_key. source defaults to 'template'
-- as a column default; this file does not rewrite titles or backfill keys.
-- A reviewed backfill, if it is ever run, sets template_key only where the
-- title matches exactly and leaves every other row null.

alter table public.marketing_plan_items
    add column template_key text,
    add column source text not null default 'template';

alter table public.marketing_plan_items
    add constraint marketing_plan_items_template_key_check
    check (
        template_key is null
        or (
            char_length(template_key) between 1 and 80
            and template_key ~ '^[a-z0-9]+(\.[a-z0-9]+)*$'
        )
    );

alter table public.marketing_plan_items
    add constraint marketing_plan_items_source_check
    check (source in ('template', 'onboarding', 'custom', 'basecamp'));

create unique index marketing_plan_items_template_key_unique
    on public.marketing_plan_items (marketing_plan_id, template_key)
    where template_key is not null;

-- Same signature as migration 064. New jsonb keys are optional so an
-- unflagged setup payload still inserts. templateKey is stored only when
-- present; a blank key stays null and does not take a unique slot.
create or replace function public.create_client_with_setup(
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
    v_source text;
    v_key text;
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
        v_source := coalesce(nullif(trim(v_item->>'source'), ''), 'template');
        if v_source not in ('template', 'onboarding', 'custom', 'basecamp') then raise exception 'Invalid plan item source'; end if;
        v_key := nullif(trim(v_item->>'templateKey'), '');
        if v_key is not null and (char_length(v_key) > 80 or v_key !~ '^[a-z0-9]+(\.[a-z0-9]+)*$') then raise exception 'Invalid plan item'; end if;
        insert into public.marketing_plan_items (marketing_plan_id, organization_id, client_id, step_key, title, description, priority, sort_order, is_custom, roadmap_included, roadmap_phase, template_key, source)
        values (v_plan, p_organization_id, p_request_id, v_item->>'stepKey', v_item->>'title', v_item->>'description', v_item->>'priority', v_order, (v_item->>'custom')::boolean, (v_item->>'included')::boolean, v_item->>'phase', v_key, v_source);
        v_order := v_order + 1;
    end loop;
    return p_request_id;
end;
$$;

revoke all on function public.create_client_with_setup(uuid, uuid, text, text, uuid, date, date, numeric, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.create_client_with_setup(uuid, uuid, text, text, uuid, date, date, numeric, jsonb, jsonb, jsonb) to authenticated;

-- A task linked onto the plan is source basecamp. Existing links are not relabeled.
create or replace function public.add_existing_task_to_marketing_plan(p_plan_id uuid, p_task_id uuid, p_step_key text)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
    v_plan public.marketing_plans%rowtype;
    v_task public.tasks%rowtype;
    v_item_id uuid;
begin
    select * into v_plan from public.marketing_plans where id = p_plan_id for update;
    if not found then raise exception 'Plan is unavailable'; end if;
    if not exists (select 1 from jsonb_array_elements(v_plan.steps) step where step->>'key' = p_step_key) then
        raise exception 'Choose a valid plan category';
    end if;
    select * into v_task from public.tasks where id = p_task_id for update;
    if not found or v_task.organization_id <> v_plan.organization_id or v_task.client_id is distinct from v_plan.client_id then
        raise exception 'Task must belong to this client';
    end if;
    select id into v_item_id from public.marketing_plan_items where marketing_plan_id = p_plan_id and task_id = p_task_id;
    if found then
        update public.marketing_plan_items set roadmap_included = true, status = case when status = 'ignored' then 'todo' else status end where id = v_item_id;
        return v_item_id;
    end if;
    insert into public.marketing_plan_items (
        marketing_plan_id, organization_id, client_id, step_key, title, description,
        priority, status, due_date, task_id, is_custom, roadmap_included, sort_order, source
    ) values (
        v_plan.id, v_plan.organization_id, v_plan.client_id, p_step_key, v_task.title, v_task.description,
        case when v_task.priority = 'urgent' then 'high' else v_task.priority end,
        case when v_task.status in ('done','approved') then 'done' else 'todo' end,
        v_task.due_date, v_task.id, true, true,
        coalesce((select max(sort_order) + 1 from public.marketing_plan_items where marketing_plan_id = p_plan_id), 0),
        'basecamp'
    ) returning id into v_item_id;
    return v_item_id;
end;
$$;

revoke all on function public.add_existing_task_to_marketing_plan(uuid, uuid, text) from public, anon;
grant execute on function public.add_existing_task_to_marketing_plan(uuid, uuid, text) to authenticated;
