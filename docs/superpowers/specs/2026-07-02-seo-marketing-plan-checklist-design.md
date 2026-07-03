# SEO Marketing Plan — Checklist Design

Date: 2026-07-02
Status: Approved by Carlos
Supersedes: docs/marketing-campaign-feature-plan.md (the "campaign cockpit" direction is abandoned)

## Summary

Replace the entire Campaign Plan tab on `workspace/[id]` with a single SE Ranking-style
task checklist called **SEO Marketing Plan**. One plan per client, seeded from a 7-step
template of ~55–65 items. Items are checked off, prioritized, assigned, commented on,
and optionally promoted to real Tasks. No draft/review/approve lifecycle — the plan
just exists and the team works it.

Reference UI: SE Ranking Marketing Plan screenshots (summary strip, sticky step rail,
grouping toggle, expandable item details with inline comments).

## Decisions made

| Decision | Choice |
|---|---|
| Scope | Full replacement of the 3-tab Campaign Plan UI |
| Data model | New separate tables; items promotable to real Tasks one at a time |
| Template content | Claude drafts 7-step template; Carlos edits before launch |
| Existing campaign data | Keep all `campaign_*` tables and data; UI unmounted, not deleted |
| Extras kept | Export (print/PDF) and AI assist. Questionnaire PDF import dropped. |
| Lifecycle | None. No draft/internal_review/approved states. |

## Schema (migration 020)

Two new tables, standard RLS (`organization_id IN (SELECT get_user_org_ids())`),
mirrored into `schema.sql`.

### marketing_plans

- `id` uuid PK
- `organization_id` uuid
- `client_id` uuid, **unique** — one plan per client
- `title` text
- `steps` jsonb — array of `{ key, name, sortOrder }`, seeded from template
- `created_at`, `updated_at`

### marketing_plan_items

- `id` uuid PK
- `marketing_plan_id` uuid FK → marketing_plans
- `organization_id` uuid, `client_id` uuid
- `step_key` text — references a key in the plan's `steps` jsonb
- `title` text, `description` text
- `status` text CHECK: `todo` | `done` | `ignored` (default `todo`)
- `priority` text CHECK: `high` | `medium` | `low` (default `medium`)
- `assignee_id` uuid nullable (same user reference the tasks table uses)
- `due_date` date nullable
- `sort_order` int
- `comments` jsonb default `[]` — array of `{ authorId, authorName, body, createdAt }`
- `task_id` uuid nullable FK → tasks — set when item is promoted
- `is_custom` boolean default false — true for user-added items (deletable)
- `created_at`, `updated_at`

Index on `marketing_plan_id`.

## Template — lib/marketing-plan-template.ts

Seven steps modeled on SE Ranking, content rewritten for Marketing Empire Group's
stack (GSC, GA4, Ahrefs, GBP — not SE Ranking tooling):

1. Introduction & Setup
2. Technical SEO
3. Keyword & Competitor Research
4. Content Audit & Creation
5. On-page SEO
6. Link Building
7. Local SEO

~55–65 items total, each with title, description, default priority. Claude drafts;
Carlos edits the file before launch.

## UI — components/marketing-plan/

New folder. Layout mirrors the SE Ranking screenshots.

- **MarketingPlanTab.tsx** — orchestrator. Empty state = single
  "Create SEO Marketing Plan" button that seeds steps + items from the template.
- **Summary strip** — three columns: Plan Progress (`12/65` + percent bar),
  Task Status counts (To Do / Done / Ignored), Priority counts (High / Medium / Low).
- **Sticky left step rail** — 7 steps with per-step done counts; click jumps to group.
- **Item list** — grouped by step by default; grouping toggle **By Priority /
  By Status**; keyword search; "Add Item" button adds a custom item to a step
  (SE Ranking labels this "Add New Task" — we say "Add Item" to avoid confusion
  with real Tasks, which are created via Promote to Task).
- **Item row** — checkbox (todo ↔ done), title, priority dropdown, overflow menu
  (Ignore, Promote to Task, Delete — delete only for `is_custom` items), expandable
  **Show details**: description, assignee / due date / comment count chips, inline
  comment composer (avatar, input, Cancel/Save).

## Push-to-task

"Promote to Task" creates a real Task (title, description, priority, client
pre-filled), stores `task_id` on the item, and renders a "→ Task" chip linking to it.
No auto-sync of completion in v1 — the checklist checkbox stays manual.

## Export

Print-friendly stylesheet + Export button calling `window.print()` → PDF, same
pattern as the report builder.

## AI assist

"Suggest Items" button → new API route `/api/marketing-plan/suggest-items`
(Anthropic SDK, same pattern as `draft-overview`). Reads client context (services,
locations, existing items) and returns 5–10 suggested items the user accepts or
dismisses before insertion.

## Workspace integration & old code

- `app/(dashboard)/workspace/[id]/page.tsx`: swap `CampaignPlanTab` →
  `MarketingPlanTab`; tab label becomes "SEO Marketing Plan".
- All `components/campaign/*` files, `lib/supabase/campaign-plans.ts`,
  `lib/campaign-templates.ts`, and `campaign_*` tables remain in place, unmounted.
  Data preserved and resurrectable.

## Logic & tests

Pure functions in `lib/marketing-plan-logic.ts` with vitest tests
(`lib/marketing-plan-logic.test.ts`), per the `seo-ops-logic.ts` pattern:

- progress percent and done/total counts
- status and priority count rollups
- grouping (by step / priority / status)
- keyword search filter

## CRUD layer — lib/supabase/marketing-plans.ts

`rowToX` / `xToRow` mappers per convention. Functions:

- `getMarketingPlan(clientId)` — plan + items in one fetch
- `createMarketingPlanFromTemplate(organizationId, clientId, clientName)`
- `updateMarketingPlanItem(id, patch)` — status, priority, assignee, due date, title
- `addItemComment(id, comment)` — append to comments jsonb
- `addCustomItem(planId, stepKey, fields)`
- `promoteItemToTask(item)` — creates task, sets `task_id`

## Out of scope (v1)

- Questionnaire PDF import
- Task → checklist completion sync
- Editable/custom step groups (steps come from template; jsonb supports it later)
- Multiple templates or plan re-seeding
- Client-facing view
