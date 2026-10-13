begin;

-- Context Vault phase 1. Staff record decisions, rules, approvals, contacts,
-- and precedents. Rules store block/warn intent only; nothing is enforced.
-- client_vault_evidence is the later attachment point for GSC before/after
-- snapshots. This migration does not backfill or capture anything automatically.

create table public.client_vault_entries (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    lineage_id uuid not null,
    version_no integer not null check (version_no >= 1),
    supersedes_id uuid,
    entry_type text not null check (entry_type in ('decision', 'rule', 'approval', 'contact', 'precedent')),
    status text not null default 'active' check (status in ('active', 'superseded', 'archived')),
    title text not null check (char_length(btrim(title)) between 1 and 180),
    body text not null check (char_length(btrim(body)) between 1 and 8000),
    rule_kind text check (rule_kind in ('content', 'linking', 'technical', 'brand', 'reporting', 'access', 'other')),
    enforcement text check (enforcement in ('block', 'warn')),
    rule_details jsonb,
    contact_details jsonb,
    applies_to text[] not null default '{}',
    effective_on date not null,
    review_on date,
    pinned boolean not null default false,
    author_id uuid references public.users(id),
    proposed_by uuid references public.users(id),
    suggestion_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    archived_at timestamptz,
    superseded_at timestamptz,
    search_vector tsvector,
    check (
        (entry_type = 'rule' and rule_kind is not null and enforcement is not null)
        or (entry_type <> 'rule' and rule_kind is null and enforcement is null)
    ),
    check (entry_type <> 'contact' or (jsonb_typeof(contact_details) = 'object' and char_length(btrim(coalesce(contact_details->>'name', ''))) between 1 and 120)),
    check (cardinality(applies_to) <= 12),
    check (review_on is null or review_on >= effective_on),
    check ((version_no = 1 and supersedes_id is null) or (version_no > 1 and supersedes_id is not null)),
    check ((status = 'archived') = (archived_at is not null)),
    check ((status = 'superseded') = (superseded_at is not null)),
    check (status <> 'active' or (archived_at is null and superseded_at is null)),
    unique (id, organization_id, client_id),
    unique (lineage_id, version_no)
);

comment on column public.client_vault_entries.enforcement is
    'Recorded intent only. Phase 1 does not block or warn from this value.';
comment on column public.client_vault_entries.search_vector is
    'Full-text index over title, body, rule kind, contact name, and purposes.';

create unique index client_vault_entries_one_active_idx
    on public.client_vault_entries (lineage_id)
    where status = 'active';
create index client_vault_entries_search_idx
    on public.client_vault_entries using gin (search_vector);
create index client_vault_entries_lookup_idx
    on public.client_vault_entries (organization_id, client_id, status, effective_on desc);
create index client_vault_entries_lineage_idx
    on public.client_vault_entries (lineage_id, version_no desc);
create index client_vault_entries_author_idx
    on public.client_vault_entries (author_id);
create index client_vault_entries_proposed_idx
    on public.client_vault_entries (proposed_by);

alter table public.client_vault_entries
    add constraint client_vault_entries_supersedes_fkey
    foreign key (supersedes_id) references public.client_vault_entries(id);

-- Verbatim client words plus a pointer back to where they were said.
create table public.client_vault_sources (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    entry_id uuid not null,
    quote text not null check (char_length(btrim(quote)) between 1 and 8000),
    source_kind text not null check (source_kind in ('email', 'meeting', 'document', 'call', 'chat', 'member_proposal', 'other')),
    source_ref text check (source_ref is null or char_length(source_ref) between 1 and 500),
    created_at timestamptz not null default now(),
    foreign key (entry_id, organization_id, client_id)
        references public.client_vault_entries (id, organization_id, client_id) on delete cascade
);
create index client_vault_sources_entry_idx on public.client_vault_sources (entry_id);

-- Member proposals. Admins accept or dismiss; the proposer may withdraw their own.
create table public.client_vault_suggestions (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    proposed_by uuid not null references public.users(id),
    status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed', 'withdrawn')),
    payload jsonb not null check (jsonb_typeof(payload) = 'object'),
    dismiss_reason text check (dismiss_reason is null or char_length(dismiss_reason) between 1 and 500),
    resolved_by uuid references public.users(id),
    resolved_entry_id uuid,
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    check ((status = 'pending') = (resolved_at is null)),
    check (status <> 'accepted' or resolved_entry_id is not null),
    check (dismiss_reason is null or status = 'dismissed'),
    foreign key (resolved_entry_id, organization_id, client_id)
        references public.client_vault_entries (id, organization_id, client_id)
);
create index client_vault_suggestions_lookup_idx
    on public.client_vault_suggestions (organization_id, client_id, status, created_at desc);
create index client_vault_suggestions_proposer_idx
    on public.client_vault_suggestions (proposed_by, status);

-- Empty in phase 1. Later phases insert gsc_before / gsc_after snapshots
-- against an entry without rewriting the immutable entry body.
create table public.client_vault_evidence (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references public.organizations(id) on delete cascade,
    client_id uuid not null references public.clients(id) on delete cascade,
    entry_id uuid not null,
    kind text not null check (kind in ('gsc_before', 'gsc_after')),
    label text check (label is null or char_length(label) between 1 and 160),
    payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
    captured_on date,
    created_at timestamptz not null default now(),
    foreign key (entry_id, organization_id, client_id)
        references public.client_vault_entries (id, organization_id, client_id) on delete cascade
);
create index client_vault_evidence_entry_idx on public.client_vault_evidence (entry_id, kind);
comment on table public.client_vault_evidence is
    'Future GSC before/after evidence for a vault entry. Phase 1 has no writer.';

alter table public.client_vault_entries enable row level security;
alter table public.client_vault_sources enable row level security;
alter table public.client_vault_suggestions enable row level security;
alter table public.client_vault_evidence enable row level security;

-- Org members can read. A live portal contact for this client cannot, even if
-- they also hold a staff membership. Direct writes are revoked below.
create policy client_vault_entries_read on public.client_vault_entries
    for select to authenticated
    using (
        organization_id in (select public.get_user_org_ids())
        and not exists (
            select 1 from public.client_portal_contacts portal
            where portal.user_id = auth.uid()
              and portal.client_id = client_vault_entries.client_id
              and portal.revoked_at is null
        )
    );
create policy client_vault_sources_read on public.client_vault_sources
    for select to authenticated
    using (
        organization_id in (select public.get_user_org_ids())
        and not exists (
            select 1 from public.client_portal_contacts portal
            where portal.user_id = auth.uid()
              and portal.client_id = client_vault_sources.client_id
              and portal.revoked_at is null
        )
    );
create policy client_vault_suggestions_read on public.client_vault_suggestions
    for select to authenticated
    using (
        organization_id in (select public.get_user_org_ids())
        and not exists (
            select 1 from public.client_portal_contacts portal
            where portal.user_id = auth.uid()
              and portal.client_id = client_vault_suggestions.client_id
              and portal.revoked_at is null
        )
    );
create policy client_vault_evidence_read on public.client_vault_evidence
    for select to authenticated
    using (
        organization_id in (select public.get_user_org_ids())
        and not exists (
            select 1 from public.client_portal_contacts portal
            where portal.user_id = auth.uid()
              and portal.client_id = client_vault_evidence.client_id
              and portal.revoked_at is null
        )
    );

revoke all on public.client_vault_entries, public.client_vault_sources,
    public.client_vault_suggestions, public.client_vault_evidence
    from public, anon, authenticated;
grant select on public.client_vault_entries, public.client_vault_sources,
    public.client_vault_suggestions, public.client_vault_evidence to authenticated;
grant all on public.client_vault_entries, public.client_vault_sources,
    public.client_vault_suggestions, public.client_vault_evidence to service_role;

create function public.guard_client_vault_entry() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
    if tg_op = 'INSERT' then
        new.search_vector :=
            setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
            || setweight(to_tsvector('english', coalesce(new.body, '')), 'B')
            || setweight(to_tsvector('english', coalesce(new.rule_kind, '')), 'C')
            || setweight(to_tsvector('english', coalesce(new.contact_details->>'name', '')), 'A')
            || setweight(to_tsvector('english', coalesce(array_to_string(new.applies_to, ' '), '')), 'C');
    end if;
    if not exists (
        select 1 from public.clients
        where id = new.client_id and organization_id = new.organization_id
    ) then
        raise exception 'Client does not belong to this organization' using errcode = '23514';
    end if;
    if new.supersedes_id is not null and not exists (
        select 1 from public.client_vault_entries previous
        where previous.id = new.supersedes_id
          and previous.lineage_id = new.lineage_id
          and previous.client_id = new.client_id
          and previous.organization_id = new.organization_id
          and previous.version_no = new.version_no - 1
    ) then
        raise exception 'Vault version chain is broken' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
        if old.status <> 'active' then
            raise exception 'Only the active vault version can change' using errcode = '23514';
        end if;
        if new.organization_id is distinct from old.organization_id
            or new.client_id is distinct from old.client_id
            or new.lineage_id is distinct from old.lineage_id
            or new.version_no is distinct from old.version_no
            or new.supersedes_id is distinct from old.supersedes_id
            or new.entry_type is distinct from old.entry_type
            or new.title is distinct from old.title
            or new.body is distinct from old.body
            or new.rule_kind is distinct from old.rule_kind
            or new.enforcement is distinct from old.enforcement
            or new.rule_details is distinct from old.rule_details
            or new.contact_details is distinct from old.contact_details
            or new.applies_to is distinct from old.applies_to
            or new.effective_on is distinct from old.effective_on
            or new.author_id is distinct from old.author_id
            or new.proposed_by is distinct from old.proposed_by
            or new.suggestion_id is distinct from old.suggestion_id
            or new.created_at is distinct from old.created_at
            or new.search_vector is distinct from old.search_vector
        then
            raise exception 'Vault entry content is immutable' using errcode = '23514';
        end if;
        if new.status is distinct from old.status and new.status not in ('superseded', 'archived') then
            raise exception 'Vault versions cannot be reactivated' using errcode = '23514';
        end if;
    end if;
    return new;
end;
$$;

create function public.guard_client_vault_source() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
    if tg_op <> 'INSERT' then
        raise exception 'Vault sources are immutable' using errcode = '23514';
    end if;
    if not exists (
        select 1 from public.clients
        where id = new.client_id and organization_id = new.organization_id
    ) then
        raise exception 'Client does not belong to this organization' using errcode = '23514';
    end if;
    if not exists (
        select 1 from public.client_vault_entries entry
        where entry.id = new.entry_id
          and entry.client_id = new.client_id
          and entry.organization_id = new.organization_id
    ) then
        raise exception 'Vault source does not belong to this client' using errcode = '23514';
    end if;
    return new;
end;
$$;

create function public.guard_client_vault_suggestion() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
    if not exists (
        select 1 from public.clients
        where id = new.client_id and organization_id = new.organization_id
    ) then
        raise exception 'Client does not belong to this organization' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' then
        if old.status <> 'pending' then
            raise exception 'Resolved vault suggestions are immutable' using errcode = '23514';
        end if;
        if new.organization_id is distinct from old.organization_id
            or new.client_id is distinct from old.client_id
            or new.proposed_by is distinct from old.proposed_by
            or new.payload is distinct from old.payload
            or new.created_at is distinct from old.created_at
            or new.id is distinct from old.id
        then
            raise exception 'Vault suggestion content is immutable' using errcode = '23514';
        end if;
        if new.status not in ('accepted', 'dismissed', 'withdrawn') then
            raise exception 'Vault suggestion status is invalid' using errcode = '23514';
        end if;
    end if;
    return new;
end;
$$;

create function public.guard_client_vault_evidence() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
    if tg_op <> 'INSERT' then
        raise exception 'Vault evidence is immutable' using errcode = '23514';
    end if;
    if not exists (
        select 1 from public.clients
        where id = new.client_id and organization_id = new.organization_id
    ) then
        raise exception 'Client does not belong to this organization' using errcode = '23514';
    end if;
    if not exists (
        select 1 from public.client_vault_entries entry
        where entry.id = new.entry_id
          and entry.client_id = new.client_id
          and entry.organization_id = new.organization_id
    ) then
        raise exception 'Vault evidence does not belong to this client' using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger client_vault_entries_guard
    before insert or update on public.client_vault_entries
    for each row execute function public.guard_client_vault_entry();
create trigger client_vault_sources_guard
    before insert or update or delete on public.client_vault_sources
    for each row execute function public.guard_client_vault_source();
create trigger client_vault_suggestions_guard
    before insert or update on public.client_vault_suggestions
    for each row execute function public.guard_client_vault_suggestion();
create trigger client_vault_evidence_guard
    before insert or update or delete on public.client_vault_evidence
    for each row execute function public.guard_client_vault_evidence();

create function public.vault_log(p_org uuid, p_client uuid, p_type text, p_metadata jsonb)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
    insert into public.client_activity_log (organization_id, client_id, event_type, actor_id, operation_id, metadata)
    values (p_org, p_client, p_type, auth.uid(), gen_random_uuid(), coalesce(p_metadata, '{}'::jsonb));
end;
$$;

create function public.vault_actor(p_client uuid, p_mode text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_org uuid;
    v_role text;
begin
    if auth.uid() is null then
        raise exception 'Unauthorized' using errcode = '42501';
    end if;
    if p_mode not in ('read', 'propose', 'admin') then
        raise exception 'Forbidden' using errcode = '42501';
    end if;
    select organization_id into v_org from public.clients where id = p_client;
    if v_org is null then
        raise exception 'Vault entry not found' using errcode = 'P0002';
    end if;
    if exists (
        select 1 from public.client_portal_contacts
        where user_id = auth.uid() and client_id = p_client and revoked_at is null
    ) then
        raise exception 'Portal contacts cannot access the vault' using errcode = '42501';
    end if;
    select role into v_role from public.organization_members
    where organization_id = v_org and user_id = auth.uid();
    if v_role is null or v_org not in (select public.get_user_org_ids()) then
        raise exception 'Forbidden' using errcode = '42501';
    end if;
    if p_mode = 'admin' and v_org not in (select public.get_user_admin_org_ids()) then
        raise exception 'Only owners and admins can change the vault' using errcode = '42501';
    end if;
    if p_mode = 'propose' and v_role not in ('owner', 'admin', 'member') then
        raise exception 'Viewers cannot propose vault entries' using errcode = '42501';
    end if;
    return jsonb_build_object('organizationId', v_org, 'role', v_role);
end;
$$;

create function public.vault_prepare_entry(p_input jsonb)
returns jsonb
language plpgsql stable set search_path = pg_catalog, public as $$
declare
    v_type text;
    v_title text;
    v_body text;
    v_rule_kind text;
    v_enforcement text;
    v_rule jsonb;
    v_contact jsonb;
    v_applies text[] := '{}';
    v_effective date;
    v_review date;
    v_pinned boolean := false;
    v_quote text;
    v_source_kind text;
    v_source_ref text;
    v_item text;
    v_purpose text;
begin
    if p_input is null or jsonb_typeof(p_input) <> 'object' then
        raise exception 'Vault entry is invalid' using errcode = '23514';
    end if;
    v_type := p_input->>'entryType';
    if v_type not in ('decision', 'rule', 'approval', 'contact', 'precedent') then
        raise exception 'Vault entry type is invalid' using errcode = '23514';
    end if;
    v_title := btrim(coalesce(p_input->>'title', ''));
    if char_length(v_title) < 1 or char_length(v_title) > 180 then
        raise exception 'Title must be between 1 and 180 characters' using errcode = '23514';
    end if;
    v_body := btrim(coalesce(p_input->>'body', ''));
    if char_length(v_body) < 1 or char_length(v_body) > 8000 then
        raise exception 'Body must be between 1 and 8000 characters' using errcode = '23514';
    end if;
    v_rule_kind := nullif(btrim(coalesce(p_input->>'ruleKind', '')), '');
    v_enforcement := nullif(btrim(coalesce(p_input->>'enforcement', '')), '');
    if v_type = 'rule' then
        if v_rule_kind not in ('content', 'linking', 'technical', 'brand', 'reporting', 'access', 'other') then
            raise exception 'Rule kind is invalid' using errcode = '23514';
        end if;
        if v_enforcement not in ('block', 'warn') then
            raise exception 'Rule enforcement must be block or warn' using errcode = '23514';
        end if;
        v_rule := coalesce(p_input->'ruleDetails', '{}'::jsonb);
        if jsonb_typeof(v_rule) <> 'object' then
            raise exception 'Rule details must be an object' using errcode = '23514';
        end if;
    elsif v_rule_kind is not null or v_enforcement is not null then
        raise exception 'Only rules record enforcement' using errcode = '23514';
    end if;
    if v_type = 'contact' then
        v_contact := p_input->'contactDetails';
        if v_contact is null or jsonb_typeof(v_contact) <> 'object' then
            raise exception 'Contact details are required' using errcode = '23514';
        end if;
        if char_length(btrim(coalesce(v_contact->>'name', ''))) not between 1 and 120 then
            raise exception 'Contact name is required' using errcode = '23514';
        end if;
        v_contact := jsonb_set(v_contact, '{name}', to_jsonb(btrim(v_contact->>'name')));
    end if;
    if p_input ? 'appliesTo' and jsonb_typeof(p_input->'appliesTo') <> 'null' then
        if jsonb_typeof(p_input->'appliesTo') <> 'array' then
            raise exception 'Applies-to must be a list' using errcode = '23514';
        end if;
        if jsonb_array_length(p_input->'appliesTo') > 12 then
            raise exception 'Applies-to is too long' using errcode = '23514';
        end if;
        for v_item in select jsonb_array_elements_text(p_input->'appliesTo') loop
            v_purpose := btrim(v_item);
            if v_purpose !~ '^[a-z0-9_]{1,40}$' then
                raise exception 'Applies-to values must be short slugs' using errcode = '23514';
            end if;
            if not v_purpose = any(v_applies) then
                v_applies := v_applies || v_purpose;
            end if;
        end loop;
    end if;
    if nullif(btrim(coalesce(p_input->>'effectiveOn', '')), '') is null then
        raise exception 'Effective date is required' using errcode = '23514';
    end if;
    begin
        v_effective := (p_input->>'effectiveOn')::date;
    exception when others then
        raise exception 'Effective date is invalid' using errcode = '23514';
    end;
    if p_input ? 'reviewOn' and nullif(p_input->>'reviewOn', '') is not null then
        begin
            v_review := (p_input->>'reviewOn')::date;
        exception when others then
            raise exception 'Review date is invalid' using errcode = '23514';
        end;
        if v_review < v_effective then
            raise exception 'Review date must be on or after the effective date' using errcode = '23514';
        end if;
    end if;
    if p_input ? 'pinned' and p_input->'pinned' <> 'null'::jsonb then
        begin
            v_pinned := (p_input->>'pinned')::boolean;
        exception when others then
            raise exception 'Pinned must be true or false' using errcode = '23514';
        end;
    end if;
    if p_input ? 'quote' and nullif(p_input->>'quote', '') is not null then
        v_quote := p_input->>'quote';
        if char_length(btrim(v_quote)) < 1 or char_length(v_quote) > 8000 then
            raise exception 'Quote must be between 1 and 8000 characters' using errcode = '23514';
        end if;
        v_source_kind := nullif(btrim(coalesce(p_input->>'sourceKind', '')), '');
        if v_source_kind is null then
            raise exception 'A quote needs a source kind' using errcode = '23514';
        end if;
        if v_source_kind not in ('email', 'meeting', 'document', 'call', 'chat', 'member_proposal', 'other') then
            raise exception 'Source kind is invalid' using errcode = '23514';
        end if;
        v_source_ref := p_input->>'sourceRef';
        if nullif(v_source_ref, '') is null then
            v_source_ref := null;
        elsif char_length(v_source_ref) > 500 then
            raise exception 'Source reference is too long' using errcode = '23514';
        end if;
    end if;
    return jsonb_build_object(
        'entry_type', v_type,
        'title', v_title,
        'body', v_body,
        'rule_kind', v_rule_kind,
        'enforcement', v_enforcement,
        'rule_details', v_rule,
        'contact_details', v_contact,
        'applies_to', to_jsonb(v_applies),
        'effective_on', v_effective,
        'review_on', v_review,
        'pinned', v_pinned,
        'quote', v_quote,
        'source_kind', v_source_kind,
        'source_ref', v_source_ref
    );
end;
$$;

create function public.vault_insert_entry(
    p_org uuid,
    p_client uuid,
    p_lineage uuid,
    p_version integer,
    p_supersedes uuid,
    p_author uuid,
    p_proposed uuid,
    p_suggestion uuid,
    p_normalized jsonb
) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_id uuid := gen_random_uuid();
    v_lineage uuid := coalesce(p_lineage, v_id);
    v_applies text[];
begin
    select coalesce(array_agg(value), '{}'::text[]) into v_applies
    from jsonb_array_elements_text(coalesce(p_normalized->'applies_to', '[]'::jsonb)) as value;
    insert into public.client_vault_entries (
        id, organization_id, client_id, lineage_id, version_no, supersedes_id,
        entry_type, status, title, body, rule_kind, enforcement, rule_details, contact_details,
        applies_to, effective_on, review_on, pinned, author_id, proposed_by, suggestion_id
    ) values (
        v_id, p_org, p_client, v_lineage, p_version, p_supersedes,
        p_normalized->>'entry_type', 'active', p_normalized->>'title', p_normalized->>'body',
        nullif(p_normalized->>'rule_kind', ''), nullif(p_normalized->>'enforcement', ''),
        case when jsonb_typeof(p_normalized->'rule_details') = 'object' then p_normalized->'rule_details' else null end,
        case when jsonb_typeof(p_normalized->'contact_details') = 'object' then p_normalized->'contact_details' else null end,
        coalesce(v_applies, '{}'::text[]),
        (p_normalized->>'effective_on')::date,
        nullif(p_normalized->>'review_on', '')::date,
        coalesce((p_normalized->>'pinned')::boolean, false),
        p_author, p_proposed, p_suggestion
    );
    if nullif(p_normalized->>'quote', '') is not null then
        insert into public.client_vault_sources (organization_id, client_id, entry_id, quote, source_kind, source_ref)
        values (
            p_org, p_client, v_id, p_normalized->>'quote', p_normalized->>'source_kind',
            nullif(p_normalized->>'source_ref', '')
        );
    end if;
    return v_id;
end;
$$;

create function public.vault_entry_json(p_id uuid)
returns jsonb
language sql stable security definer set search_path = pg_catalog, public as $$
    select jsonb_build_object(
        'id', entry.id,
        'organization_id', entry.organization_id,
        'client_id', entry.client_id,
        'lineage_id', entry.lineage_id,
        'version_no', entry.version_no,
        'supersedes_id', entry.supersedes_id,
        'entry_type', entry.entry_type,
        'status', entry.status,
        'title', entry.title,
        'body', entry.body,
        'rule_kind', entry.rule_kind,
        'enforcement', entry.enforcement,
        'rule_details', entry.rule_details,
        'contact_details', entry.contact_details,
        'applies_to', to_jsonb(entry.applies_to),
        'effective_on', entry.effective_on,
        'review_on', entry.review_on,
        'pinned', entry.pinned,
        'author_id', entry.author_id,
        'author_name', author.full_name,
        'proposed_by', entry.proposed_by,
        'proposed_by_name', proposer.full_name,
        'suggestion_id', entry.suggestion_id,
        'created_at', entry.created_at,
        'updated_at', entry.updated_at,
        'archived_at', entry.archived_at,
        'superseded_at', entry.superseded_at
    )
    from public.client_vault_entries entry
    left join public.users author on author.id = entry.author_id
    left join public.users proposer on proposer.id = entry.proposed_by
    where entry.id = p_id;
$$;

create function public.create_client_vault_entry(p_client uuid, p_input jsonb)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'admin');
    v_input jsonb := public.vault_prepare_entry(p_input);
    v_id uuid;
begin
    v_id := public.vault_insert_entry(
        (v_actor->>'organizationId')::uuid, p_client, null, 1, null, auth.uid(), null, null, v_input
    );
    perform public.vault_log((v_actor->>'organizationId')::uuid, p_client, 'vault.entry_created', jsonb_build_object(
        'entryId', v_id, 'lineageId', v_id, 'versionNo', 1,
        'entryType', v_input->>'entry_type', 'title', v_input->>'title', 'authorId', auth.uid()
    ));
    return v_id;
end;
$$;

create function public.propose_client_vault_entry(p_client uuid, p_input jsonb)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'propose');
    v_input jsonb := public.vault_prepare_entry(p_input);
    v_id uuid := gen_random_uuid();
begin
    insert into public.client_vault_suggestions (id, organization_id, client_id, proposed_by, payload)
    values (v_id, (v_actor->>'organizationId')::uuid, p_client, auth.uid(), v_input);
    perform public.vault_log((v_actor->>'organizationId')::uuid, p_client, 'vault.suggestion_proposed', jsonb_build_object(
        'suggestionId', v_id, 'entryType', v_input->>'entry_type', 'title', v_input->>'title', 'proposedBy', auth.uid()
    ));
    return v_id;
end;
$$;

create function public.supersede_client_vault_entry(p_client uuid, p_entry uuid, p_input jsonb)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'admin');
    v_input jsonb := public.vault_prepare_entry(p_input);
    v_current public.client_vault_entries%rowtype;
    v_id uuid;
begin
    select * into v_current from public.client_vault_entries
    where id = p_entry and client_id = p_client and status = 'active'
    for update;
    if not found then
        if exists (select 1 from public.client_vault_entries where id = p_entry and client_id = p_client) then
            raise exception 'Vault entry changed concurrently' using errcode = '40001';
        end if;
        raise exception 'Vault entry not found' using errcode = 'P0002';
    end if;
    if v_current.organization_id <> (v_actor->>'organizationId')::uuid then
        raise exception 'Forbidden' using errcode = '42501';
    end if;
    update public.client_vault_entries
    set status = 'superseded', superseded_at = now(), updated_at = now()
    where id = v_current.id;
    v_id := public.vault_insert_entry(
        v_current.organization_id, p_client, v_current.lineage_id, v_current.version_no + 1,
        v_current.id, auth.uid(), null, null, v_input
    );
    perform public.vault_log(v_current.organization_id, p_client, 'vault.entry_superseded', jsonb_build_object(
        'entryId', v_id, 'supersedesId', v_current.id, 'lineageId', v_current.lineage_id,
        'versionNo', v_current.version_no + 1, 'entryType', v_input->>'entry_type',
        'title', v_input->>'title', 'authorId', auth.uid()
    ));
    return v_id;
end;
$$;

create function public.archive_client_vault_entry(p_client uuid, p_entry uuid)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'admin');
    v_current public.client_vault_entries%rowtype;
begin
    select * into v_current from public.client_vault_entries
    where id = p_entry and client_id = p_client and status = 'active'
    for update;
    if not found then
        if exists (select 1 from public.client_vault_entries where id = p_entry and client_id = p_client) then
            raise exception 'Vault entry changed concurrently' using errcode = '40001';
        end if;
        raise exception 'Vault entry not found' using errcode = 'P0002';
    end if;
    update public.client_vault_entries
    set status = 'archived', archived_at = now(), updated_at = now()
    where id = v_current.id;
    perform public.vault_log((v_actor->>'organizationId')::uuid, p_client, 'vault.entry_archived', jsonb_build_object(
        'entryId', v_current.id, 'lineageId', v_current.lineage_id, 'title', v_current.title, 'authorId', auth.uid()
    ));
    return v_current.id;
end;
$$;

create function public.set_client_vault_pin_review(p_client uuid, p_entry uuid, p_patch jsonb)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'admin');
    v_current public.client_vault_entries%rowtype;
    v_pinned boolean;
    v_review date;
    v_set_review boolean := false;
begin
    if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
        raise exception 'Vault patch is invalid' using errcode = '23514';
    end if;
    select * into v_current from public.client_vault_entries
    where id = p_entry and client_id = p_client and status = 'active'
    for update;
    if not found then
        if exists (select 1 from public.client_vault_entries where id = p_entry and client_id = p_client) then
            raise exception 'Vault entry changed concurrently' using errcode = '40001';
        end if;
        raise exception 'Vault entry not found' using errcode = 'P0002';
    end if;
    v_pinned := v_current.pinned;
    v_review := v_current.review_on;
    if p_patch ? 'pinned' then
        begin
            v_pinned := (p_patch->>'pinned')::boolean;
        exception when others then
            raise exception 'Pinned must be true or false' using errcode = '23514';
        end;
    end if;
    if p_patch ? 'reviewOn' then
        v_set_review := true;
        if p_patch->'reviewOn' = 'null'::jsonb or nullif(p_patch->>'reviewOn', '') is null then
            v_review := null;
        else
            begin
                v_review := (p_patch->>'reviewOn')::date;
            exception when others then
                raise exception 'Review date is invalid' using errcode = '23514';
            end;
            if v_review < v_current.effective_on then
                raise exception 'Review date must be on or after the effective date' using errcode = '23514';
            end if;
        end if;
    end if;
    if not (p_patch ? 'pinned') and not v_set_review then
        raise exception 'Nothing to update' using errcode = '23514';
    end if;
    update public.client_vault_entries
    set pinned = v_pinned, review_on = v_review, updated_at = now()
    where id = v_current.id;
    perform public.vault_log((v_actor->>'organizationId')::uuid, p_client, 'vault.entry_pin_review', jsonb_build_object(
        'entryId', v_current.id, 'lineageId', v_current.lineage_id, 'title', v_current.title,
        'pinned', v_pinned, 'reviewOn', v_review, 'authorId', auth.uid()
    ));
    return v_current.id;
end;
$$;

create function public.vault_notify(p_org uuid, p_client uuid, p_user uuid, p_type text, p_title text, p_body text, p_entity uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
    if p_user is null or p_user = auth.uid() then
        return;
    end if;
    insert into public.notifications (organization_id, user_id, type, title, body, entity_type, entity_id, client_id)
    values (p_org, p_user, p_type, p_title, p_body, 'client_vault_suggestion', p_entity::text, p_client);
end;
$$;

create function public.accept_client_vault_suggestion(p_client uuid, p_suggestion uuid)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'admin');
    v_row public.client_vault_suggestions%rowtype;
    v_input jsonb;
    v_id uuid;
begin
    select * into v_row from public.client_vault_suggestions
    where id = p_suggestion and client_id = p_client
    for update;
    if not found then
        raise exception 'Vault suggestion not found' using errcode = 'P0002';
    end if;
    if v_row.status <> 'pending' then
        raise exception 'Vault suggestion changed concurrently' using errcode = '40001';
    end if;
    v_input := v_row.payload;
    if nullif(v_input->>'quote', '') is not null then
        v_input := jsonb_set(v_input, '{source_kind}', '"member_proposal"'::jsonb);
    end if;
    v_id := public.vault_insert_entry(
        v_row.organization_id, p_client, null, 1, null, auth.uid(), v_row.proposed_by, v_row.id, v_input
    );
    update public.client_vault_suggestions
    set status = 'accepted', resolved_by = auth.uid(), resolved_entry_id = v_id, resolved_at = now()
    where id = v_row.id;
    perform public.vault_log((v_actor->>'organizationId')::uuid, p_client, 'vault.suggestion_accepted', jsonb_build_object(
        'suggestionId', v_row.id, 'entryId', v_id, 'lineageId', v_id, 'versionNo', 1,
        'entryType', v_input->>'entry_type', 'title', v_input->>'title',
        'authorId', auth.uid(), 'proposedBy', v_row.proposed_by
    ));
    perform public.vault_notify(
        v_row.organization_id, p_client, v_row.proposed_by, 'vault_proposal_accepted',
        'Vault proposal accepted', v_input->>'title', v_row.id
    );
    return v_id;
end;
$$;

create function public.dismiss_client_vault_suggestion(p_client uuid, p_suggestion uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'admin');
    v_row public.client_vault_suggestions%rowtype;
    v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
    if v_reason is not null and char_length(v_reason) > 500 then
        raise exception 'Dismiss reason is too long' using errcode = '23514';
    end if;
    select * into v_row from public.client_vault_suggestions
    where id = p_suggestion and client_id = p_client
    for update;
    if not found then
        raise exception 'Vault suggestion not found' using errcode = 'P0002';
    end if;
    if v_row.status <> 'pending' then
        raise exception 'Vault suggestion changed concurrently' using errcode = '40001';
    end if;
    update public.client_vault_suggestions
    set status = 'dismissed', dismiss_reason = v_reason, resolved_by = auth.uid(), resolved_at = now()
    where id = v_row.id;
    perform public.vault_log((v_actor->>'organizationId')::uuid, p_client, 'vault.suggestion_dismissed', jsonb_build_object(
        'suggestionId', v_row.id, 'title', v_row.payload->>'title',
        'authorId', auth.uid(), 'proposedBy', v_row.proposed_by, 'reason', v_reason
    ));
    perform public.vault_notify(
        v_row.organization_id, p_client, v_row.proposed_by, 'vault_proposal_dismissed',
        'Vault proposal dismissed', coalesce(v_reason, v_row.payload->>'title'), v_row.id
    );
    return v_row.id;
end;
$$;

create function public.withdraw_client_vault_suggestion(p_client uuid, p_suggestion uuid)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'propose');
    v_row public.client_vault_suggestions%rowtype;
begin
    select * into v_row from public.client_vault_suggestions
    where id = p_suggestion and client_id = p_client
    for update;
    if not found then
        raise exception 'Vault suggestion not found' using errcode = 'P0002';
    end if;
    if v_row.proposed_by <> auth.uid() then
        raise exception 'Only the proposer can withdraw this suggestion' using errcode = '42501';
    end if;
    if v_row.status <> 'pending' then
        raise exception 'Vault suggestion changed concurrently' using errcode = '40001';
    end if;
    update public.client_vault_suggestions
    set status = 'withdrawn', resolved_by = auth.uid(), resolved_at = now()
    where id = v_row.id;
    perform public.vault_log((v_actor->>'organizationId')::uuid, p_client, 'vault.suggestion_withdrawn', jsonb_build_object(
        'suggestionId', v_row.id, 'title', v_row.payload->>'title', 'proposedBy', auth.uid()
    ));
    return v_row.id;
end;
$$;

create function public.list_client_vault_entries(
    p_client uuid,
    p_query text default null,
    p_type text default null,
    p_status text default 'active',
    p_pinned boolean default null,
    p_rule_kind text default null,
    p_purpose text default null,
    p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'read');
    v_org uuid := (v_actor->>'organizationId')::uuid;
    v_query text := nullif(btrim(coalesce(p_query, '')), '');
    v_tsq tsquery;
    v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
    v_rows jsonb;
begin
    if p_type is not null and p_type not in ('decision', 'rule', 'approval', 'contact', 'precedent') then
        raise exception 'Vault entry type is invalid' using errcode = '23514';
    end if;
    if p_status is not null and p_status not in ('active', 'superseded', 'archived', 'all') then
        raise exception 'Vault status is invalid' using errcode = '23514';
    end if;
    if p_rule_kind is not null and p_rule_kind not in ('content', 'linking', 'technical', 'brand', 'reporting', 'access', 'other') then
        raise exception 'Rule kind is invalid' using errcode = '23514';
    end if;
    if p_purpose is not null and p_purpose !~ '^[a-z0-9_]{1,40}$' then
        raise exception 'Applies-to values must be short slugs' using errcode = '23514';
    end if;
    if v_query is not null then
        v_tsq := websearch_to_tsquery('english', v_query);
    end if;
    select coalesce(jsonb_agg(public.vault_entry_json(ranked.id) order by ranked.sort_pinned desc, ranked.sort_rank desc, ranked.effective_on desc, ranked.version_no desc), '[]'::jsonb)
    into v_rows
    from (
        select entry.id, entry.pinned as sort_pinned, entry.effective_on, entry.version_no,
            case when v_tsq is null then 0 else ts_rank(entry.search_vector, v_tsq) end as sort_rank
        from public.client_vault_entries entry
        where entry.client_id = p_client
          and entry.organization_id = v_org
          and (p_status is null or p_status = 'all' or entry.status = p_status)
          and (p_type is null or entry.entry_type = p_type)
          and (p_pinned is null or entry.pinned = p_pinned)
          and (p_rule_kind is null or entry.rule_kind = p_rule_kind)
          and (p_purpose is null or p_purpose = any(entry.applies_to))
          and (v_tsq is null or entry.search_vector @@ v_tsq)
        order by entry.pinned desc,
            case when v_tsq is null then 0 else ts_rank(entry.search_vector, v_tsq) end desc,
            entry.effective_on desc, entry.version_no desc
        limit v_limit
    ) ranked;
    return v_rows;
end;
$$;

create function public.get_client_vault_entry(p_client uuid, p_entry uuid)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'read');
    v_org uuid := (v_actor->>'organizationId')::uuid;
    v_entry public.client_vault_entries%rowtype;
    v_history jsonb;
    v_sources jsonb;
    v_evidence jsonb;
begin
    select * into v_entry from public.client_vault_entries
    where id = p_entry and client_id = p_client and organization_id = v_org;
    if not found then
        raise exception 'Vault entry not found' using errcode = 'P0002';
    end if;
    select coalesce(jsonb_agg(public.vault_entry_json(history.id) order by history.version_no desc), '[]'::jsonb)
    into v_history
    from public.client_vault_entries history
    where history.lineage_id = v_entry.lineage_id and history.client_id = p_client;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', source.id, 'quote', source.quote, 'source_kind', source.source_kind,
        'source_ref', source.source_ref, 'created_at', source.created_at
    ) order by source.created_at), '[]'::jsonb)
    into v_sources
    from public.client_vault_sources source
    where source.entry_id = v_entry.id;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', evidence.id, 'kind', evidence.kind, 'label', evidence.label,
        'payload', evidence.payload, 'captured_on', evidence.captured_on, 'created_at', evidence.created_at
    )), '[]'::jsonb)
    into v_evidence
    from public.client_vault_evidence evidence
    where evidence.entry_id = v_entry.id;
    return jsonb_build_object(
        'entry', public.vault_entry_json(v_entry.id),
        'sources', v_sources,
        'history', v_history,
        'evidence', v_evidence
    );
end;
$$;

create function public.client_vault_counts(p_client uuid)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
    v_actor jsonb := public.vault_actor(p_client, 'read');
    v_org uuid := (v_actor->>'organizationId')::uuid;
    v_role text := v_actor->>'role';
    v_active integer;
    v_inbox integer;
begin
    select count(*)::integer into v_active from public.client_vault_entries
    where client_id = p_client and organization_id = v_org and status = 'active';
    if v_role in ('owner', 'admin') then
        select count(*)::integer into v_inbox from public.client_vault_suggestions
        where client_id = p_client and organization_id = v_org and status = 'pending';
    elsif v_role = 'member' then
        select count(*)::integer into v_inbox from public.client_vault_suggestions
        where client_id = p_client and organization_id = v_org and status = 'pending' and proposed_by = auth.uid();
    else
        v_inbox := null;
    end if;
    return jsonb_build_object('active', v_active, 'inbox', v_inbox);
end;
$$;

create function public.list_client_vault_suggestions(p_client uuid, p_scope text)
returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
    v_mode text := case when p_scope = 'inbox' then 'admin' else 'propose' end;
    v_actor jsonb := public.vault_actor(p_client, v_mode);
    v_org uuid := (v_actor->>'organizationId')::uuid;
    v_rows jsonb;
begin
    if p_scope not in ('inbox', 'mine') then
        raise exception 'Vault suggestion scope is invalid' using errcode = '23514';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', suggestion.id,
        'organization_id', suggestion.organization_id,
        'client_id', suggestion.client_id,
        'status', suggestion.status,
        'payload', suggestion.payload,
        'dismiss_reason', suggestion.dismiss_reason,
        'proposed_by', suggestion.proposed_by,
        'proposed_by_name', proposer.full_name,
        'resolved_by', suggestion.resolved_by,
        'resolved_by_name', resolver.full_name,
        'resolved_entry_id', suggestion.resolved_entry_id,
        'created_at', suggestion.created_at,
        'resolved_at', suggestion.resolved_at
    ) order by suggestion.created_at desc), '[]'::jsonb)
    into v_rows
    from public.client_vault_suggestions suggestion
    left join public.users proposer on proposer.id = suggestion.proposed_by
    left join public.users resolver on resolver.id = suggestion.resolved_by
    where suggestion.client_id = p_client
      and suggestion.organization_id = v_org
      and (
          (p_scope = 'inbox' and suggestion.status = 'pending')
          or (p_scope = 'mine' and suggestion.proposed_by = auth.uid())
      );
    return v_rows;
end;
$$;

revoke all on function
    public.guard_client_vault_entry(),
    public.guard_client_vault_source(),
    public.guard_client_vault_suggestion(),
    public.guard_client_vault_evidence(),
    public.vault_log(uuid, uuid, text, jsonb),
    public.vault_actor(uuid, text),
    public.vault_prepare_entry(jsonb),
    public.vault_insert_entry(uuid, uuid, uuid, integer, uuid, uuid, uuid, uuid, jsonb),
    public.vault_entry_json(uuid),
    public.vault_notify(uuid, uuid, uuid, text, text, text, uuid)
from public, anon, authenticated;

revoke all on function
    public.create_client_vault_entry(uuid, jsonb),
    public.propose_client_vault_entry(uuid, jsonb),
    public.supersede_client_vault_entry(uuid, uuid, jsonb),
    public.archive_client_vault_entry(uuid, uuid),
    public.set_client_vault_pin_review(uuid, uuid, jsonb),
    public.accept_client_vault_suggestion(uuid, uuid),
    public.dismiss_client_vault_suggestion(uuid, uuid, text),
    public.withdraw_client_vault_suggestion(uuid, uuid),
    public.list_client_vault_entries(uuid, text, text, text, boolean, text, text, integer),
    public.get_client_vault_entry(uuid, uuid),
    public.client_vault_counts(uuid),
    public.list_client_vault_suggestions(uuid, text)
from public, anon;

grant execute on function
    public.create_client_vault_entry(uuid, jsonb),
    public.propose_client_vault_entry(uuid, jsonb),
    public.supersede_client_vault_entry(uuid, uuid, jsonb),
    public.archive_client_vault_entry(uuid, uuid),
    public.set_client_vault_pin_review(uuid, uuid, jsonb),
    public.accept_client_vault_suggestion(uuid, uuid),
    public.dismiss_client_vault_suggestion(uuid, uuid, text),
    public.withdraw_client_vault_suggestion(uuid, uuid),
    public.list_client_vault_entries(uuid, text, text, text, boolean, text, text, integer),
    public.get_client_vault_entry(uuid, uuid),
    public.client_vault_counts(uuid),
    public.list_client_vault_suggestions(uuid, text)
to authenticated;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
    'task_assigned', 'task_mentioned', 'note_mentioned',
    'deliverable_assigned', 'deliverable_overdue', 'deliverable_at_risk', 'deliverable_status',
    'reminder_due', 'approval_opened', 'approval_comment', 'approval_decision',
    'approval_batch_done', 'approval_doc_drifted', 'portal_feedback',
    'vault_proposal_accepted', 'vault_proposal_dismissed'
));
alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications add constraint notifications_entity_type_check check (entity_type in (
    'task', 'task_comment', 'client_note', 'deliverable', 'reminder',
    'content_approval_batch', 'content_approval_doc', 'client_portal_feedback',
    'client_vault_suggestion'
));

commit;
