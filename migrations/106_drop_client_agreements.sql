-- Migration 106: remove the unused client agreements v1 engine.
-- Drops the review RPCs, attribution triggers, agreement columns, the
-- funding table, and client_agreements. The test row may go with the table.
-- Restores activate_client_setup_scope to the migration 064 body so client
-- activation still manages setup commitments after the table is gone.
-- Idempotent. Do not apply until Carlos confirms.

begin;

drop trigger if exists time_logs_agreement_scope on public.time_logs;
drop trigger if exists tasks_agreement_origin on public.tasks;
drop trigger if exists deliverables_agreement_origin on public.deliverables;
drop trigger if exists deliverables_guard_custom_generation on public.deliverables;
drop trigger if exists commitments_agreement_origin on public.deliverable_commitments;
drop trigger if exists commitments_require_agreement_transaction on public.deliverable_commitments;
drop trigger if exists commitments_protect_accepted_scope on public.deliverable_commitments;
drop trigger if exists clients_protect_agreement_terms on public.clients;

drop function if exists public.agreement_coverage_end(uuid);
drop function if exists public.agreement_at_date(uuid, date);
drop function if exists public.classify_agreement_time();
drop function if exists public.assign_work_agreement();
drop function if exists public.require_accepted_output_transaction();
drop function if exists public.protect_agreement_commitment();
drop function if exists public.protect_agreement_client_terms();
drop function if exists public.agreement_review_token(uuid);
drop function if exists public.preview_client_agreement(uuid, date);
drop function if exists public.confirm_client_agreement(uuid, uuid, jsonb, text);
drop function if exists public.cancel_scheduled_agreement(uuid, uuid);
drop function if exists public.guard_custom_agreement_generation();

alter table public.tasks drop constraint if exists tasks_plan_phase_check;

drop index if exists public.time_logs_agreement_period_idx;
drop index if exists public.commitments_agreement_idx;
drop index if exists public.deliverables_generation_key_idx;
drop index if exists public.tasks_client_plan_phase_idx;

alter table public.tasks
    drop column if exists agreement_id,
    drop column if exists plan_phase,
    drop column if exists plan_phase_locked,
    drop column if exists commitment_id;

alter table public.time_logs
    drop column if exists agreement_id;

alter table public.deliverable_commitments
    drop column if exists agreement_id;

alter table public.deliverables
    drop column if exists agreement_id,
    drop column if exists generation_key;

drop table if exists public.client_agreement_work_funding;
drop table if exists public.client_agreements;

create or replace function public.activate_client_setup_scope() returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
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

commit;
