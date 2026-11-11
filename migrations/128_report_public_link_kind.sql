-- 128_report_public_link_kind.sql
-- Separate no-login links for the live roadmap from frozen event-report links.
--
-- NOT APPLIED. Do not run this against any Supabase project.
-- The owner reviews and applies it separately.
--
-- Existing rows stay kind events because the column defaults to events.
-- An event link still requires an object snapshot. A roadmap link stores no
-- snapshot: snapshot must be null. Row level security is unchanged.
-- No new policies, grants, or revokes.
--
-- Rollback (only when no roadmap rows exist):
-- drop index if exists public.report_public_links_report_kind_idx;
-- alter table public.report_public_links drop constraint if exists report_public_links_snapshot_kind;
-- alter table public.report_public_links drop constraint if exists report_public_links_kind_check;
-- alter table public.report_public_links alter column snapshot set not null;
-- alter table public.report_public_links
--   add constraint report_public_links_snapshot_object check (
--     jsonb_typeof(snapshot) = 'object'
--     and pg_column_size(snapshot) <= 524288
--   );
-- alter table public.report_public_links drop column if exists kind;

alter table public.report_public_links
  add column if not exists kind text not null default 'events';

alter table public.report_public_links
  drop constraint if exists report_public_links_kind_check;

alter table public.report_public_links
  add constraint report_public_links_kind_check
  check (kind in ('events', 'roadmap'));

alter table public.report_public_links
  alter column snapshot drop not null;

alter table public.report_public_links
  drop constraint if exists report_public_links_snapshot_object;

alter table public.report_public_links
  add constraint report_public_links_snapshot_kind
  check (
    (
      kind = 'events'
      and snapshot is not null
      and jsonb_typeof(snapshot) = 'object'
      and pg_column_size(snapshot) <= 524288
    )
    or (
      kind = 'roadmap'
      and snapshot is null
    )
  );

create index if not exists report_public_links_report_kind_idx
  on public.report_public_links (organization_id, report_id, kind, created_at desc);

comment on column public.report_public_links.kind is
  'events is a frozen event report. roadmap stores no snapshot and reads the live plan. Existing rows stay events.';

comment on table public.report_public_links is
  'Unguessable, revocable links. events freezes an event report. roadmap reads the live plan and stores no snapshot. The raw token is not stored.';
