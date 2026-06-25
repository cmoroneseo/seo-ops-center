-- =============================================================================
-- 020: Fix client status mapping ambiguity
-- =============================================================================
-- Paused and Onboarding were both stored as 'pending', so a saved Paused client
-- could round-trip back into the app as Onboarding. Add distinct database
-- values while keeping 'pending' for backward compatibility with older writes.
-- =============================================================================

alter table public.clients drop constraint if exists clients_status_check;

alter table public.clients
  add constraint clients_status_check
  check (status in ('active', 'inactive', 'pending', 'paused', 'onboarding'));

update public.clients
set status = 'onboarding'
where status = 'pending';

-- Optional one-time data cleanup from the implementation plan:
-- update public.clients c
-- set account_manager_name = u.full_name
-- from public.users u
-- where c.account_manager_id = u.id
--   and u.full_name is not null
--   and c.account_manager_name is distinct from u.full_name;

-- =============================================================================
-- End of migration 020
-- =============================================================================
