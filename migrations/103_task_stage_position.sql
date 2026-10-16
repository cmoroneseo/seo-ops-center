-- Migration 103: tasks.stage and tasks.position.
-- 103 is the next free number after 102. This file does not change RLS.
--
-- stage is the roadmap column a task belongs to. It is not derived from
-- due_date.
--   1. A task linked from marketing_plan_items.task_id, when that item is
--      roadmap_included, takes that item's roadmap_phase. Several included
--      items on one task resolve to the earliest phase: onboarding, month_1,
--      month_2, month_3, then backlog (TASK_STAGES in lib/types.ts).
--   2. A subtask with no included link of its own inherits its parent's
--      resolved stage, walking the parent chain. An included link on the
--      subtask wins over the parent.
--   3. Every other task stays 'backlog'.
--
-- position is the order inside (client_id, stage, parent). Null parents share
-- one partition via the nil uuid. Included-item sort_order comes first
-- (nulls last), then created_at, then id so rows that share a timestamp stay
-- put. The id tie-break is required: some sibling subtasks were inserted with
-- the same created_at.
--
-- position is added nullable with no default on purpose. In Postgres 11+ a
-- default on ADD COLUMN is visible on existing rows, and a later
-- "where position is null" backfill would skip them. The default is applied
-- only after the backfill. A re-run finds no nulls and does not rewrite
-- stages or positions.

alter table public.tasks
  add column if not exists stage text not null default 'backlog';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_stage_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_stage_check
      check (stage in ('onboarding', 'month_1', 'month_2', 'month_3', 'backlog'));
  end if;
end $$;

alter table public.tasks
  add column if not exists position double precision;

do $backfill$
begin
  if exists (select 1 from public.tasks where position is null) then
    with recursive chosen as (
      select task_id, stage, sort_order
      from (
        select
          item.task_id,
          item.roadmap_phase as stage,
          item.sort_order,
          row_number() over (
            partition by item.task_id
            order by
              case item.roadmap_phase
                when 'onboarding' then 0
                when 'month_1' then 1
                when 'month_2' then 2
                when 'month_3' then 3
                when 'backlog' then 4
                else 5
              end,
              item.sort_order asc nulls last,
              item.id
          ) as pick
        from public.marketing_plan_items as item
        where item.roadmap_included
          and item.task_id is not null
          and item.roadmap_phase in ('onboarding', 'month_1', 'month_2', 'month_3', 'backlog')
      ) as ranked
      where pick = 1
    ),
    inherited as (
      select
        task.id,
        coalesce(chosen.stage, 'backlog') as stage,
        0 as depth,
        array[task.id] as path
      from public.tasks as task
      left join chosen on chosen.task_id = task.id
      where task.parent_task_id is null
         or not exists (
           select 1
           from public.tasks as parent
           where parent.id = task.parent_task_id
         )
      union all
      select
        child.id,
        coalesce(chosen.stage, parent.stage) as stage,
        parent.depth + 1,
        parent.path || child.id
      from public.tasks as child
      join inherited as parent on parent.id = child.parent_task_id
      left join chosen on chosen.task_id = child.id
      where parent.depth < 32
        and not (child.id = any (parent.path))
    ),
    positioned as (
      select
        task.id,
        coalesce(inherited.stage, chosen.stage, 'backlog') as stage,
        row_number() over (
          partition by
            task.client_id,
            coalesce(inherited.stage, chosen.stage, 'backlog'),
            coalesce(task.parent_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
          order by chosen.sort_order nulls last, task.created_at, task.id
        )::double precision as position
      from public.tasks as task
      left join inherited on inherited.id = task.id
      left join chosen on chosen.task_id = task.id
    )
    update public.tasks as task
    set stage = positioned.stage,
        position = positioned.position
    from positioned
    where task.id = positioned.id
      and task.position is null;
  end if;
end
$backfill$;

alter table public.tasks
  alter column position set default 0,
  alter column position set not null;

create index if not exists tasks_client_stage_position_idx
  on public.tasks (client_id, stage, parent_task_id, position);
