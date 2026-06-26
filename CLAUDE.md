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
- `lib/seo-ops-logic.test.ts` — unit tests (run: `npx vitest`)
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

## Migrations applied to production
001–013: init, analytics, time tracking, notes, feedback, tasks V2, notifications
015: deliverable_commitments (applied Jun 2026)
019: campaign_plans (applied Jun 2026)

## Supabase Storage buckets
- `client-logos` — public, 1MB max, image types
- `campaign-screenshots` — public, 50MB max, image types (needs INSERT/SELECT/DELETE policies on storage.objects)

## Known bugs (workspace module)
- Manager filter dropdown shows duplicates ("Abel" + "Abel Miranda") — `account_manager_name` is denormalized text, not normalized via `account_manager_id`
- "My Clients" toggle shows empty — string comparison of `accountManager` vs `displayName` fails when names don't match exactly; should use `accountManagerId`
- "Onboarding" clients appear in Archived tab in ClientListPanel — should be in Active
- Client table has no column sorting
- `Paused` and `Onboarding` both map to DB status `pending` — Paused is unrecoverable on read

## Pending work
- **Client-facing presentation view** — read-only Better Proposals-style document from campaign plan data
- **PDF/Proposal export** — print button for campaign plans
- **Workspace bugs** — fix manager duplicates, My Clients filter, Onboarding categorization, add table sorting
- Task auto-generation from `task_template_id` on commitments
- Retire `clients.blogs_due_per_month` (swap `onTrackStatus()` to use commitments)
- Quarterly cadence for commitments
- Client-facing read-only deliverables view
- Fulfillment section in reports
