-- Migration 139: Optional control pages for SEO changes.
-- NOT APPLIED. The owner reviews and applies this migration separately.
-- Not applied in this change.

alter table public.seo_changes
  add column if not exists control_urls text[] not null default '{}';

comment on column public.seo_changes.control_urls is
  'Same-site comparison page URLs. An empty array uses the rest of the site.';
