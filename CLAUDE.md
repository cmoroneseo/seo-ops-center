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

## Migrations applied to production
001–013: init, analytics, time tracking, notes, feedback, tasks V2, notifications
015: deliverable_commitments (applied Jun 2026)

## Pending manual Supabase step
Run once in Supabase Dashboard SQL editor (enables realtime push for notification bell):
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
```

## Pending Phase 2 (not built)
- Task auto-generation from `task_template_id` on commitments
- Retire `clients.blogs_due_per_month` (swap `onTrackStatus()` to use commitments)
- Quarterly cadence for commitments
- Client-facing read-only deliverables view
- Fulfillment section in reports
- Word-count / QA analytics from status_history cycle times
