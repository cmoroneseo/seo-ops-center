# Planner Hardening and Actionability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the planner trustworthy, semantically clear, actionable without page-hopping, and usable on narrow screens before adding capacity or calendar integrations.

**Architecture:** Keep Task as the canonical execution record and preserve the existing normalized `PlannerItem` rendering boundary. Add pure date/semantic helpers with Node tests, keep persistence errors inside the owning UI, and make responsive behavior an adaptation of the current design system rather than a second planner.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Tailwind CSS v4, Supabase, node:test.

**Spec:** `artifacts/planner-audit/PLANNER_REVIEW.md` and `docs/superpowers/specs/2026-07-27-weekly-planner-design.md`

## Global Constraints

- Follow `CLAUDE.md`; never commit directly to `main` and never add co-author trailers.
- Use test-first development: add the failing behavior test, run it and record RED, then implement and record GREEN.
- Do not duplicate scheduled tasks into `planner_events`; Task remains canonical.
- Preserve existing user data and migrations; any new database constraint must be additive and mirrored in `schema.sql`.
- Do not add new dependencies.
- Do not commit files under `artifacts/`.
- Keep changes scoped to the planner and directly shared task/Basecamp boundaries named below.

---

### Task 1: Local calendar-day correctness

**Files:**
- Create: `lib/planner/local-date.ts`
- Create: `lib/planner/local-date.test.ts`
- Modify: `app/(dashboard)/planner/page.tsx`
- Modify: `components/planner/QuickCreatePopover.tsx`
- Modify: `components/planner/EventDetailPanel.tsx`

**Interfaces:**
- Produces `parseLocalDate(value: string): Date | null` for `yyyy-MM-dd` values.
- Produces `formatLocalDate(value: Date | string): string` returning local `yyyy-MM-dd`.
- Produces `localDateForInstant(value: Date | string): string` as an explicit alias for work-log/scheduled-day writes.

- [ ] **Step 1: Write failing tests** covering `2026-08-18` local parsing and local formatting for instants whose UTC date differs from the local date. Use hand-derived values and run the test with `TZ=America/Los_Angeles` and `TZ=Pacific/Auckland`.
- [ ] **Step 2: Run RED** with `TZ=America/Los_Angeles node --test lib/planner/local-date.test.ts`; expected failure is the missing module/functions.
- [ ] **Step 3: Implement the pure helpers** without using `toISOString().slice(0, 10)` for local dates.
- [ ] **Step 4: Replace planner date-only reads/writes**: overdue checks parse `dueDate` locally; quick-created task `dueDate` uses the scheduled local day; event time logs use the event's local calendar day.
- [ ] **Step 5: Run GREEN** under both time zones, then run `node --test lib/planner/*.test.ts` and `npm run typecheck`.
- [ ] **Step 6: Commit** with subject `fix: preserve planner local calendar dates`.

### Task 2: Reliable creation, month range, and priority persistence

**Files:**
- Create: `lib/planner/month-range.ts`
- Create: `lib/planner/month-range.test.ts`
- Modify: `components/planner/QuickCreatePopover.tsx`
- Modify: `components/planner/MonthGrid.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`
- Modify: `lib/supabase/planner-priorities.ts`

**Interfaces:**
- Produces `buildMonthDays(anchorDate: Date, weekStartsOn: 0 | 1): Date[]`.
- `MonthGrid` consumes `days: Date[]` instead of rebuilding its own range.
- Quick-create retains its draft and exposes an inline `role="alert"` when task/event creation returns failure.
- `reorderPlannerPriorities` returns `false` when any update response contains an error.

- [ ] **Step 1: Write failing pure tests** proving Sunday and Monday month ranges include exactly the displayed boundary days.
- [ ] **Step 2: Run RED** with `node --test lib/planner/month-range.test.ts`.
- [ ] **Step 3: Implement `buildMonthDays`** and make the page use the identical days for query range and MonthGrid rendering.
- [ ] **Step 4: Add component-extractable save-result logic** or a pure helper test proving failed task/event creation does not call completion/close and preserves the draft; then wire an inline retryable error in QuickCreatePopover.
- [ ] **Step 5: Make priority reorder inspect each Supabase response** and return false on partial failure; page handlers must restore/refetch and show the existing planner error toast when delete/reorder fails.
- [ ] **Step 6: Run focused GREEN tests**, planner tests, and typecheck.
- [ ] **Step 7: Commit** with subject `fix: make planner persistence failures recoverable`.

### Task 3: Basecamp project authorization boundary

**Files:**
- Modify: `app/api/integrations/basecamp/projects/route.ts`
- Modify or create focused route/auth helper tests adjacent to the route or under `lib/basecamp/`
- Modify: `schema.sql` only if an existing organization-scoped configuration field must be surfaced; do not invent a new storage model without controller approval.

**Interfaces:**
- The GET route requires an authenticated user and active organization membership.
- The route accepts an `organizationId` query parameter and rejects missing/unauthorized organizations with 400/403.
- Returned projects are restricted using the organization's existing Basecamp integration/configuration model. If that model cannot represent allowed internal projects, stop with `NEEDS_CONTEXT` rather than returning the shared-token account catalog.

- [ ] **Step 1: Write a failing authorization-boundary test** for unauthenticated, missing organization, unauthorized organization, and authorized organization requests.
- [ ] **Step 2: Run RED** and confirm the existing route exposes the wrong branch.
- [ ] **Step 3: Implement authorization and organization scoping** using existing server-side auth/membership helpers and Basecamp configuration sources.
- [ ] **Step 4: Update `BasecampProjectPicker` callers** only if the route's required query parameter changes their request contract.
- [ ] **Step 5: Run GREEN**, targeted security/static checks, typecheck, and relevant tests.
- [ ] **Step 6: Commit** with subject `fix: scope planner Basecamp projects by organization`.

### Task 4: Source semantics and task actionability

**Files:**
- Modify: `lib/planner/items.ts`
- Modify: `lib/planner/items.test.ts`
- Modify: `components/planner/PlannerCommandBar.tsx`
- Modify: `components/planner/EventDetailPanel.tsx`
- Modify: `components/planner/PlannerSidebar.tsx`
- Modify: `components/planner/TaskDrawer.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`
- Modify: `app/(dashboard)/tasks/page.tsx`

**Interfaces:**
- Add pure helpers `plannerSourceLabel(item: PlannerItem): string` and `plannerTimeLabel(item: PlannerItem): string`.
- Command results group Tasks, Events, Reminders, Teammates, and Commands; all-day work displays `All day`, never midnight.
- Task details show source label, status, priority, assignee, due date, and a real `Open task` link using `/tasks?task=<id>`.
- Tasks page consumes the `task` query parameter and opens/selects the canonical task using its existing detail UI.
- Every task drawer accepts `onTaskClick` and `onTaskSchedule`/existing drag affordance; no duplicate record is created.

- [ ] **Step 1: Add failing item-helper tests** proving overdue tasks label as `Overdue task`, reminders as `Reminder`, and all-day values as `All day`.
- [ ] **Step 2: Run RED**, implement minimal helpers, and run GREEN.
- [ ] **Step 3: Refactor command grouping and detail labels** to consume the helpers.
- [ ] **Step 4: Add task metadata and deep link**; wire Tasks page query selection with a failing regression test around the query-to-selection helper if the page cannot be component-tested directly.
- [ ] **Step 5: Make all three drawers open tasks** and preserve Backlog drag scheduling.
- [ ] **Step 6: Run planner tests and typecheck; manually inspect week, command, and detail states.**
- [ ] **Step 7: Commit** with subject `feat: make planner task work actionable`.

### Task 5: Responsive and accessible planner controls

**Files:**
- Modify: `components/planner/PlannerHeader.tsx`
- Modify: `components/planner/PlannerSettings.tsx`
- Modify: `components/planner/MonthGrid.tsx`
- Modify: `components/planner/TaskDrawer.tsx`
- Modify: `components/planner/PrioritiesList.tsx`
- Modify: `components/planner/EventDetailPanel.tsx`
- Modify: `components/planner/QuickCreatePopover.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`

**Interfaces:**
- Header reflows into navigation/date and view/settings rows below `sm`; no horizontal clipping at 320px.
- Narrow Month becomes a selected-day agenda: month cells show counts/dots, tapping a day exposes readable items below the grid.
- Details and quick-create render as fixed inset/bottom-sheet overlays below `lg`, with viewport-clamped positioning.
- View buttons expose `aria-pressed`; settings switches have accessible names, 44px hit areas, and visible focus.
- Month day cells are actual buttons or contain a focusable day button; task cards are keyboard-openable; priorities expose visible focused remove controls and non-pointer reorder controls.

- [ ] **Step 1: Add pure responsive/selection helpers only where behavior requires them**, with failing tests before implementation. Do not create source-text tests for Tailwind classes.
- [ ] **Step 2: Implement semantic controls and keyboard behavior** using native buttons/ARIA and existing focus-visible styles.
- [ ] **Step 3: Implement the responsive header, agenda drill-down, and overlay layouts** using existing colors, spacing, typography, and icons.
- [ ] **Step 4: Run planner tests, typecheck, and lint the changed files.**
- [ ] **Step 5: Verify visually at 320x720, 375x812, 390x844, and desktop; capture week, month/agenda, details, settings, and quick-create screenshots.**
- [ ] **Step 6: Commit** with subject `feat: make planner responsive and keyboard accessible`.

### Task 6: Final integration and scope gate

**Files:**
- Modify only files required by review findings.
- Create: `artifacts/planner-hardening-verification/` screenshots locally; keep uncommitted.

**Interfaces:**
- No new user-facing feature is added here; this task integrates reviewed work.

- [ ] **Step 1: Run `node --test lib/planner/*.test.ts`, `npm run typecheck`, and scoped ESLint.**
- [ ] **Step 2: Run the static security review and verify Basecamp cross-organization behavior.**
- [ ] **Step 3: Perform authenticated desktop/mobile browser verification and capture the required states.**
- [ ] **Step 4: Review the final diff against every Priority 1–3 acceptance criterion in `PLANNER_REVIEW.md`; record deferred capacity/canonical-work/calendar items explicitly.**
- [ ] **Step 5: Commit only review fixes** with subject `fix: address planner integration review` if changes are required.
