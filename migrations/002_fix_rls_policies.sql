-- =============================================================================
-- Migration 002: Fix RLS bugs that block signup / setup-organization
-- =============================================================================
-- Generated: 2026-06-01
-- Found via : end-to-end signup smoke test against the live DB.
--
-- The handle_new_user trigger works (auth signup -> public.users row). But the
-- setup-organization flow (app/(auth)/setup-organization/page.tsx) failed on
-- two pre-existing RLS bugs that ship in schema.sql:
--
--   BUG 1 (42501): organizations.insert(...).select() — the insert succeeds but
--     the read-back is denied. The only SELECT policy is "view orgs you are a
--     member of", and the creator is not a member yet (membership is created in
--     the NEXT step). So the combined insert+return errors and setup aborts.
--
--   BUG 2 (42P17): the "Owners and Admins can manage organization members"
--     policy queries organization_members from WITHIN a policy ON
--     organization_members -> infinite recursion. Any read/write on that table
--     fails (including the membership insert during setup, and any inline
--     subquery that touches the table).
--
-- This migration is idempotent and safe to re-run.
-- Run it in the Supabase SQL Editor (project sgszojorcftyaknruckh) in one go.
-- =============================================================================


-- =============================================================================
-- BUG 2 FIX — break the recursion on organization_members
-- -----------------------------------------------------------------------------
-- A SECURITY DEFINER function runs as its owner and bypasses RLS internally,
-- so reading organization_members inside it does NOT re-trigger the table's
-- policies (no recursion). Mirrors the existing get_user_org_ids() helper.
-- =============================================================================
create or replace function public.get_user_admin_org_ids()
returns setof uuid as $$
  select organization_id
  from public.organization_members
  where user_id = auth.uid()
    and role in ('owner', 'admin')
$$ language sql security definer;

drop policy if exists "Owners and Admins can manage organization members"
  on public.organization_members;

create policy "Owners and Admins can manage organization members"
  on public.organization_members for all
  using      ( organization_id in (select public.get_user_admin_org_ids()) )
  with check ( organization_id in (select public.get_user_admin_org_ids()) );

-- Note: the first-ever membership insert during setup is permitted by the
-- separate "Authenticated users can join organizations during setup" policy
-- (with check auth.uid() = user_id), so a brand-new owner can still bootstrap.


-- =============================================================================
-- BUG 1 FIX — let an org's creator read it back immediately on creation
-- -----------------------------------------------------------------------------
-- Track who created the org (defaults to the current auth user at insert time),
-- and add a SELECT policy so the creator can view it even before the membership
-- row exists. This makes organizations.insert().select() work.
-- =============================================================================
alter table public.organizations
  add column if not exists created_by uuid default auth.uid() references public.users(id);

drop policy if exists "Creators can view their organizations" on public.organizations;

create policy "Creators can view their organizations"
  on public.organizations for select
  using ( created_by = auth.uid() );

-- =============================================================================
-- End of migration 002
-- Resulting setup-organization flow (all as the authenticated user):
--   1. insert organizations            -> "Authenticated users can create..." (with check true)
--   2. .select() read-back             -> "Creators can view their organizations" (created_by = auth.uid())  [NEW]
--   3. insert organization_members     -> "Authenticated users can join during setup" (no recursion now)     [FIXED]
--   4. seedOrganization() inserts       -> Section C "Org members can manage ..." (user is now a member)
-- =============================================================================
