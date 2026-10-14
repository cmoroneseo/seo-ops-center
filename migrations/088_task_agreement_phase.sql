-- Agreement phase on the task. Migration 088.
-- 085 is an older unused number and is not reused. 086 does not reserve
-- 087–089. 087 is template identity and is already applied. 089 stays free
-- for the later Basecamp projection (list, prefix, group).
-- plan_phase is null, onboarding, or month_ plus a positive integer.
-- A check, not an enum, so Month 14 does not need another migration.
-- Existing rows are not rewritten. roadmap_phase is not copied.

begin;

alter table public.tasks
    add column plan_phase text,
    add column plan_phase_locked boolean not null default false,
    add column commitment_id uuid references public.deliverable_commitments(id) on delete set null;

alter table public.tasks
    add constraint tasks_plan_phase_check
    check (
        plan_phase is null
        or plan_phase = 'onboarding'
        or plan_phase ~ '^month_[1-9][0-9]*$'
    );

create index tasks_client_plan_phase_idx
    on public.tasks (client_id, plan_phase);

commit;
