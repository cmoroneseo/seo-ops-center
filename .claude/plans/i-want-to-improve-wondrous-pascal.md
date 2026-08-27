# Workspace Improvements: Bug Fixes + Overview Widget

## Context

The workspace module is the main client management hub but has 5 bugs degrading usability and lacks a quick-glance overview on client detail pages. Screenshots show: "My Clients" filter returns 0/64 clients, duplicate names in manager dropdown, Onboarding clients appearing under Archived, and a broken reassignment column name. This plan fixes all bugs first, then adds a Client Overview Widget to the workspace detail page.

---

## PR 1: Bug Fixes (Steps 1-4)

### Step 1: Fix reassignment column name (CRITICAL — silently breaks every reassignment)

**File:** `lib/supabase/client-assignments.ts`
- Line 89: change `{ account_manager: newAssigneeName }` to `{ account_manager_name: newAssigneeName, ...(newAssigneeId ? { account_manager_id: newAssigneeId } : {}) }`
- Update `reassignClient()` signature to accept optional `newAssigneeId: string`

**File:** `components/workspace/ReassignModal.tsx`
- Capture `userId` from org members alongside `name`/`email`
- Pass `newAssigneeId` to `reassignClient()` on submit

**File:** `app/(dashboard)/workspace/[id]/page.tsx`
- Update ReassignModal `onSuccess` callback to set both name and ID on client state

### Step 2: Fix "My Clients" filter (returns 0 results)

**File:** `app/(dashboard)/workspace/page.tsx`
- Line 19: destructure `userId` from `useCurrentMember()` (already exposes it)
- Lines 62-63: replace exact name match with ID-first logic:
  ```
  (client.accountManagerId && client.accountManagerId === userId) ||
  (!client.accountManagerId && client.accountManager.toLowerCase().includes(displayName.toLowerCase()))
  ```
- Add `userId` to useMemo deps at line 66

### Step 3: Fix duplicate managers in dropdown

**File:** `app/(dashboard)/workspace/page.tsx`
- Lines 49-52: group by `accountManagerId` instead of raw name strings
- Keep longest/most-complete name per ID; fuzzy-dedup orphan names
- Use manager ID as `<option value>` so filter matching is unambiguous

### Step 4: Fix Onboarding in Archived tab

**File:** `components/workspace/ClientListPanel.tsx`
- Line 21: change `['Active']` to `['Active', 'Onboarding']`
- Line 22: change `['Cancelled', 'Onboarding']` to `['Cancelled', 'Paused']`

---

## PR 2: Status Mapping Migration (Step 5)

### Step 5: Fix Paused/Onboarding → 'pending' ambiguity

**New file:** `migrations/020_fix_status_mapping.sql`
- Add `'paused'` and `'onboarding'` to the CHECK constraint
- Migrate existing `'pending'` rows to `'onboarding'`
- Keep `'pending'` in CHECK for backward compat

**File:** `lib/supabase/clients.ts` (lines 7-17)
- Add `paused: 'Paused'` and `onboarding: 'Onboarding'` to `DB_TO_APP_STATUS`
- Map `Paused → 'paused'` and `Onboarding → 'onboarding'` in `APP_TO_DB_STATUS`
- Keep `pending → 'Onboarding'` as legacy fallback

**File:** `schema.sql` — mirror the new CHECK constraint

**One-time SQL (Supabase Dashboard):** Normalize `account_manager_name` from `users.full_name` where `account_manager_id` is set — fixes data root cause of duplicate names.

**Deploy order:** Run migration first, then deploy code.

---

## PR 3: Client Overview Widget (Steps 6-9)

### Step 6: Data aggregation helper

**New file:** `lib/supabase/client-overview.ts`
- `getClientOverview(clientId, orgId, month?)` — calls in parallel:
  - `getLoggedHoursByClient()` for hours
  - `getFulfillmentMatrix()` for deliverable cells
  - `getTasks()` filtered by client
  - `getCampaignPlan()` for plan status
- Computes using existing logic functions:
  - `hoursUsageStatus()` for hours health
  - `fulfillmentStatus()` per cell for at-risk/overdue counts
  - Health score (0-100): starts at 100, deducts for overdue deliverables (-20 each, max -40), critical hours (-15), blocked tasks (-5 each, max -15), missing campaign plan (-10)
  - Next best actions: array of prioritized suggestions based on conditions

**Extract pure computation into testable functions:**
- `computeHealthScore(input)` — pure function
- `computeNextBestActions(input)` — pure function

### Step 7: ClientOverviewWidget component

**New file:** `components/workspace/ClientOverviewWidget.tsx`
- Feature flag: returns `null` if `NEXT_PUBLIC_WORKSPACE_OVERVIEW !== 'true'`
- 6-card grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`)
- Cards: Health Score, Hours This Month, Open Tasks, Deliverables, Campaign Plan, Next Best Action
- Reuses existing patterns: card borders from EngagementOverview, severity badges from deliverable-ui, `cn()` utility

### Step 8: Integrate into Overview tab

**File:** `app/(dashboard)/workspace/[id]/page.tsx`
- Add `<ClientOverviewWidget>` as first child inside the Overview tab block (before EngagementOverview grid)

### Step 9: Tests

**New file:** `lib/supabase/client-overview.test.ts`
- Test `computeHealthScore()`: all-green = 100, overdue deliverables degrade, critical hours degrade, clamped 0-100
- Test `computeNextBestActions()`: correct suggestions for overdue, low hours, blocked tasks, missing plan

---

## Verification

1. **Bug 1:** Log in as Carlos → "My Clients" toggle should show clients assigned to Carlos Morones
2. **Bug 2:** Manager dropdown should show each person once (no "Abel" + "Abel Miranda" duplicates)
3. **Bug 3:** Onboarding clients appear under Active tab, not Archived
4. **Bug 4:** Reassign a client → verify `account_manager_name` and `account_manager_id` update in Supabase
5. **Bug 5:** Set a client to Paused → refresh → confirm it stays Paused (not converted to Onboarding)
6. **Widget:** Set `NEXT_PUBLIC_WORKSPACE_OVERVIEW=true` → open any client detail → overview cards render with correct data
7. **Widget off:** Remove/unset the env var → widget doesn't render
8. **Tests:** `npx vitest` passes
9. **Type check:** `npx tsc --noEmit` passes

## Rollback

- **Bug fixes PR:** Revert the PR; no schema changes in PR 1
- **Migration PR:** Revert code first (status mapping falls back to legacy `pending`), then revert migration if needed
- **Widget PR:** Set `NEXT_PUBLIC_WORKSPACE_OVERVIEW` to anything other than `'true'` or remove it; widget disappears with zero side effects. Can also revert the PR cleanly since it only adds new files + one import line
