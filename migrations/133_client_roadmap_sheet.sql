-- Migration 133: Client SEO sheet links.
--
-- NOT APPLIED. Do not run this against the production Supabase project.
-- The owner reviews and applies it separately. Tests run it on PGlite only.

alter table public.clients
  add column if not exists roadmap_sheet_url text,
  add column if not exists roadmap_sheet_id text;

alter table public.clients
  drop constraint if exists clients_roadmap_sheet_pair_check,
  drop constraint if exists clients_roadmap_sheet_id_check,
  drop constraint if exists clients_roadmap_sheet_url_check,
  drop constraint if exists clients_roadmap_sheet_match_check;

alter table public.clients
  add constraint clients_roadmap_sheet_pair_check
    check ((roadmap_sheet_url is null) = (roadmap_sheet_id is null)),
  add constraint clients_roadmap_sheet_id_check
    check (roadmap_sheet_id ~ '^[A-Za-z0-9_-]{25,100}$'),
  add constraint clients_roadmap_sheet_url_check
    check (length(roadmap_sheet_url) <= 500 and roadmap_sheet_url ~ '^https://docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{25,100}(/.*)?$'),
  add constraint clients_roadmap_sheet_match_check
    check (substring(roadmap_sheet_url from '^https://docs\.google\.com/spreadsheets/d/([A-Za-z0-9_-]+)') = roadmap_sheet_id);
