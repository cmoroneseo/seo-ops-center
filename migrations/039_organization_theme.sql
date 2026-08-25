-- 039: Organization brand theme
--
-- Stores the brand colour choice per organization. One row of jsonb, shaped
-- either { "preset": "<preset-id>" } or { "preset": "custom", "hex": "#rrggbb" }.
-- The full token set is derived in TypeScript (lib/theme/palette.ts) so contrast
-- clamping stays testable and there is exactly one source of truth for the
-- light/dark ramps.
--
-- Null means "never chosen" and renders the shipped default, so this migration
-- is a visual no-op for every existing organization.

alter table public.organizations
  add column if not exists theme jsonb;

comment on column public.organizations.theme is
  'Brand theme selection: {"preset":"<id>"} or {"preset":"custom","hex":"#rrggbb"}. Null = shipped default. Tokens derived in lib/theme/palette.ts.';

-- Writes are already gated by the existing "Owners can update their own
-- organizations" policy, and protect_organization_internal_status() still
-- guards is_internal on the same table. No new policy is required.
