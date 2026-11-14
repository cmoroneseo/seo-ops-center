-- Migration 131: GBP approval requests.
--
-- NOT APPLIED. Do not run this against the production Supabase project.
-- The owner reviews and applies it separately. Tests run it on PGlite only.
--
-- One request is tied to one client and one task. Items are versioned.
-- The public link stores a sha-256 of a 32-byte token, never the token.
-- expired and revoked are link facts. Item approval is derived from the
-- current version. There is no anon policy. Authenticated org members can
-- read. Writes go through service-role functions that reject viewers.
-- The storage bucket is private and has no policies. The app signs URLs
-- after it has checked the token or the membership.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  idempotency_key text,
  request_hash text,
  constraint approval_requests_idempotency_unique unique (organization_id, idempotency_key),
  constraint approval_requests_idempotency_check check (
    (idempotency_key is null and request_hash is null) or
    (idempotency_key is not null and request_hash is not null
      and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$' and request_hash ~ '^[0-9a-f]{64}$')
  ),
  due_at timestamptz,
  round integer not null default 1,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint approval_requests_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint approval_requests_round_check check (round >= 1)
);

create table if not exists public.approval_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  item_type text not null,
  position integer not null,
  current_version_id uuid,
  status text not null default 'pending',
  decision_locked_at timestamptz,
  decision_lock_reason text,
  created_at timestamptz not null default now(),
  constraint approval_items_type_check check (item_type = 'gbp_post'),
  constraint approval_items_position_check check (position >= 1),
  constraint approval_items_status_check check (status in ('pending', 'approved', 'changes_requested')),
  constraint approval_items_lock_reason_check check (
    decision_lock_reason is null or decision_lock_reason in ('agency_version', 'marked_final')
  ),
  constraint approval_items_lock_pair_check check (
    (decision_locked_at is null) = (decision_lock_reason is null)
  ),
  constraint approval_items_position_unique unique (request_id, position)
);

create table if not exists public.approval_item_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  item_id uuid not null references public.approval_items(id) on delete cascade,
  version_no integer not null,
  schema_version integer not null,
  payload jsonb not null,
  photo_path text,
  change_note text,
  source text not null,
  source_response_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint approval_item_versions_no_check check (version_no >= 1),
  constraint approval_item_versions_schema_check check (schema_version = 1),
  constraint approval_item_versions_source_check check (source in ('create', 'manual', 'accepted_suggestion')),
  constraint approval_item_versions_payload_check check (
    jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384
  ),
  constraint approval_item_versions_photo_check check (
    photo_path is null
    or (
      char_length(photo_path) <= 500
      and (
        photo_path ~ '^https://\S+$'
        or photo_path ~ '^gbp-approvals/[0-9a-f-]{36}/[0-9a-f-]{36}$'
      )
    )
  ),
  constraint approval_item_versions_note_check check (
    change_note is null or char_length(change_note) <= 500
  ),
  constraint approval_item_versions_unique unique (item_id, version_no)
);

create table if not exists public.approval_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_viewed_at timestamptz,
  view_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  extended_at timestamptz,
  constraint approval_links_one_per_request unique (request_id),
  constraint approval_links_token_unique unique (token_hash),
  constraint approval_links_token_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint approval_links_views_check check (view_count >= 0)
);

create table if not exists public.approval_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  item_id uuid references public.approval_items(id) on delete cascade,
  position integer not null,
  prompt text not null,
  created_at timestamptz not null default now(),
  constraint approval_questions_position_check check (position >= 1),
  constraint approval_questions_prompt_check check (char_length(btrim(prompt)) between 1 and 500),
  constraint approval_questions_position_unique unique (request_id, position)
);

create table if not exists public.approval_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  link_id uuid not null references public.approval_links(id) on delete cascade,
  idempotency_key text not null,
  request_hash text not null,
  respondent_name text not null,
  respondent_email text,
  ip_hash text,
  created_at timestamptz not null default now(),
  constraint approval_submissions_key_unique unique (link_id, idempotency_key),
  constraint approval_submissions_key_check check (char_length(idempotency_key) between 8 and 200),
  constraint approval_submissions_hash_check check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint approval_submissions_name_check check (char_length(btrim(respondent_name)) between 1 and 120),
  constraint approval_submissions_email_check check (
    respondent_email is null or char_length(respondent_email) <= 200
  ),
  constraint approval_submissions_ip_check check (
    ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'
  )
);

create table if not exists public.approval_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  submission_id uuid not null references public.approval_submissions(id) on delete cascade,
  item_id uuid not null references public.approval_items(id) on delete cascade,
  version_id uuid not null references public.approval_item_versions(id) on delete cascade,
  decision text not null,
  comment text,
  suggested_title text,
  suggested_body text,
  replacement_photo_path text,
  created_at timestamptz not null default now(),
  constraint approval_responses_decision_check check (decision in ('approved', 'changes_requested')),
  constraint approval_responses_comment_check check (comment is null or char_length(comment) <= 4000),
  constraint approval_responses_title_check check (
    suggested_title is null or char_length(suggested_title) between 1 and 80
  ),
  constraint approval_responses_body_check check (
    suggested_body is null or char_length(suggested_body) between 1 and 2000
  ),
  constraint approval_responses_photo_check check (
    replacement_photo_path is null
    or replacement_photo_path ~ '^gbp-approvals/[0-9a-f-]{36}/[0-9a-f-]{36}$'
  )
);

create table if not exists public.approval_question_answers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  submission_id uuid not null references public.approval_submissions(id) on delete cascade,
  question_id uuid not null references public.approval_questions(id) on delete cascade,
  answer text not null,
  created_at timestamptz not null default now(),
  constraint approval_question_answers_unique unique (submission_id, question_id),
  constraint approval_question_answers_text_check check (char_length(btrim(answer)) between 1 and 2000)
);

create table if not exists public.approval_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  item_id uuid references public.approval_items(id) on delete cascade,
  actor_id uuid,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint approval_events_kind_check check (kind in (
    'link_issued', 'link_extended', 'link_revoked', 'link_rotated',
    'item_marked_final', 'task_advanced'
  )),
  constraint approval_events_detail_check check (
    jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 4096
  )
);

create table if not exists public.approval_upload_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.approval_requests(id) on delete cascade,
  link_id uuid not null references public.approval_links(id) on delete cascade,
  object_key text not null,
  content_type text not null,
  byte_size integer not null,
  status text not null default 'reserved',
  response_id uuid references public.approval_responses(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint approval_upload_reservations_key_unique unique (object_key),
  constraint approval_upload_reservations_key_scope check (
    object_key = 'gbp-approvals/' || request_id::text || '/' || id::text
  ),
  constraint approval_upload_reservations_type_check check (
    content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
  ),
  constraint approval_upload_reservations_size_check check (byte_size between 1 and 10485760),
  constraint approval_upload_reservations_status_check check (status in ('reserved', 'attached'))
);

create table if not exists public.approval_public_hits (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  action text not null,
  created_at timestamptz not null default now(),
  constraint approval_public_hits_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint approval_public_hits_action_check check (action in ('read', 'submit', 'upload'))
);

create index if not exists approval_requests_task_idx
  on public.approval_requests (organization_id, task_id, created_at desc);
create index if not exists approval_items_request_idx
  on public.approval_items (request_id, position);
create index if not exists approval_item_versions_item_idx
  on public.approval_item_versions (item_id, version_no);
create index if not exists approval_submissions_request_idx
  on public.approval_submissions (request_id, created_at desc);
create index if not exists approval_responses_item_idx
  on public.approval_responses (item_id, version_id, created_at desc);
create index if not exists approval_public_hits_window_idx
  on public.approval_public_hits (token_hash, action, created_at desc);
create index if not exists approval_submissions_ip_purge_idx
  on public.approval_submissions (created_at)
  where ip_hash is not null;
create index if not exists approval_upload_orphan_idx
  on public.approval_upload_reservations (created_at)
  where status = 'reserved';

-- ---------------------------------------------------------------------------
-- Notifications: one new type. Every previously allowed value stays allowed.
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'task_assigned', 'task_mentioned', 'note_mentioned',
  'deliverable_assigned', 'deliverable_overdue', 'deliverable_at_risk', 'deliverable_status',
  'reminder_due', 'approval_opened', 'approval_comment', 'approval_decision',
  'approval_batch_done', 'approval_doc_drifted', 'portal_feedback',
  'vault_proposal_accepted', 'vault_proposal_dismissed',
  'gbp_approval_response'
));

alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check check (entity_type in (
  'task', 'task_comment', 'client_note', 'deliverable', 'reminder',
  'content_approval_batch', 'content_approval_doc', 'client_portal_feedback',
  'client_vault_suggestion', 'gbp_approval_request'
));

-- ---------------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------------

create or replace function public.approval_request_same_org()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
       or new.client_id is distinct from old.client_id
       or new.task_id is distinct from old.task_id
    then
      raise exception 'approval request identity cannot change' using errcode = '42501';
    end if;
  end if;
  if not exists (
    select 1 from public.clients
    where id = new.client_id and organization_id = new.organization_id
  ) then
    raise exception 'approval request client is not in this organization' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.tasks
    where id = new.task_id
      and organization_id = new.organization_id
      and client_id = new.client_id
  ) then
    raise exception 'approval request task is not in this organization' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists approval_request_same_org on public.approval_requests;
create trigger approval_request_same_org
  before insert or update on public.approval_requests
  for each row execute function public.approval_request_same_org();

create or replace function public.approval_child_org()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
declare
  parent_org uuid;
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.request_id is distinct from old.request_id
  ) then
    raise exception 'approval row cannot move between requests' using errcode = '42501';
  end if;
  select organization_id into parent_org
  from public.approval_requests
  where id = new.request_id;
  if parent_org is null or parent_org is distinct from new.organization_id then
    raise exception 'approval row organization does not match the request' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists approval_items_org on public.approval_items;
create trigger approval_items_org
  before insert or update on public.approval_items
  for each row execute function public.approval_child_org();

drop trigger if exists approval_links_org on public.approval_links;
create trigger approval_links_org
  before insert or update on public.approval_links
  for each row execute function public.approval_child_org();

drop trigger if exists approval_questions_org on public.approval_questions;
create trigger approval_questions_org
  before insert or update on public.approval_questions
  for each row execute function public.approval_child_org();

drop trigger if exists approval_submissions_org on public.approval_submissions;
create trigger approval_submissions_org
  before insert or update on public.approval_submissions
  for each row execute function public.approval_child_org();

drop trigger if exists approval_events_org on public.approval_events;
create trigger approval_events_org
  before insert or update on public.approval_events
  for each row execute function public.approval_child_org();

drop trigger if exists approval_reservations_org on public.approval_upload_reservations;
create trigger approval_reservations_org
  before insert or update on public.approval_upload_reservations
  for each row execute function public.approval_child_org();

drop trigger if exists approval_versions_org on public.approval_item_versions;
create trigger approval_versions_org
  before insert or update on public.approval_item_versions
  for each row execute function public.approval_child_org();

drop trigger if exists approval_responses_org on public.approval_responses;
create trigger approval_responses_org
  before insert or update on public.approval_responses
  for each row execute function public.approval_child_org();

drop trigger if exists approval_answers_org on public.approval_question_answers;
create trigger approval_answers_org
  before insert or update on public.approval_question_answers
  for each row execute function public.approval_child_org();

create or replace function public.approval_version_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    raise exception 'approval item versions are immutable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.approval_items
    where id = new.item_id
      and request_id = new.request_id
      and organization_id = new.organization_id
  ) then
    raise exception 'approval version is outside its item' using errcode = '23514';
  end if;
  if (new.payload->>'schemaVersion') is distinct from new.schema_version::text then
    raise exception 'approval payload schema version does not match' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists approval_version_scope on public.approval_item_versions;
create trigger approval_version_scope
  before insert or update or delete on public.approval_item_versions
  for each row execute function public.approval_version_scope();

create or replace function public.approval_item_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'UPDATE' and (
    new.item_type is distinct from old.item_type
    or new.position is distinct from old.position
  ) then
    raise exception 'approval item identity cannot change' using errcode = '42501';
  end if;
  if new.current_version_id is not null and not exists (
    select 1 from public.approval_item_versions
    where id = new.current_version_id
      and item_id = new.id
      and request_id = new.request_id
      and organization_id = new.organization_id
  ) then
    raise exception 'approval current version is not this item' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists approval_item_identity on public.approval_items;
create trigger approval_item_identity
  before update on public.approval_items
  for each row execute function public.approval_item_identity();

create or replace function public.approval_item_has_version()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  -- Deferred row triggers keep the NEW snapshot from the statement that queued
  -- them. Look at the live row so the insert-then-attach-version sequence is valid.
  if exists (
    select 1 from public.approval_items
    where id = new.id and current_version_id is null
  ) then
    raise exception 'approval item is missing its current version' using errcode = '23514';
  end if;
  return null;
end;
$fn$;

drop trigger if exists approval_item_has_version on public.approval_items;
create constraint trigger approval_item_has_version
  after insert or update on public.approval_items
  deferrable initially deferred
  for each row execute function public.approval_item_has_version();

create or replace function public.approval_question_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if new.item_id is not null and not exists (
    select 1 from public.approval_items
    where id = new.item_id and request_id = new.request_id and organization_id = new.organization_id
  ) then
    raise exception 'approval question is outside the request' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists approval_question_scope on public.approval_questions;
create trigger approval_question_scope
  before insert or update on public.approval_questions
  for each row execute function public.approval_question_scope();

create or replace function public.approval_response_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    raise exception 'approval responses are immutable' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.approval_items as item
    join public.approval_item_versions as version
      on version.id = new.version_id and version.item_id = item.id
    where item.id = new.item_id
      and item.request_id = new.request_id
      and item.organization_id = new.organization_id
      and version.request_id = new.request_id
  ) then
    raise exception 'approval response is outside the request' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.approval_submissions
    where id = new.submission_id
      and request_id = new.request_id
      and organization_id = new.organization_id
  ) then
    raise exception 'approval response submission is outside the request' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists approval_response_scope on public.approval_responses;
create trigger approval_response_scope
  before insert or update or delete on public.approval_responses
  for each row execute function public.approval_response_scope();

create or replace function public.approval_answer_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'UPDATE' or tg_op = 'DELETE' then
    raise exception 'approval answers are immutable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.approval_questions
    where id = new.question_id and request_id = new.request_id and organization_id = new.organization_id
  ) then
    raise exception 'approval answer is outside the request' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.approval_submissions
    where id = new.submission_id and request_id = new.request_id and organization_id = new.organization_id
  ) then
    raise exception 'approval answer submission is outside the request' using errcode = '23514';
  end if;
  return new;
end;
$fn$;

drop trigger if exists approval_answer_scope on public.approval_question_answers;
create trigger approval_answer_scope
  before insert or update or delete on public.approval_question_answers
  for each row execute function public.approval_answer_scope();

create or replace function public.approval_submission_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'DELETE' then
    raise exception 'approval submissions cannot be deleted' using errcode = '42501';
  end if;
  if current_setting('gbp_approval.purge', true) = 'on'
     and new.ip_hash is null
     and old.ip_hash is not null
     and new.respondent_name is not distinct from old.respondent_name
     and new.respondent_email is not distinct from old.respondent_email
     and new.request_hash is not distinct from old.request_hash
     and new.idempotency_key is not distinct from old.idempotency_key
     and new.link_id is not distinct from old.link_id
     and new.request_id is not distinct from old.request_id
     and new.organization_id is not distinct from old.organization_id
  then
    return new;
  end if;
  raise exception 'approval submissions are immutable' using errcode = '42501';
end;
$fn$;

drop trigger if exists approval_submission_guard on public.approval_submissions;
create trigger approval_submission_guard
  before update or delete on public.approval_submissions
  for each row execute function public.approval_submission_guard();

create or replace function public.approval_event_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  raise exception 'approval events are immutable' using errcode = '42501';
end;
$fn$;

drop trigger if exists approval_event_guard on public.approval_events;
create trigger approval_event_guard
  before update or delete on public.approval_events
  for each row execute function public.approval_event_guard();

create or replace function public.approval_upload_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $fn$
begin
  if tg_op = 'DELETE' then
    if current_setting('gbp_approval.purge', true) = 'on' and old.status = 'reserved' then
      return old;
    end if;
    raise exception 'approval uploads cannot be deleted' using errcode = '42501';
  end if;
  if old.status = 'reserved'
     and new.status = 'attached'
     and new.object_key is not distinct from old.object_key
     and new.request_id is not distinct from old.request_id
     and new.link_id is not distinct from old.link_id
     and new.organization_id is not distinct from old.organization_id
     and new.content_type is not distinct from old.content_type
     and new.byte_size is not distinct from old.byte_size
  then
    return new;
  end if;
  raise exception 'approval uploads cannot be edited' using errcode = '42501';
end;
$fn$;

drop trigger if exists approval_upload_guard on public.approval_upload_reservations;
create trigger approval_upload_guard
  before update or delete on public.approval_upload_reservations
  for each row execute function public.approval_upload_guard();

-- ---------------------------------------------------------------------------
-- Payload helpers. Client-visible fields are the ones a reviewer sees.
-- A change to any of them clears that item's approval. schemaVersion is not
-- one of them. Dates are calendar dates, never shifted by a time zone.
-- ---------------------------------------------------------------------------

create or replace function public.gbp_approval_calendar_date(p_value text)
returns date
language plpgsql
immutable
set search_path = pg_catalog, public
as $fn$
declare
  parsed date;
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  parsed := p_value::date;
  if to_char(parsed, 'YYYY-MM-DD') <> p_value then
    return null;
  end if;
  return parsed;
exception
  when others then
    return null;
end;
$fn$;

create or replace function public.gbp_approval_clean_post(p_payload jsonb, p_photo text)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog, public
as $fn$
declare
  v_type text;
  v_title text;
  v_body text;
  v_start text;
  v_end text;
  v_sched text;
  v_url text;
  v_label text;
  v_terms text;
  v_photo text;
  d_start date;
  d_end date;
  d_sched date;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return null;
  end if;
  if coalesce(p_payload->>'schemaVersion', '') <> '1' then
    return null;
  end if;
  v_type := p_payload->>'postType';
  if v_type not in ('offer', 'update', 'event') then
    return null;
  end if;
  v_title := btrim(coalesce(p_payload->>'title', ''));
  v_body := regexp_replace(coalesce(p_payload->>'body', ''), '^\s+|\s+$', '', 'g');
  v_label := btrim(coalesce(p_payload->>'ctaLabel', ''));
  v_url := btrim(coalesce(p_payload->>'ctaUrl', ''));
  v_terms := regexp_replace(coalesce(p_payload->>'terms', ''), '^\s+|\s+$', '', 'g');
  v_start := nullif(btrim(coalesce(p_payload->>'offerStart', '')), '');
  v_end := nullif(btrim(coalesce(p_payload->>'offerEnd', '')), '');
  v_sched := nullif(btrim(coalesce(p_payload->>'scheduledDate', '')), '');
  if char_length(v_title) < 1 or char_length(v_title) > 80 then return null; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then return null; end if;
  if char_length(v_label) < 1 or char_length(v_label) > 40 then return null; end if;
  if v_url !~ '^https://\S+$' or char_length(v_url) > 500 then return null; end if;
  if char_length(v_terms) > 1000 then return null; end if;
  d_sched := public.gbp_approval_calendar_date(v_sched);
  if d_sched is null then return null; end if;
  if v_type = 'offer' and (v_start is null or v_end is null) then return null; end if;
  if v_start is not null or v_end is not null then
    d_start := public.gbp_approval_calendar_date(v_start);
    d_end := public.gbp_approval_calendar_date(v_end);
    if d_start is null or d_end is null or d_end < d_start then return null; end if;
  end if;
  v_photo := nullif(btrim(coalesce(p_photo, '')), '');
  if v_photo is not null then
    if char_length(v_photo) > 500 then return null; end if;
    if v_photo !~ '^https://\S+$'
       and v_photo !~ '^gbp-approvals/[0-9a-f-]{36}/[0-9a-f-]{36}$' then
      return null;
    end if;
  end if;
  return jsonb_build_object(
    'payload', jsonb_build_object(
      'schemaVersion', 1,
      'postType', v_type,
      'title', v_title,
      'body', v_body,
      'offerStart', v_start,
      'offerEnd', v_end,
      'scheduledDate', to_char(d_sched, 'YYYY-MM-DD'),
      'ctaUrl', v_url,
      'ctaLabel', v_label,
      'terms', v_terms
    ),
    'photo', to_jsonb(v_photo)
  );
end;
$fn$;

create or replace function public.gbp_approval_visible(p_payload jsonb, p_photo text)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $fn$
  select jsonb_build_object(
    'postType', p_payload->>'postType',
    'title', p_payload->>'title',
    'body', p_payload->>'body',
    'offerStart', coalesce(p_payload->>'offerStart', ''),
    'offerEnd', coalesce(p_payload->>'offerEnd', ''),
    'scheduledDate', coalesce(p_payload->>'scheduledDate', ''),
    'ctaUrl', p_payload->>'ctaUrl',
    'ctaLabel', p_payload->>'ctaLabel',
    'terms', coalesce(p_payload->>'terms', ''),
    'photo', coalesce(p_photo, '')
  );
$fn$;

create or replace function public.gbp_approval_writer(p_actor uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select exists (
    select 1 from public.organization_members as member
    where member.organization_id = p_org
      and member.user_id = p_actor
      and member.role in ('owner', 'admin', 'member')
  );
$fn$;

create or replace function public.gbp_approval_fail(p_code text)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $fn$
  select jsonb_build_object('ok', false, 'code', p_code);
$fn$;

-- ---------------------------------------------------------------------------
-- Agency and bot writes. The actor must be a non-viewer member. These
-- functions never create a share link.
-- ---------------------------------------------------------------------------

create or replace function public.create_gbp_approval_request(
  p_actor uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_task_id uuid,
  p_title text,
  p_due_at timestamptz,
  p_questions jsonb,
  p_items jsonb,
  p_idempotency_key text default null,
  p_request_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_request_id uuid;
  v_item jsonb;
  v_question jsonb;
  v_clean jsonb;
  v_item_id uuid;
  v_version_id uuid;
  v_photo text;
  v_count integer := 0;
  v_qcount integer := 0;
  v_position integer;
  v_seen integer[] := '{}';
  v_prompt text;
  v_item_position integer;
  v_question_item uuid;
  v_existing public.approval_requests%rowtype;
begin
  if p_actor is null or not public.gbp_approval_writer(p_actor, p_organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;
  if p_idempotency_key is not null then
    -- Serialize retries before inspecting or creating the org-scoped key.
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_idempotency_key, 0));
    select * into v_existing from public.approval_requests
      where organization_id = p_organization_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.request_hash is distinct from p_request_hash then
        return public.gbp_approval_fail('idempotency_conflict');
      end if;
      return jsonb_build_object('ok', true, 'requestId', v_existing.id, 'round', v_existing.round);
    end if;
  end if;
  if p_title is null or char_length(btrim(p_title)) < 1 or char_length(btrim(p_title)) > 200 then
    return public.gbp_approval_fail('invalid_request');
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    return public.gbp_approval_fail('invalid_request');
  end if;
  if p_questions is null then
    p_questions := '[]'::jsonb;
  end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) > 20 then
    return public.gbp_approval_fail('invalid_request');
  end if;

  insert into public.approval_requests (
    organization_id, client_id, task_id, title, due_at, created_by, idempotency_key, request_hash
  ) values (
    p_organization_id, p_client_id, p_task_id, btrim(p_title), p_due_at, p_actor, p_idempotency_key, p_request_hash
  ) returning id into v_request_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_count := v_count + 1;
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_position := (v_item->>'position')::integer;
    if v_position is null or v_position < 1 or v_position = any(v_seen) then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_position;
    v_photo := v_item->>'photoPath';
    if v_photo is not null and v_photo like 'gbp-approvals/%' then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_clean := public.gbp_approval_clean_post(v_item->'payload', v_photo);
    if v_clean is null then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    insert into public.approval_items (
      organization_id, request_id, item_type, position, status
    ) values (
      p_organization_id, v_request_id, 'gbp_post', v_position, 'pending'
    ) returning id into v_item_id;
    insert into public.approval_item_versions (
      organization_id, request_id, item_id, version_no, schema_version,
      payload, photo_path, source, created_by
    ) values (
      p_organization_id, v_request_id, v_item_id, 1, 1,
      v_clean->'payload', nullif(v_clean->>'photo', ''), 'create', p_actor
    ) returning id into v_version_id;
    update public.approval_items
      set current_version_id = v_version_id
      where id = v_item_id;
  end loop;

  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    v_qcount := v_qcount + 1;
    v_prompt := btrim(coalesce(v_question->>'prompt', ''));
    if char_length(v_prompt) < 1 or char_length(v_prompt) > 500 then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_question_item := null;
    if nullif(v_question->>'itemPosition', '') is not null then
      v_item_position := (v_question->>'itemPosition')::integer;
      select id into v_question_item
      from public.approval_items
      where request_id = v_request_id and position = v_item_position;
      if v_question_item is null then
        raise exception 'invalid_request' using errcode = 'P0001';
      end if;
    end if;
    insert into public.approval_questions (
      organization_id, request_id, item_id, position, prompt
    ) values (
      p_organization_id, v_request_id, v_question_item, v_qcount, v_prompt
    );
  end loop;

  return jsonb_build_object('ok', true, 'requestId', v_request_id, 'round', 1);
exception
  when sqlstate 'P0001' then
    return public.gbp_approval_fail(sqlerrm);
  when invalid_text_representation or numeric_value_out_of_range or check_violation then
    return public.gbp_approval_fail('invalid_request');
end;
$fn$;

create or replace function public.issue_gbp_approval_link(
  p_actor uuid,
  p_request_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_request public.approval_requests%rowtype;
  v_link public.approval_links%rowtype;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return public.gbp_approval_fail('invalid_request');
  end if;
  if p_expires_at is null or p_expires_at <= p_now or p_expires_at > p_now + interval '90 days' then
    return public.gbp_approval_fail('invalid_request');
  end if;
  select * into v_request from public.approval_requests where id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if not public.gbp_approval_writer(p_actor, v_request.organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;
  select * into v_link from public.approval_links where request_id = p_request_id for update;
  if found and v_link.revoked_at is null then
    return public.gbp_approval_fail('link_exists');
  end if;
  if found and v_link.revoked_at is not null then
    update public.approval_links
      set token_hash = p_token_hash,
          expires_at = p_expires_at,
          revoked_at = null,
          extended_at = p_now,
          created_by = p_actor
      where id = v_link.id;
    insert into public.approval_events (organization_id, request_id, actor_id, kind, detail)
    values (v_request.organization_id, p_request_id, p_actor, 'link_rotated', '{}'::jsonb);
    return jsonb_build_object('ok', true, 'linkId', v_link.id, 'rotated', true);
  end if;
  insert into public.approval_links (
    organization_id, request_id, token_hash, expires_at, created_by
  ) values (
    v_request.organization_id, p_request_id, p_token_hash, p_expires_at, p_actor
  ) returning * into v_link;
  insert into public.approval_events (organization_id, request_id, actor_id, kind, detail)
  values (v_request.organization_id, p_request_id, p_actor, 'link_issued', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'linkId', v_link.id, 'rotated', false);
end;
$fn$;

create or replace function public.extend_gbp_approval_link(
  p_actor uuid,
  p_request_id uuid,
  p_expires_at timestamptz,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_request public.approval_requests%rowtype;
  v_link public.approval_links%rowtype;
begin
  select * into v_request from public.approval_requests where id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if not public.gbp_approval_writer(p_actor, v_request.organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;
  select * into v_link from public.approval_links where request_id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if v_link.revoked_at is not null then
    return public.gbp_approval_fail('revoked');
  end if;
  p_expires_at := coalesce(p_expires_at, greatest(v_link.expires_at, p_now) + interval '14 days');
  if p_expires_at is null or p_expires_at <= p_now or p_expires_at > p_now + interval '90 days' then
    return public.gbp_approval_fail('invalid_request');
  end if;
  update public.approval_links
    set expires_at = p_expires_at, extended_at = p_now
    where id = v_link.id;
  insert into public.approval_events (organization_id, request_id, actor_id, kind, detail)
  values (
    v_request.organization_id, p_request_id, p_actor, 'link_extended',
    jsonb_build_object('expiresAt', p_expires_at)
  );
  return jsonb_build_object('ok', true, 'linkId', v_link.id, 'expiresAt', p_expires_at);
end;
$fn$;

create or replace function public.revoke_gbp_approval_link(
  p_actor uuid,
  p_request_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_request public.approval_requests%rowtype;
  v_link public.approval_links%rowtype;
begin
  select * into v_request from public.approval_requests where id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if not public.gbp_approval_writer(p_actor, v_request.organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;
  select * into v_link from public.approval_links where request_id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if v_link.revoked_at is null then
    update public.approval_links set revoked_at = p_now where id = v_link.id;
    insert into public.approval_events (organization_id, request_id, actor_id, kind, detail)
    values (v_request.organization_id, p_request_id, p_actor, 'link_revoked', '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', true, 'linkId', v_link.id);
end;
$fn$;

create or replace function public.post_gbp_approval_version(
  p_actor uuid,
  p_request_id uuid,
  p_items jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_request public.approval_requests%rowtype;
  v_entry jsonb;
  v_item public.approval_items%rowtype;
  v_current public.approval_item_versions%rowtype;
  v_clean jsonb;
  v_photo text;
  v_note text;
  v_source text;
  v_source_response uuid;
  v_changed boolean;
  v_any_changed boolean := false;
  v_version_id uuid;
  v_status text;
  v_locked_at timestamptz;
  v_lock_reason text;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    return public.gbp_approval_fail('invalid_request');
  end if;
  select * into v_request from public.approval_requests where id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if not public.gbp_approval_writer(p_actor, v_request.organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;

  for v_entry in select value from jsonb_array_elements(p_items)
  loop
    select * into v_item
    from public.approval_items
    where id = (v_entry->>'itemId')::uuid and request_id = p_request_id
    for update;
    if not found then
      raise exception 'out_of_scope' using errcode = 'P0001';
    end if;
    select * into v_current from public.approval_item_versions where id = v_item.current_version_id;
    v_photo := v_entry->>'photoPath';
    if v_photo is not null and v_photo like 'gbp-approvals/%'
       and v_photo not like 'gbp-approvals/' || p_request_id::text || '/%' then
      raise exception 'out_of_scope' using errcode = 'P0001';
    end if;
    v_clean := public.gbp_approval_clean_post(v_entry->'payload', v_photo);
    if v_clean is null then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_note := nullif(btrim(coalesce(v_entry->>'changeNote', '')), '');
    v_source := coalesce(v_entry->>'source', 'manual');
    if v_source not in ('manual', 'accepted_suggestion') then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    v_source_response := nullif(v_entry->>'sourceResponseId', '')::uuid;
    if v_source = 'accepted_suggestion' and not exists (
      select 1 from public.approval_responses
      where id = v_source_response and item_id = v_item.id and request_id = p_request_id
    ) then
      raise exception 'out_of_scope' using errcode = 'P0001';
    end if;
    v_changed := public.gbp_approval_visible(v_current.payload, v_current.photo_path)
      is distinct from public.gbp_approval_visible(v_clean->'payload', v_clean->>'photo');
    if v_changed and v_note is null then
      raise exception 'change_note_required' using errcode = 'P0001';
    end if;
    if char_length(coalesce(v_note, '')) > 500 then
      raise exception 'invalid_request' using errcode = 'P0001';
    end if;
    insert into public.approval_item_versions (
      organization_id, request_id, item_id, version_no, schema_version,
      payload, photo_path, change_note, source, source_response_id, created_by
    ) values (
      v_request.organization_id, p_request_id, v_item.id, v_current.version_no + 1, 1,
      v_clean->'payload', nullif(v_clean->>'photo', ''), v_note, v_source, v_source_response, p_actor
    ) returning id into v_version_id;
    if v_changed then
      v_status := 'pending';
      v_locked_at := null;
      v_lock_reason := null;
      v_any_changed := true;
    else
      v_status := v_item.status;
      if v_item.status in ('approved', 'changes_requested') then
        v_locked_at := p_now;
        v_lock_reason := 'agency_version';
      else
        v_locked_at := v_item.decision_locked_at;
        v_lock_reason := v_item.decision_lock_reason;
      end if;
    end if;
    update public.approval_items
      set current_version_id = v_version_id,
          status = v_status,
          decision_locked_at = v_locked_at,
          decision_lock_reason = v_lock_reason
      where id = v_item.id;
  end loop;

  update public.approval_requests
    set round = case when v_any_changed then round + 1 else round end,
        updated_at = p_now
    where id = p_request_id;

  return jsonb_build_object('ok', true, 'changed', v_any_changed);
exception
  when sqlstate 'P0001' then
    return public.gbp_approval_fail(sqlerrm);
  when invalid_text_representation or check_violation then
    return public.gbp_approval_fail('invalid_request');
end;
$fn$;

create or replace function public.mark_gbp_approval_final(
  p_actor uuid,
  p_request_id uuid,
  p_item_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_item public.approval_items%rowtype;
begin
  perform 1 from public.approval_requests where id = p_request_id for update;
  select * into v_item from public.approval_items
  where id = p_item_id and request_id = p_request_id for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if not public.gbp_approval_writer(p_actor, v_item.organization_id) then
    return public.gbp_approval_fail('forbidden');
  end if;
  if v_item.status not in ('approved', 'changes_requested') then
    return public.gbp_approval_fail('not_ready');
  end if;
  if v_item.decision_locked_at is null then
    update public.approval_items
      set decision_locked_at = p_now, decision_lock_reason = 'marked_final'
      where id = v_item.id;
    insert into public.approval_events (organization_id, request_id, item_id, actor_id, kind, detail)
    values (
      v_item.organization_id, v_item.request_id, v_item.id, p_actor, 'item_marked_final',
      jsonb_build_object('status', v_item.status)
    );
  end if;
  return jsonb_build_object('ok', true);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Public token boundary. Scope comes from the token hash. Client-supplied
-- ids that are not on this request are rejected with no partial write.
-- ---------------------------------------------------------------------------

create or replace function public.gbp_approval_hit_count(
  p_token_hash text,
  p_action text,
  p_now timestamptz
)
returns integer
language sql
stable
set search_path = pg_catalog, public
as $fn$
  select count(*)::integer
  from public.approval_public_hits
  where token_hash = p_token_hash
    and action = p_action
    and created_at > p_now - interval '1 hour';
$fn$;

create or replace function public.reserve_gbp_approval_upload(
  p_token_hash text,
  p_content_type text,
  p_byte_size integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link public.approval_links%rowtype;
  v_request public.approval_requests%rowtype;
  v_id uuid := gen_random_uuid();
  v_key text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return public.gbp_approval_fail('not_found');
  end if;
  select * into v_link from public.approval_links where token_hash = p_token_hash;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  select * into v_request from public.approval_requests where id = v_link.request_id for update;
  select * into v_link from public.approval_links where id = v_link.id and token_hash = p_token_hash for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if v_link.revoked_at is not null then
    return public.gbp_approval_fail('revoked');
  end if;
  if v_link.expires_at <= p_now then
    return public.gbp_approval_fail('expired');
  end if;
  if p_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
     or p_byte_size is null or p_byte_size < 1 or p_byte_size > 10485760 then
    return public.gbp_approval_fail('invalid_request');
  end if;
  if public.gbp_approval_hit_count(p_token_hash, 'upload', p_now) >= 20 then
    return public.gbp_approval_fail('rate_limited');
  end if;
  v_key := 'gbp-approvals/' || v_request.id::text || '/' || v_id::text;
  insert into public.approval_upload_reservations (
    id, organization_id, request_id, link_id, object_key, content_type, byte_size, expires_at
  ) values (
    v_id, v_request.organization_id, v_request.id, v_link.id, v_key,
    p_content_type, p_byte_size, p_now + interval '15 minutes'
  );
  insert into public.approval_public_hits (token_hash, action, created_at)
  values (p_token_hash, 'upload', p_now);
  return jsonb_build_object(
    'ok', true,
    'reservationId', v_id,
    'objectKey', v_key,
    'expiresAt', p_now + interval '15 minutes'
  );
end;
$fn$;

create or replace function public.submit_gbp_approval(
  p_token_hash text,
  p_payload jsonb,
  p_ip_hash text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link public.approval_links%rowtype;
  v_request public.approval_requests%rowtype;
  v_existing public.approval_submissions%rowtype;
  v_key text;
  v_hash text;
  v_name text;
  v_email text;
  v_displayed uuid[];
  v_current uuid[];
  v_decision jsonb;
  v_answer jsonb;
  v_item public.approval_items%rowtype;
  v_prev public.approval_responses%rowtype;
  v_item_id uuid;
  v_version_id uuid;
  v_choice text;
  v_comment text;
  v_suggested_title text;
  v_suggested_body text;
  v_reservation_id uuid;
  v_reservation public.approval_upload_reservations%rowtype;
  v_seen uuid[] := '{}';
  v_verified uuid[];
  v_question_id uuid;
  v_answer_text text;
  v_submission_id uuid;
  v_response_id uuid;
  v_skip boolean;
  v_has_work boolean := false;
  v_approved integer;
  v_changes integer;
  v_pending integer;
  v_questions integer;
  v_answered integer;
  v_users uuid[];
  v_body text;
  v_advanced uuid;
  v_task_status text;
  v_task_due timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_payload) <> 'object' then
    return public.gbp_approval_fail('not_found');
  end if;
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    return public.gbp_approval_fail('invalid_request');
  end if;

  select * into v_link from public.approval_links where token_hash = p_token_hash;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  select * into v_request from public.approval_requests where id = v_link.request_id for update;
  select * into v_link from public.approval_links where id = v_link.id and token_hash = p_token_hash for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if v_link.revoked_at is not null then
    return public.gbp_approval_fail('revoked');
  end if;
  if v_link.expires_at <= p_now then
    return public.gbp_approval_fail('expired');
  end if;

  v_key := p_payload->>'idempotencyKey';
  v_hash := p_payload->>'requestHash';
  if v_key is null or v_key !~ '^[A-Za-z0-9][A-Za-z0-9:_.-]{7,199}$' or v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then
    return public.gbp_approval_fail('invalid_request');
  end if;

  select * into v_existing
  from public.approval_submissions
  where link_id = v_link.id and idempotency_key = v_key;
  if found then
    if v_existing.request_hash = v_hash then
      return jsonb_build_object('ok', true, 'idempotent', true, 'submissionId', v_existing.id);
    end if;
    return public.gbp_approval_fail('idempotency_conflict');
  end if;

  if public.gbp_approval_hit_count(p_token_hash, 'submit', p_now) >= 10 then
    return public.gbp_approval_fail('rate_limited');
  end if;
  insert into public.approval_public_hits (token_hash, action, created_at)
  values (p_token_hash, 'submit', p_now);

  v_name := btrim(coalesce(p_payload->>'respondentName', ''));
  if v_name = '' then
    return public.gbp_approval_fail('name_required');
  end if;
  if char_length(v_name) > 120 or position(E'\n' in v_name) > 0 or position(E'\r' in v_name) > 0 then
    return public.gbp_approval_fail('invalid_request');
  end if;
  v_email := nullif(btrim(coalesce(p_payload->>'respondentEmail', '')), '');
  if v_email is not null and (
    char_length(v_email) > 200 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) then
    return public.gbp_approval_fail('invalid_request');
  end if;

  begin
    select coalesce(array_agg(distinct (value #>> '{}')::uuid order by (value #>> '{}')::uuid), '{}')
      into v_displayed
    from jsonb_array_elements(coalesce(p_payload->'displayedVersionIds', '[]'::jsonb));
    select coalesce(array_agg(distinct (value #>> '{}')::uuid), '{}')
      into v_verified
    from jsonb_array_elements(coalesce(p_payload->'verifiedReservationIds', '[]'::jsonb));
  exception
    when invalid_text_representation or datatype_mismatch then
      return public.gbp_approval_fail('invalid_request');
  end;

  select coalesce(array_agg(current_version_id order by current_version_id), '{}')
    into v_current
  from public.approval_items
  where request_id = v_request.id and current_version_id is not null;
  if v_displayed is distinct from v_current then
    return public.gbp_approval_fail('refresh_required');
  end if;

  if jsonb_typeof(p_payload->'decisions') is distinct from 'array'
     or jsonb_typeof(coalesce(p_payload->'answers', '[]'::jsonb)) is distinct from 'array' then
    return public.gbp_approval_fail('invalid_request');
  end if;

  for v_decision in select value from jsonb_array_elements(p_payload->'decisions')
  loop
    v_has_work := true;
    v_item_id := public.gbp_approval_uuid_or_null(v_decision->>'itemId');
    v_version_id := public.gbp_approval_uuid_or_null(v_decision->>'versionId');
    if v_item_id is null or v_version_id is null then
      return public.gbp_approval_fail('invalid_request');
    end if;
    if v_item_id = any(v_seen) then
      return public.gbp_approval_fail('invalid_request');
    end if;
    v_seen := v_seen || v_item_id;
    select * into v_item from public.approval_items where id = v_item_id and request_id = v_request.id;
    if not found then
      return public.gbp_approval_fail('out_of_scope');
    end if;
    if v_item.current_version_id is distinct from v_version_id then
      return public.gbp_approval_fail('refresh_required');
    end if;
    v_choice := v_decision->>'decision';
    if v_choice not in ('approved', 'changes_requested') then
      return public.gbp_approval_fail('invalid_request');
    end if;
    v_comment := nullif(btrim(coalesce(v_decision->>'comment', '')), '');
    v_suggested_title := nullif(btrim(coalesce(v_decision->>'suggestedTitle', '')), '');
    v_suggested_body := nullif(regexp_replace(coalesce(v_decision->>'suggestedBody', ''), '^\s+|\s+$', '', 'g'), '');
    v_reservation_id := public.gbp_approval_uuid_or_null(nullif(v_decision->>'reservationId', ''));
    if v_choice = 'approved' and (v_comment is not null or v_suggested_title is not null or v_suggested_body is not null or v_reservation_id is not null) then
      return public.gbp_approval_fail('invalid_request');
    end if;
    if v_choice = 'changes_requested' and v_comment is null then
      return public.gbp_approval_fail('comment_required');
    end if;
    if char_length(coalesce(v_comment, '')) > 4000
       or char_length(coalesce(v_suggested_title, '')) > 80
       or char_length(coalesce(v_suggested_body, '')) > 2000 then
      return public.gbp_approval_fail('invalid_request');
    end if;
    if v_reservation_id is not null then
      if not (v_reservation_id = any(v_verified)) then
        return public.gbp_approval_fail('upload_not_verified');
      end if;
      select * into v_reservation
      from public.approval_upload_reservations
      where id = v_reservation_id
        and request_id = v_request.id
        and link_id = v_link.id
        and status = 'reserved'
        and expires_at > p_now
      for update;
      if not found or v_reservation.object_key is distinct from
         'gbp-approvals/' || v_request.id::text || '/' || v_reservation.id::text then
        return public.gbp_approval_fail('out_of_scope');
      end if;
    end if;
    if v_item.decision_locked_at is not null then
      select response.* into v_prev
      from public.approval_responses as response
      join public.approval_submissions as submission on submission.id = response.submission_id
      where response.item_id = v_item.id and response.version_id = v_item.current_version_id
      order by submission.created_at desc
      limit 1;
      if not found
         or v_prev.decision is distinct from v_choice
         or coalesce(v_prev.comment, '') is distinct from coalesce(v_comment, '')
         or coalesce(v_prev.suggested_title, '') is distinct from coalesce(v_suggested_title, '')
         or coalesce(v_prev.suggested_body, '') is distinct from coalesce(v_suggested_body, '')
         or v_reservation_id is not null
      then
        return public.gbp_approval_fail('decision_locked');
      end if;
    end if;
  end loop;

  for v_answer in select value from jsonb_array_elements(coalesce(p_payload->'answers', '[]'::jsonb))
  loop
    v_answer_text := nullif(btrim(coalesce(v_answer->>'answer', '')), '');
    if v_answer_text is null then
      continue;
    end if;
    v_has_work := true;
    if char_length(v_answer_text) > 2000 then
      return public.gbp_approval_fail('invalid_request');
    end if;
    v_question_id := public.gbp_approval_uuid_or_null(v_answer->>'questionId');
    if v_question_id is null then
      return public.gbp_approval_fail('invalid_request');
    end if;
    if not exists (
      select 1 from public.approval_questions
      where id = v_question_id and request_id = v_request.id
    ) then
      return public.gbp_approval_fail('out_of_scope');
    end if;
  end loop;

  if not v_has_work then
    return public.gbp_approval_fail('nothing_to_send');
  end if;

  select * into v_link from public.approval_links where id = v_link.id and token_hash = p_token_hash for update;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  if v_link.revoked_at is not null then
    return public.gbp_approval_fail('revoked');
  end if;
  if v_link.expires_at <= p_now then
    return public.gbp_approval_fail('expired');
  end if;

  insert into public.approval_submissions (
    organization_id, request_id, link_id, idempotency_key, request_hash,
    respondent_name, respondent_email, ip_hash, created_at
  ) values (
    v_request.organization_id, v_request.id, v_link.id, v_key, v_hash,
    v_name, v_email, p_ip_hash, p_now
  ) returning id into v_submission_id;

  for v_decision in select value from jsonb_array_elements(p_payload->'decisions')
  loop
    v_item_id := (v_decision->>'itemId')::uuid;
    select * into v_item from public.approval_items where id = v_item_id for update;
    v_choice := v_decision->>'decision';
    v_comment := nullif(btrim(coalesce(v_decision->>'comment', '')), '');
    v_suggested_title := nullif(btrim(coalesce(v_decision->>'suggestedTitle', '')), '');
    v_suggested_body := nullif(regexp_replace(coalesce(v_decision->>'suggestedBody', ''), '^\s+|\s+$', '', 'g'), '');
    v_reservation_id := public.gbp_approval_uuid_or_null(nullif(v_decision->>'reservationId', ''));
    v_skip := v_item.decision_locked_at is not null;
    if v_skip then
      continue;
    end if;
    insert into public.approval_responses (
      organization_id, request_id, submission_id, item_id, version_id,
      decision, comment, suggested_title, suggested_body, replacement_photo_path, created_at
    ) values (
      v_request.organization_id, v_request.id, v_submission_id, v_item.id, v_item.current_version_id,
      v_choice, v_comment, v_suggested_title, v_suggested_body,
      case when v_reservation_id is null then null
           else (select object_key from public.approval_upload_reservations where id = v_reservation_id)
      end,
      p_now
    ) returning id into v_response_id;
    if v_reservation_id is not null then
      update public.approval_upload_reservations
        set status = 'attached', response_id = v_response_id
        where id = v_reservation_id and status = 'reserved';
    end if;
    update public.approval_items
      set status = case when v_choice = 'approved' then 'approved' else 'changes_requested' end
      where id = v_item.id;
  end loop;

  for v_answer in select value from jsonb_array_elements(coalesce(p_payload->'answers', '[]'::jsonb))
  loop
    v_answer_text := nullif(btrim(coalesce(v_answer->>'answer', '')), '');
    if v_answer_text is null then
      continue;
    end if;
    v_question_id := (v_answer->>'questionId')::uuid;
    insert into public.approval_question_answers (
      organization_id, request_id, submission_id, question_id, answer, created_at
    ) values (
      v_request.organization_id, v_request.id, v_submission_id, v_question_id, v_answer_text, p_now
    );
  end loop;

  select count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'changes_requested'),
         count(*) filter (where status = 'pending')
    into v_approved, v_changes, v_pending
  from public.approval_items
  where request_id = v_request.id;

  select count(*) into v_questions from public.approval_questions where request_id = v_request.id;
  select count(*) into v_answered
  from (
    select distinct on (answer.question_id) answer.answer
    from public.approval_question_answers as answer
    join public.approval_submissions as submission on submission.id = answer.submission_id
    where answer.request_id = v_request.id
    order by answer.question_id, submission.created_at desc
  ) latest
  where btrim(latest.answer) <> '';

  select status, due_date into v_task_status, v_task_due
  from public.tasks where id = v_request.task_id;
  v_advanced := null;
  if v_pending = 0 and v_changes = 0 and v_approved > 0 and v_task_status = 'todo' then
    update public.tasks
      set status = 'in_progress',
          status_history = coalesce(status_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'status', 'in_progress',
            'at', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'by', 'gbp-approval'
          ))
      where id = v_request.task_id and status = 'todo'
      returning id into v_advanced;
    if v_advanced is not null then
      insert into public.approval_events (organization_id, request_id, actor_id, kind, detail, created_at)
      values (
        v_request.organization_id, v_request.id, null, 'task_advanced',
        jsonb_build_object('from', 'todo', 'to', 'in_progress'), p_now
      );
    end if;
  end if;

  select coalesce(array_agg(distinct uid), '{}') into v_users
  from (
    select unnest(coalesce(task.assignee_ids, '{}'::uuid[])) as uid
    from public.tasks as task
    where task.id = v_request.task_id
    union
    select member.user_id
    from public.organization_members as member
    where member.organization_id = v_request.organization_id and member.role = 'owner'
  ) people
  where uid is not null;

  v_body := v_name || ' sent a review of ' || v_request.title || '. '
    || v_approved || ' approved, ' || v_changes || ' changes requested.';
  if v_advanced is not null then
    v_body := v_body || ' The task is now In Progress.';
  end if;
  insert into public.notifications (
    organization_id, user_id, type, title, body, entity_type, entity_id, client_id
  )
  select v_request.organization_id, uid, 'gbp_approval_response',
         'A client sent a review', v_body, 'gbp_approval_request', v_request.id::text, v_request.client_id
  from unnest(v_users) as uid;

  update public.approval_requests set updated_at = p_now where id = v_request.id;

  return jsonb_build_object(
    'ok', true,
    'idempotent', false,
    'submissionId', v_submission_id,
    'summary', jsonb_build_object(
      'approved', v_approved,
      'changesRequested', v_changes,
      'pending', v_pending,
      'questionsAnswered', v_answered,
      'questionsTotal', v_questions
    ),
    'taskAdvanced', v_advanced is not null
  );
exception
  when invalid_text_representation then
    return public.gbp_approval_fail('invalid_request');
end;
$fn$;

create or replace function public.gbp_approval_uuid_or_null(p_value text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog, public
as $fn$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  if btrim(p_value) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;
  return btrim(p_value)::uuid;
exception
  when others then
    return null;
end;
$fn$;

create or replace function public.get_gbp_approval_by_token(
  p_token_hash text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_link public.approval_links%rowtype;
  v_request public.approval_requests%rowtype;
  v_client_name text;
  v_items jsonb;
  v_questions jsonb;
  v_approved integer;
  v_changes integer;
  v_pending integer;
  v_answered integer;
  v_question_count integer;
  v_had boolean;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return public.gbp_approval_fail('not_found');
  end if;
  select * into v_link from public.approval_links where token_hash = p_token_hash;
  if not found then
    return public.gbp_approval_fail('not_found');
  end if;
  select * into v_request from public.approval_requests where id = v_link.request_id;
  select name into v_client_name from public.clients where id = v_request.client_id;
  v_had := exists (select 1 from public.approval_submissions where request_id = v_request.id);

  if v_link.revoked_at is not null or v_link.expires_at <= p_now then
    return jsonb_build_object(
      'ok', true,
      'state', case when v_link.revoked_at is not null then 'revoked' else 'expired' end,
      'title', v_request.title,
      'clientName', coalesce(v_client_name, 'your account'),
      'expiresAt', v_link.expires_at,
      'hadSubmission', v_had
    );
  end if;

  if public.gbp_approval_hit_count(p_token_hash, 'read', p_now) >= 120 then
    return public.gbp_approval_fail('rate_limited');
  end if;
  insert into public.approval_public_hits (token_hash, action, created_at)
  values (p_token_hash, 'read', p_now);
  update public.approval_links
    set view_count = view_count + 1, last_viewed_at = p_now
    where id = v_link.id;

  select coalesce(jsonb_agg(item_json order by position), '[]'::jsonb) into v_items
  from (
    select item.position,
      jsonb_build_object(
        'id', item.id,
        'position', item.position,
        'status', item.status,
        'locked', item.decision_locked_at is not null,
        'version', jsonb_build_object(
          'id', version.id,
          'versionNo', version.version_no,
          'payload', version.payload,
          'photoPath', version.photo_path,
          'changeNote', version.change_note,
          'previous', (
            select jsonb_build_object(
              'versionNo', previous.version_no,
              'payload', previous.payload,
              'photoPath', previous.photo_path
            )
            from public.approval_item_versions as previous
            where previous.item_id = item.id and previous.version_no = version.version_no - 1
          )
        ),
        'decision', (
          select jsonb_build_object(
            'decision', response.decision,
            'comment', response.comment,
            'suggestedTitle', response.suggested_title,
            'suggestedBody', response.suggested_body,
            'replacementPhotoPath', response.replacement_photo_path
          )
          from public.approval_responses as response
          join public.approval_submissions as submission on submission.id = response.submission_id
          where response.item_id = item.id and response.version_id = version.id
          order by submission.created_at desc
          limit 1
        )
      ) as item_json
    from public.approval_items as item
    join public.approval_item_versions as version on version.id = item.current_version_id
    where item.request_id = v_request.id
  ) rows;

  select coalesce(jsonb_agg(question_json order by position), '[]'::jsonb) into v_questions
  from (
    select question.position,
      jsonb_build_object(
        'id', question.id,
        'prompt', question.prompt,
        'itemId', question.item_id,
        'answer', (
          select answer.answer
          from public.approval_question_answers as answer
          join public.approval_submissions as submission on submission.id = answer.submission_id
          where answer.question_id = question.id
          order by submission.created_at desc
          limit 1
        )
      ) as question_json
    from public.approval_questions as question
    where question.request_id = v_request.id
  ) rows;

  select count(*) filter (where status = 'approved'),
         count(*) filter (where status = 'changes_requested'),
         count(*) filter (where status = 'pending')
    into v_approved, v_changes, v_pending
  from public.approval_items where request_id = v_request.id;
  select count(*) into v_question_count from public.approval_questions where request_id = v_request.id;
  select count(*) into v_answered
  from (
    select distinct on (answer.question_id) answer.answer
    from public.approval_question_answers as answer
    join public.approval_submissions as submission on submission.id = answer.submission_id
    where answer.request_id = v_request.id
    order by answer.question_id, submission.created_at desc
  ) latest
  where btrim(latest.answer) <> '';

  return jsonb_build_object(
    'ok', true,
    'state', 'active',
    'title', v_request.title,
    'clientName', coalesce(v_client_name, 'your account'),
    'dueAt', v_request.due_at,
    'round', v_request.round,
    'expiresAt', v_link.expires_at,
    'items', v_items,
    'questions', v_questions,
    'summary', jsonb_build_object(
      'approved', v_approved,
      'changesRequested', v_changes,
      'pending', v_pending,
      'questionsAnswered', v_answered,
      'questionsTotal', v_question_count
    )
  );
end;
$fn$;

create or replace function public.purge_gbp_approval_retention(p_now timestamptz, p_removed_keys text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_ips integer;
  v_orphans integer;
  v_hits integer;
  v_keys text[];
begin
  perform set_config('gbp_approval.purge', 'on', true);
  update public.approval_submissions
    set ip_hash = null
    where ip_hash is not null
      and created_at < p_now - interval '12 months';
  get diagnostics v_ips = row_count;
  select coalesce(array_agg(object_key), '{}'::text[]) into v_keys
    from public.approval_upload_reservations
    where status = 'reserved' and expires_at <= p_now
      and created_at < p_now - interval '24 hours';
  -- The caller removes these objects through Storage before acknowledging keys.
  delete from public.approval_upload_reservations
    where status = 'reserved' and expires_at <= p_now
      and created_at < p_now - interval '24 hours'
      and object_key = any(p_removed_keys);
  get diagnostics v_orphans = row_count;
  delete from public.approval_public_hits
    where created_at < p_now - interval '48 hours';
  get diagnostics v_hits = row_count;
  return jsonb_build_object('ok', true, 'ipHashesCleared', v_ips, 'orphansDeleted', v_orphans, 'objectKeys', to_jsonb(v_keys), 'hitsDeleted', v_hits);
end;
$fn$;

-- ---------------------------------------------------------------------------
-- RLS. Read for org members. No write grant for authenticated. No anon policy.
-- ---------------------------------------------------------------------------

alter table public.approval_requests enable row level security;
alter table public.approval_items enable row level security;
alter table public.approval_item_versions enable row level security;
alter table public.approval_links enable row level security;
alter table public.approval_questions enable row level security;
alter table public.approval_submissions enable row level security;
alter table public.approval_responses enable row level security;
alter table public.approval_question_answers enable row level security;
alter table public.approval_events enable row level security;
alter table public.approval_upload_reservations enable row level security;
alter table public.approval_public_hits enable row level security;

do $policies$
declare
  t text;
begin
  foreach t in array array[
    'approval_requests',
    'approval_items',
    'approval_item_versions',
    'approval_links',
    'approval_questions',
    'approval_submissions',
    'approval_responses',
    'approval_question_answers',
    'approval_events',
    'approval_upload_reservations'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id in (select public.get_user_org_ids()))',
      t || '_select', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$policies$;

revoke all on table public.approval_public_hits from public, anon, authenticated;
grant all on table public.approval_public_hits to service_role;

-- ---------------------------------------------------------------------------
-- Function privileges. Public can execute new functions by default.
-- ---------------------------------------------------------------------------

do $exec$
declare
  signature text;
begin
  foreach signature in array array[
    'public.approval_request_same_org()',
    'public.approval_child_org()',
    'public.approval_version_scope()',
    'public.approval_item_identity()',
    'public.approval_item_has_version()',
    'public.approval_question_scope()',
    'public.approval_response_scope()',
    'public.approval_answer_scope()',
    'public.approval_submission_guard()',
    'public.approval_event_guard()',
    'public.approval_upload_guard()',
    'public.gbp_approval_calendar_date(text)',
    'public.gbp_approval_clean_post(jsonb, text)',
    'public.gbp_approval_visible(jsonb, text)',
    'public.gbp_approval_writer(uuid, uuid)',
    'public.gbp_approval_fail(text)',
    'public.gbp_approval_hit_count(text, text, timestamptz)',
    'public.gbp_approval_uuid_or_null(text)',
    'public.create_gbp_approval_request(uuid, uuid, uuid, uuid, text, timestamptz, jsonb, jsonb, text, text)',
    'public.issue_gbp_approval_link(uuid, uuid, text, timestamptz, timestamptz)',
    'public.extend_gbp_approval_link(uuid, uuid, timestamptz, timestamptz)',
    'public.revoke_gbp_approval_link(uuid, uuid, timestamptz)',
    'public.post_gbp_approval_version(uuid, uuid, jsonb, timestamptz)',
    'public.mark_gbp_approval_final(uuid, uuid, uuid, timestamptz)',
    'public.reserve_gbp_approval_upload(text, text, integer, timestamptz)',
    'public.submit_gbp_approval(text, jsonb, text, timestamptz)',
    'public.get_gbp_approval_by_token(text, timestamptz)',
    'public.purge_gbp_approval_retention(timestamptz, text[])'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', signature);
  end loop;
end;
$exec$;

grant execute on function
  public.create_gbp_approval_request(uuid, uuid, uuid, uuid, text, timestamptz, jsonb, jsonb, text, text),
  public.issue_gbp_approval_link(uuid, uuid, text, timestamptz, timestamptz),
  public.extend_gbp_approval_link(uuid, uuid, timestamptz, timestamptz),
  public.revoke_gbp_approval_link(uuid, uuid, timestamptz),
  public.post_gbp_approval_version(uuid, uuid, jsonb, timestamptz),
  public.mark_gbp_approval_final(uuid, uuid, uuid, timestamptz),
  public.reserve_gbp_approval_upload(text, text, integer, timestamptz),
  public.submit_gbp_approval(text, jsonb, text, timestamptz),
  public.get_gbp_approval_by_token(text, timestamptz),
  public.purge_gbp_approval_retention(timestamptz, text[])
to service_role;

-- ---------------------------------------------------------------------------
-- Private bucket. No storage policies: the browser cannot read or write it.
-- Signed URLs are issued by the server after the token or membership check.
-- ---------------------------------------------------------------------------

do $bucket$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'gbp-approval-uploads',
      'gbp-approval-uploads',
      false,
      10485760,
      array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    )
    on conflict (id) do update
      set public = false,
          file_size_limit = 10485760,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  end if;
end;
$bucket$;

comment on table public.approval_requests is
  'GBP approval request for one client task. Approval state lives on the items. Link expiry and revoke live on approval_links.';
comment on table public.approval_links is
  'One share link per request. token_hash is sha-256 of the raw token. The raw token is shown once and is not stored.';
comment on table public.approval_upload_reservations is
  'Upload slot whose object key is always gbp-approvals/{request_id}/{reservation_id}. A client cannot choose the key.';
comment on table public.approval_public_hits is
  'Coarse public rate-limit counters. The raw token is not stored.';
