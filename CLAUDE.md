# SEO Ops Center — Project Context

## Live app
https://seo-ops-center.vercel.app

## Stack
- Next.js 15 App Router, React 19, TypeScript (strict)
- Tailwind CSS v4, Radix UI (shadcn-style), lucide-react, recharts
- Supabase (Postgres + RLS + SSR auth), Vercel (auto-deploy on push to main)
- Resend (email), Vercel Cron (vercel.json schedules)

## Key conventions
- **DB → TS:** snake_case columns → camelCase via row mapper functions (`rowToX` / `xToRow`) in each `lib/supabase/*.ts` file
- **Enums:** stored as text CHECK constraints in Postgres, typed as string unions in TS
- **RLS:** all tables use `organization_id IN (SELECT get_user_org_ids())` via SECURITY DEFINER function
- **Compute on read:** rollups/aggregates computed in TS from indexed queries — never stored in DB (see `lib/seo-ops-logic.ts`)
- **No soft deletes** on most tables; `status_history jsonb[]` for audit trails
- **Migrations:** numbered `migrations/0XX_name.sql`, mirrored into `schema.sql`
- **No co-author lines in commits** — never add `Co-Authored-By:` or any Anthropic trailer to any commit message, ever

## Key files
- `lib/types.ts` — all shared TypeScript interfaces
- `lib/seo-ops-logic.ts` — pure business logic (onTrackStatus, proratedQuantity, fulfillmentStatus)
- `lib/seo-ops-logic.test.ts` — unit tests (run: `node --test lib/*.test.ts` — NOT vitest; files use node:test)
- `lib/supabase/client.ts` — Supabase client (SSR-safe)
- `lib/supabase/deliverables.ts` — deliverables CRUD + row mapper
- `lib/supabase/commitments.ts` — commitment CRUD + syncClientBlogCadence bridge
- `lib/supabase/fulfillment.ts` — getFulfillmentMatrix (compute-on-read)
- `lib/supabase/tasks.ts` — task CRUD, Basecamp push, deliverable nudges
- `lib/supabase/notifications.ts` — notification CRUD + types
- `components/dashboard/Sidebar.tsx` — nav (add new pages here)
- `schema.sql` — full DB schema (mirror every migration here)
- `vercel.json` — cron schedules

## Team
- **Carlos Morones** — owner, cmorones@marketingempiregroup.com
- **Abel Miranda** — member, amiranda@marketingempiregroup.com (task assignment triggers bell notification)

## What's shipped
- Client management (list, detail, search, status, tier, engagement model)
- Account manager reassignment + history
- Time tracking (timer persisted to Supabase, FloatingTimer, QuickStart Cmd+Shift+T)
- Analytics: GA4, GSC, GBP, Ahrefs — nightly cron + manual sync
- Report builder (section-based, MoM deltas, print→PDF)
- Task system V2 (priority, category, tags, assignees, Basecamp 1-way push, deliverable_id FK)
- Basecamp integration (per-client config, per-task todolist override)
- Notifications (bell, realtime, task assigned/mentioned)
- Feedback widget (Bug/Feature/General, screenshot upload)
- **Deliverables Management** (migration 015, Jun 2026):
  - `deliverable_commitments` table (contract layer) + `commitment_change_log` trigger
  - `/deliverables` page: KPI strip, FulfillmentMatrix, AtRiskRail, My Queue/My Clients/Agency lenses
  - `ClientDeliverablesTab` on workspace/[id] (replaced DeliverablesTracker)
  - Daily cron `/api/cron/generate-deliverables` (idempotent, prorated, campaign-capped)
  - `CommitmentsManager`, `CreateDeliverableModal`, `DeliverableDetailPanel` components
  - Deliverable title editable inline in detail panel (click to edit, Enter/Escape/blur to save)
  - 37 client commitments backfilled; 269 existing deliverables linked
  - `lib/types.ts` fully updated: `Deliverable`, `Task`, `TaskTemplate`, `TaskComment`, `TaskStatusHistoryEntry`, `TaskCategory`, `TaskPriority`, `TaskStatus`, `DeliverableCommitment`, `FulfillmentCell`, `CommitmentCadence`, `DeliverableSubtype` all match actual DB schema

- **Campaign Plan / SEO Strategy Builder** (migration 019, Jun 2026):
  - 6 DB tables: `campaign_plans`, `campaign_goals`, `campaign_kpis`, `campaign_workstreams`, `campaign_phases`, `campaign_expectations` + join table
  - `campaign_phase_id` FK on `tasks` for phase-to-task linkage
  - **3-tab layout** on workspace/[id] Campaign Plan tab: Goals & KPIs | SEO Campaign | Timeline
  - **Tab 1 — Goals & KPIs:** Goals, KPIs, Expectations (inline add/edit/delete)
  - **Tab 2 — SEO Campaign:** SEO Overview (ART framework + AI Draft button), Website Analysis (findings builder with per-finding screenshot upload), Keyword Opportunities (3 sources: Site Keywords via Ahrefs, Competitor pull, AI Suggest), Key Activities, Scope Meter (monthly hours × contract term capacity planning)
  - **Tab 3 — Timeline:** Preliminary Roadmap (3-stage client-facing), Execution Phases (internal, with "Generate Tasks" button per phase)
  - Create from: questionnaire PDF import (AI extraction, SEO-only filter) | template (3 templates) | blank
  - Status lifecycle: draft → internal_review → approved → active → archived
  - Progress bar tracking completion across 3 tabs
  - All new section data stored in `campaign_plans.custom_fields` jsonb — no extra tables needed
  - Screenshot uploads via Supabase Storage bucket `campaign-screenshots`
  - Templates in `lib/campaign-templates.ts` with default content for SEO Overview, Roadmap, Key Activities
  - CRUD layer: `lib/supabase/campaign-plans.ts`
  - Section components: `components/campaign/sections/*.tsx` (11 files)
  - API routes: `extract-intake` (questionnaire PDF → AI), `draft-overview` (AI SEO Overview), `keyword-research` (Ahrefs API), `suggest-keywords` (AI keyword ideas)
  - Scope estimates catalog: `lib/scope-estimates.ts` (28 SEO activities with time ranges)
  - Anthropic SDK: `@anthropic-ai/sdk` — requires `ANTHROPIC_API_KEY` env var on Vercel
  - PDF parsing: `pdf-parse@1.1.1` (import via `pdf-parse/lib/pdf-parse.js` to avoid test-file ENOENT in serverless)

- **SEO Marketing Plan** (migration 021, Jul 2026):
  - SE Ranking-style checklist replacing the Campaign Plan UI on workspace/[id]
  - `marketing_plans` (one per client, steps jsonb) + `marketing_plan_items` (status todo/done/ignored, priority, assignee, due date, comments jsonb, task_id FK)
  - 7-step template (~56 items) in `lib/marketing-plan-template.ts`
  - Summary strip, sticky step rail, By Step/Priority/Status grouping, keyword search, Add Item
  - Promote to Task (creates real Task, links via task_id; no completion sync back)
  - Export via window.print(); AI Suggest Items via `/api/marketing-plan/suggest-items`
  - Campaign Plan code (`components/campaign/*`, `campaign_*` tables) unmounted but preserved

- **Sticky Top Nav + User Menu** (Jul 2026, no DB changes):
  - `components/dashboard/TopNav.tsx` — desktop-only sticky bar in `app/(dashboard)/layout.tsx`; centered search trigger (owns the Cmd+K and Cmd+Shift+T global listeners), NotificationBell + UserMenu on the right
  - `components/dashboard/UserMenu.tsx` — avatar dropdown: identity header (name/email/role from `useCurrentMember`), Settings, Personal Tools (Track Time → `timer:open-quick-start` event, My Tasks, Send Feedback → `feedback:open` event), Help (placeholder), Log out. Future personal tools (Notepad, Reminders, Whiteboard) go in the Personal Tools section
  - Left rail (`Sidebar.tsx`) is pure page nav: logo + Home, Workspace, Reports, Tasks, Deliverables; Settings lives in UserMenu (desktop) and the MobileNav drawer (mobile)
  - Layout nesting: rail | column(TopNav / row(ClientListPanel | main)) — `min-h-0` on the inner row and `min-w-0` on the column are load-bearing for scroll
  - Dropdowns use the hand-rolled pattern (useState + outside-click refs), not Radix
  - Deferred polish: Escape-to-close + ARIA on UserMenu; Help button is inert until Help content exists

- **Basecamp timesheet sync** (migration 026, Jul 2026):
  - Time entries push into the client's Basecamp project timesheet (bc-api Timesheets endpoints)
  - `time_logs` gains `basecamp_entry_id`, `basecamp_project_id`, `basecamp_synced_at`, `basecamp_sync_error`
  - Per-client opt-in: `basecamp_timesheet_enabled` in `clients.custom_fields` (toggle in IntegrationsTab Basecamp panel, alongside task sync); discovered project timesheet recording ID cached as `basecamp_timesheet_recording_id`
  - `/api/integrations/basecamp/timesheet`: POST `sync` (create-or-update, idempotent; `createIfMissing` gates new entries) + `remove`; GET availability check (`timesheet_enabled` flag + recording discoverable)
  - Recording resolution: time log linked to a Basecamp-synced task → attaches to that to-do; else project-level timesheet (discovered via entries with `parent.type === 'Timesheet'` — needs one manual BC entry if timesheet is empty)
  - Person attribution via `organization_members.basecamp_person_id` (falls back to token user)
  - UI: "Send to Basecamp" toggle (default on) in StopConfirmSheet + TimeLogModal when client eligible; EditTimeLogSheet shows synced status / retry-on-error / send-later; edits propagate, deletes remove the BC entry; ActivityFeed rows show a Basecamp badge
  - Timesheet API fns in `lib/basecamp/api.ts`; fire-and-forget push helpers in `lib/supabase/time-logs.ts`

- **Notepad personal tool** (migration 024, Jul 2026):
  - UserMenu → Personal Tools → Notepad fires `notepad:open`; `components/notepad/NotepadPanel.tsx` mounted in `app/(dashboard)/layout.tsx` (desktop-only, fixed top-16 right-4, 420×470)
  - `personal_notes` table — strictly personal RLS (`user_id = auth.uid()` + org check); mapper/CRUD in `lib/supabase/personal-notes.ts`, `PersonalNote` in `lib/types.ts`
  - Tiptap v3 editor (`NoteEditor.tsx`): bold/italic/strike, H1–H3, lists, checklists, quotes, links; 800ms debounced autosave + unmount flush; toolbar buttons preventDefault on mousedown so focus stays in the editor (load-bearing)
  - Editor styles live in `app/globals.css` under `.notepad-editor`
  - `NoteList.tsx`: search (title + stripped HTML body), snippets, relative time, archived toggle; `ConvertToTaskModal.tsx` promotes a note to a real Task via `createTask` and stamps `task_id` (no sync back)
  - New notes auto-title with today's date; archive via `archived_at`, delete is hard with confirm

- **Weekly Planner** (migration 026, Jul 2026):
  - `/planner` page — ClickUp Planner-style week time-grid with its own left rail (excluded from `showProjectSidebar`, so no `ClientListPanel`); opts out of the `<main>` padding in `app/(dashboard)/layout.tsx`
  - `planner_events` — org-readable / owner-writable (this is what makes the "Meet with" teammate filter possible), `visibility` `default`/`private`; `planner_priorities` — strictly personal
  - The grid overlays **three sources** normalized to one `PlannerItem` shape (`lib/planner/items.ts`): `planner_events`, tasks with a `start_date` (sized by `estimated_hours`, default 1h), and pending reminders as all-day chips
  - Dragging a backlog task writes `tasks.start_date` — no duplicate record, no sync problem
  - `lib/planner/layout.ts` — pure geometry (interval-graph overlap packing, minute↔pixel, 15-min snap). Only planner module with tests: `node --test lib/planner/layout.test.ts` (15 tests)
  - `lib/planner/use-planner-drag.ts` — ONE pointer-event hook, one `DragState` union for move/resize/create/schedule; optimistic commits that reload on failure. Hand-rolled, no dnd library
  - Day/Week/Month views; `Cmd+/` command bar (`Cmd+K` and `Cmd+Shift+T` stay with `TopNav`)
  - `components/tasks/TaskCalendarView.tsx` is deliberately untouched — the Tasks page month grid is separate code

- **Timesheets — Ledger Grid** (migration 038, Aug 2026):
  - `/timesheets` page — three tabs: **My timesheet** (weekly Ledger Grid), **Team**, **Client review**. Team/Client review are manager-only and gated server-side, not just hidden in the UI
  - `time_logs` stays the ONE canonical ledger. Migration 038 adds `source` ('seo_pm'|'basecamp'), `import_status` ('mapped'|'needs_review'|'voided'), `imported_at`, `provider_updated_at`, `voided_at`, `mapped_by`, `mapped_at`, plus the **partial unique index on `basecamp_entry_id`** — the hard dedupe invariant
  - `protect_time_log_import_provenance` trigger makes all of the above service-role only (same pattern as 031/032)
  - `timesheet_client_approvals` + `timesheet_approval_entries` — immutable client/month snapshots; partial unique index allows one live `approved` row per client month; reopening flips status and keeps the old snapshot
  - **Inbound Basecamp import** — the webhook route now also handles `timesheet_entry_*` kinds. The payload is never trusted: entry id + project come from the canonical recording URL, everything else is re-read via OAuth (`getBasecampTimesheetEntryState`). Unknown person / untracked to-do → `needs_review`, never a guessed client/task/member. Deleted at the provider → `voided_at`, never a delete
  - `lib/basecamp/timesheet-import-merge.ts` — **an import may add attribution, never remove it.** This is what stops an SEO PM → Basecamp echo from blanking a native row's client/task/user, and stops a later provider edit from undoing a manager's manual mapping
  - Reconciliation: `POST /api/integrations/basecamp/timesheet/reconcile` (manager, bounded ≤62 days) and hourly cron `/api/cron/reconcile-timesheets` (CRON_SECRET only, 14-day lookback). Both replay through the *same* importer as the webhook
  - Pure domain logic (all tested, `node:test`): `lib/timesheets/ledger.ts` (weekly grid), `review.ts` (snapshot + `detectPostApprovalChanges`), `team.ts`, `mapping.ts`, `format.ts`
  - API: `/api/timesheets/ledger` (own week always, another member only as manager), `/team`, `/client-review`, `/approvals`, `/mapping`
  - Approval invariant: **an approved snapshot is a record, not a view.** Drift is reported by comparing the frozen snapshot against the live ledger; the only resolution is a manager reopening the month
  - Client budget comes from `clients.seo_hours` — deliberately not a second budget source
  - Activity feed renders `timesheet.client_month_approved` / `_reopened` under the Hours filter

## Key files (campaign)
- `components/campaign/CampaignPlanTab.tsx` — 3-tab orchestrator
- `components/campaign/sections/SectionCard.tsx` — shared helpers, types, label maps
- `components/campaign/sections/SeoOverviewSection.tsx` — ART framework + AI Draft
- `components/campaign/sections/WebsiteAnalysisSection.tsx` — findings builder with screenshots
- `components/campaign/sections/KeywordSnapshotSection.tsx` — keyword opportunities + 3 pull sources
- `components/campaign/sections/ScopeMeterSection.tsx` — capacity planning
- `components/campaign/sections/PreliminaryRoadmapSection.tsx` — client-facing roadmap
- `components/campaign/sections/TimelineSection.tsx` — execution phases + task generation
- `components/campaign/QuestionnaireImportModal.tsx` — PDF upload → AI extraction → review → create
- `lib/campaign-templates.ts` — 3 templates with default content
- `lib/scope-estimates.ts` — 28 SEO activities with hour estimates

## Git workflow
- **Always use a feature branch** — never commit directly to `main`
- Start: `git checkout main && git pull && git checkout -b feat/<name>`
- Codex (GitHub AI) merges security PRs into `main` concurrently — direct pushes cause conflicts
- Run `npx tsc --noEmit` before pushing to catch build errors locally
- **Cap concurrent feature branches at ~2 per subsystem.** If two branches both touch the same core file (e.g. the report block renderer), merge the first one before starting deep work on the second — conflicts caught same-day are a 5-minute fix; conflicts after a week of divergence on both sides are a slog.
- **New chat session = new problem domain, not new branch.** Sequential, tightly-coupled features (same subsystem, same session) are fine and often better — shared context makes merge conflicts fast to resolve. Start a fresh session when switching to an unrelated feature area, not just because you're switching branches.

## Migrations applied to production
001–013: init, analytics, time tracking, notes, feedback, tasks V2, notifications
015: deliverable_commitments (applied Jun 2026)
019: campaign_plans (applied Jun 2026)
021: marketing_plans (applied — verified against the DB Aug 2026)
024: personal_notes (applied Jul 2026)
026: basecamp timesheet sync columns on time_logs (applied — verified against the DB Aug 2026)
027: planner_events + planner_priorities (applied Jul 2026 — renumbered from 026 to clear the collision with 026 above)
028: tasks.start_date -> timestamptz (applied Jul 2026 — renumbered from 027)
029: tasks.scheduled_minutes (applied Jul 2026 — renumbered from 028)
030: time_logs — nullable client_id, counts_toward_budget, planner_event_id (applied Aug 2026)
031: basecamp authorization-state triggers (applied — verified against the DB Aug 2026: a browser-level write to `clients.custom_fields` Basecamp keys is rejected with `42501 clients.custom_fields Basecamp keys are server-controlled`)
032: identity bootstrap, invites, OAuth replay, basecamp recording provenance (applied — verified against the DB Aug 2026: `organization_invites`, `basecamp_oauth_states`, `time_logs.basecamp_recording_id` all present)
033: time_log_segments + timer RPCs (applied Aug 2026 — verified against the DB: all six RPCs resolve and reject `anon` with 42501)
034: start_task_timer project-less fix (applied Aug 2026 — verified live). Supersedes 033's `start_task_timer`; **never edit 033 in place**, supersede it with a new migration
036: task completion time reconciliation (applied Aug 24, 2026 — verified live: authenticated RPC available, anon execution denied, idempotency index present)
037: basecamp_webhook_deliveries (service-only webhook delivery receipts)
038: timesheet ledger provenance + client-month approvals (applied Aug 24, 2026 — verified against the DB: all 7 `time_logs` provenance columns, both partial unique indexes, both approval tables, and the `protect_time_log_import_provenance` trigger are present)

To re-check migration 038 directly, run in the Supabase SQL editor:

```sql
select column_name from information_schema.columns
where table_name = 'time_logs'
  and column_name in ('source','import_status','imported_at','provider_updated_at','voided_at','mapped_by','mapped_at')
order by column_name;

select indexname from pg_indexes
where tablename in ('time_logs','timesheet_client_approvals')
  and indexname in ('time_logs_basecamp_entry_unique','timesheet_client_approvals_active_unique');

select tgname from pg_trigger
where not tgisinternal and tgname = 'protect_time_log_import_provenance';
```

To re-check the 031/032 triggers directly, run in the Supabase SQL editor:

```sql
select tgname, tgrelid::regclass as table_name
from pg_trigger
where not tgisinternal
  and tgname in (
    'protect_organization_internal_status', 'protect_client_basecamp_fields',
    'protect_task_basecamp_linkage', 'protect_time_log_basecamp_entry',
    'protect_time_log_basecamp_tuple'
  )
order by tgname;
```

## Supabase Storage buckets
- `client-logos` — public, 1MB max, image types
- `campaign-screenshots` — public, 50MB max, image types (needs INSERT/SELECT/DELETE policies on storage.objects)

## Test / sandbox environment (Aug 2026)
A self-contained tenant for testing features against production **without touching real client data**. Everything below already exists — don't recreate it.

**Multi-org switcher:** `components/organization-switcher.tsx` is mounted in `components/dashboard/TopNav.tsx` (top-left). It lists your org memberships and persists the choice to `localStorage.selectedOrgId`. Creating an org from it calls the `bootstrap_organization_owner` RPC (migration 032 removed the browser-writable `organization_members` insert — a direct insert now fails).

**The sandbox tenant:**
- Org: **Sandbox (testing)** — `06e536b9-beac-49bc-8c96-1df021102590`
- Client: **Sandbox Client A** — `cbba5b14-7e24-4913-b396-0fff7fb2df17`, 10 SEO hrs/mo, Active
- Basecamp project: **SEO Ops Sandbox (testing)** — `48599958` (disposable; not real work)
- Basecamp todolist: none. The to-do path needs a todolist — create one in the project and set it as the client's Default Todolist in IntegrationsTab. (The `SEO Tasks` test list was deleted and the client's `basecamp_todolist_id` cleared.)

RLS scopes everything by `organization_id`, so the sandbox org is invisible to your real 46-client workspace, KPIs, and reports. Switch into it via the top-nav org switcher.

**Binding a sandbox client to Basecamp needs service-role SQL** — migration 031's `protect_client_basecamp_fields` trigger rejects browser-level writes to `clients.custom_fields` Basecamp keys (`42501 clients.custom_fields Basecamp keys are server-controlled`). The escape hatch is the Supabase SQL editor (runs as `postgres`). To (re)bind:
```sql
update public.clients
set custom_fields =
      (coalesce(custom_fields, '{}'::jsonb) - 'basecamp_timesheet_recording_id')
      || jsonb_build_object('basecamp_sync_enabled', true,
                            'basecamp_project_id', 48599958,
                            'basecamp_timesheet_enabled', true)
where id = 'cbba5b14-7e24-4913-b396-0fff7fb2df17'
returning name, custom_fields;
```
Always strip `basecamp_timesheet_recording_id` when changing project — a stale cached recording makes sync fail with "No verified Basecamp timesheet recording is available". (The IntegrationsTab clears it automatically on project change; raw SQL must do it by hand.) Once bound, the IntegrationsTab shows the project in its now-scoped dropdown and can set the default todolist normally.

**Basecamp sandbox gotchas (all verified):**
- A **project-level timesheet entry is load-bearing.** Recording discovery scans existing entries for `parent.type === 'Timesheet'` (the timesheet never appears in the project dock, even when enabled). The sandbox project keeps one seed entry — `10228422582` ("testing", 2.0h). **Do not delete it**, or project-timesheet sync breaks.
- **A fresh Basecamp project has no todolists.** Task push creates to-dos *inside* a list, it doesn't create the list — a todolist must exist first (the "SEO Tasks" list above).
- `timesheet_enabled` is **read-only via the API** — enable the Timesheet tool by hand in Basecamp (project → ••• → Configure tools).
- In IntegrationsTab the **master Basecamp toggle** (`basecamp_sync_enabled`) is separate from the **Time tracking toggle** (`basecamp_timesheet_enabled`). Saving with the master toggle off silently disables sync; both must be on.

**Time-entry routing** (same client, same project, different Basecamp recording): a time log on a task with a `basecamp_todo_id` matching the client's project attaches to that **to-do**; otherwise it attaches to the **project-level timesheet**. Both paths verified live.

**Caveat:** the sandbox shares the production database, so it does **not** rehearse migrations. Only a separate Supabase project catches a bad migration before prod (e.g. the 033 project-less-timer bug). Staging DB is still unbuilt.

## Known bugs (workspace module)
- Manager filter dropdown shows duplicates ("Abel" + "Abel Miranda") — `account_manager_name` is denormalized text, not normalized via `account_manager_id`
- "My Clients" toggle shows empty — string comparison of `accountManager` vs `displayName` fails when names don't match exactly; should use `accountManagerId`
- "Onboarding" clients appear in Archived tab in ClientListPanel — should be in Active
- Client table has no column sorting
- `Paused` and `Onboarding` both map to DB status `pending` — Paused is unrecoverable on read

## Pending work
- **Workspace bugs** — fix manager duplicates, My Clients filter, Onboarding categorization, add table sorting
- Task auto-generation from `task_template_id` on commitments
- Retire `clients.blogs_due_per_month` (swap `onTrackStatus()` to use commitments)
- Quarterly cadence for commitments
- Client-facing read-only deliverables view
- Fulfillment section in reports
