-- Migration 136: Per-client sheet mirror switch.
--
-- Clients opt in individually after linking a roadmap sheet.

alter table public.clients
    add column if not exists sheet_mirror_enabled boolean not null default false;
