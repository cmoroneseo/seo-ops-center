-- 057_content_approval_portal.sql
-- Content Approval Portal: Google-Docs-imported content reviewed by clients via a
-- tokenized link, with anchored comment threads, suggestions, and per-document approval.
--
-- Architecture notes that the schema encodes:
--   * Import-once. A doc is imported from Google Docs once; the app then owns it.
--     gdoc_document_id / gdoc_revision_id exist for the drift guard, not for re-import.
--   * working_json is the live internal draft. content_doc_versions are immutable
--     snapshots. Clients only ever read a published version.
--   * review_locked enforces "either open for review or open for editing, never both".
--   * No commitment/fulfillment rollup is stored here. Fulfillment is computed on read
--     from deliverables.status (see lib/supabase/fulfillment.ts DELIVERED_STATUSES).

-- ─── content_approval_batches ───────────────────────────────────────────────
create table public.content_approval_batches (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    name text not null,
    status text not null default 'draft'
        check (status in ('draft', 'in_review', 'completed', 'archived')),
    due_date date,
    created_by uuid references public.users(id),
    sent_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index content_approval_batches_client_idx
    on public.content_approval_batches (client_id, status);
create index content_approval_batches_org_idx
    on public.content_approval_batches (organization_id);

alter table public.content_approval_batches enable row level security;
create policy content_approval_batches_auth on public.content_approval_batches
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.content_approval_batches to service_role;

-- ─── content_approval_docs ──────────────────────────────────────────────────
-- deliverable_id is NOT NULL on purpose: a document with no linked deliverable is
-- invisible to the fulfillment matrix, so approving it would close nothing.
create table public.content_approval_docs (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references public.content_approval_batches(id) on delete cascade,
    organization_id uuid not null,
    deliverable_id uuid not null references public.deliverables(id) on delete restrict,
    title text not null,
    subtype text,
    position integer not null default 0,
    working_json jsonb not null default '{}'::jsonb,
    current_version_id uuid,
    review_locked boolean not null default false,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'approved_with_edits', 'changes_requested')),
    decided_at timestamptz,
    decided_by_label text,
    seo_meta jsonb not null default '{}'::jsonb,
    gdoc_document_id text,
    gdoc_revision_id text,
    gdoc_imported_at timestamptz,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index content_approval_docs_batch_idx
    on public.content_approval_docs (batch_id, position);
create index content_approval_docs_deliverable_idx
    on public.content_approval_docs (deliverable_id);
-- Drift guard sweep: only docs actually imported from a Doc are candidates.
create index content_approval_docs_gdoc_idx
    on public.content_approval_docs (gdoc_document_id)
    where gdoc_document_id is not null and archived_at is null;

alter table public.content_approval_docs enable row level security;
create policy content_approval_docs_auth on public.content_approval_docs
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.content_approval_docs to service_role;

-- ─── content_doc_versions ───────────────────────────────────────────────────
-- Immutable. Enforced by trigger below — approval is stamped against a version_id,
-- so a mutable version would let an approval of v1 silently cover v3.
create table public.content_doc_versions (
    id uuid primary key default gen_random_uuid(),
    doc_id uuid not null references public.content_approval_docs(id) on delete cascade,
    organization_id uuid not null,
    version_no integer not null,
    content_json jsonb not null,
    content_html text,
    word_count integer not null default 0,
    published_by uuid references public.users(id),
    created_at timestamptz not null default now()
);

create unique index content_doc_versions_doc_no_unique
    on public.content_doc_versions (doc_id, version_no);

alter table public.content_doc_versions enable row level security;
create policy content_doc_versions_auth on public.content_doc_versions
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.content_doc_versions to service_role;

create or replace function public.protect_content_doc_version_immutability()
returns trigger
language plpgsql
as $$
begin
    raise exception 'content_doc_versions rows are immutable (doc %, version %)',
        old.doc_id, old.version_no
        using errcode = '42501';
end;
$$;

create trigger protect_content_doc_version_immutability
    before update on public.content_doc_versions
    for each row execute function public.protect_content_doc_version_immutability();

alter table public.content_approval_docs
    add constraint content_approval_docs_current_version_fk
    foreign key (current_version_id) references public.content_doc_versions(id)
    on delete set null;

-- ─── content_comments ───────────────────────────────────────────────────────
-- anchor jsonb = { from, to, quotedText, prefix, suffix }
create table public.content_comments (
    id uuid primary key default gen_random_uuid(),
    doc_id uuid not null references public.content_approval_docs(id) on delete cascade,
    organization_id uuid not null,
    version_id uuid references public.content_doc_versions(id) on delete set null,
    thread_root_id uuid references public.content_comments(id) on delete cascade,
    parent_id uuid references public.content_comments(id) on delete cascade,
    author_type text not null check (author_type in ('internal', 'client')),
    author_user_id uuid references public.users(id),
    author_label text not null,
    body text not null,
    anchor jsonb,
    status text not null default 'open'
        check (status in ('open', 'resolved', 'orphaned')),
    resolved_by uuid references public.users(id),
    resolved_at timestamptz,
    task_id uuid references public.tasks(id) on delete set null,
    -- Which share link this came in through. FK added after content_share_links below.
    -- Provenance for client-submitted content, and what the portal rate limit counts.
    portal_link_id uuid,
    edited_at timestamptz,
    created_at timestamptz not null default now(),
    -- A thread root carries the anchor; replies never do.
    constraint content_comments_root_has_anchor
        check ((parent_id is null and anchor is not null) or parent_id is not null)
);

create index content_comments_doc_idx on public.content_comments (doc_id, status);
create index content_comments_thread_idx on public.content_comments (thread_root_id);
create index content_comments_task_idx on public.content_comments (task_id)
    where task_id is not null;
-- Serves the portal rate-limit lookup (writes per link per minute).
create index content_comments_portal_link_idx
    on public.content_comments (portal_link_id, created_at)
    where portal_link_id is not null;

alter table public.content_comments enable row level security;
create policy content_comments_auth on public.content_comments
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.content_comments to service_role;

-- ─── content_suggestions ────────────────────────────────────────────────────
-- A proposed patch against a frozen version. origin 'ai' covers Fix with AI (phase 2);
-- AI output is a pending suggestion like any other and is never auto-applied.
create table public.content_suggestions (
    id uuid primary key default gen_random_uuid(),
    doc_id uuid not null references public.content_approval_docs(id) on delete cascade,
    organization_id uuid not null,
    version_id uuid references public.content_doc_versions(id) on delete set null,
    comment_id uuid references public.content_comments(id) on delete set null,
    kind text not null check (kind in ('insert', 'delete', 'replace')),
    anchor jsonb not null,
    payload text not null default '',
    origin text not null default 'client' check (origin in ('client', 'internal', 'ai')),
    author_label text not null,
    portal_link_id uuid,
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'rejected')),
    decided_by uuid references public.users(id),
    decided_at timestamptz,
    applied_in_version_id uuid references public.content_doc_versions(id) on delete set null,
    created_at timestamptz not null default now()
);

create index content_suggestions_doc_idx on public.content_suggestions (doc_id, status);

alter table public.content_suggestions enable row level security;
create policy content_suggestions_auth on public.content_suggestions
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.content_suggestions to service_role;

-- ─── content_share_links ────────────────────────────────────────────────────
-- token_hash is sha-256 of the token. The raw token is shown to the internal user
-- once and never stored. Portal routes verify by hash using the service-role client.
create table public.content_share_links (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null references public.content_approval_batches(id) on delete cascade,
    organization_id uuid not null,
    token_hash text not null,
    allow_comments boolean not null default true,
    expires_at timestamptz,
    revoked_at timestamptz,
    first_viewed_at timestamptz,
    last_viewed_at timestamptz,
    view_count integer not null default 0,
    created_by uuid references public.users(id),
    created_at timestamptz not null default now()
);

create unique index content_share_links_token_unique
    on public.content_share_links (token_hash);
create index content_share_links_batch_idx on public.content_share_links (batch_id);

alter table public.content_share_links enable row level security;
create policy content_share_links_auth on public.content_share_links
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.content_share_links to service_role;

alter table public.content_comments
    add constraint content_comments_portal_link_fk
    foreign key (portal_link_id) references public.content_share_links(id) on delete set null;

alter table public.content_suggestions
    add constraint content_suggestions_portal_link_fk
    foreign key (portal_link_id) references public.content_share_links(id) on delete set null;

-- ─── content_share_reviewers ────────────────────────────────────────────────
-- "Who's reviewing?" — a label for attribution, not an account.
create table public.content_share_reviewers (
    id uuid primary key default gen_random_uuid(),
    share_link_id uuid not null references public.content_share_links(id) on delete cascade,
    organization_id uuid not null,
    name text not null,
    email text,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create index content_share_reviewers_link_idx
    on public.content_share_reviewers (share_link_id);

alter table public.content_share_reviewers enable row level security;
create policy content_share_reviewers_auth on public.content_share_reviewers
    for all to authenticated
    using (organization_id in (select public.get_user_org_ids()))
    with check (organization_id in (select public.get_user_org_ids()));
grant all on public.content_share_reviewers to service_role;

-- ─── Function hardening ─────────────────────────────────────────────────────
revoke all on function public.protect_content_doc_version_immutability() from public, anon, authenticated;
grant execute on function public.protect_content_doc_version_immutability() to service_role;
