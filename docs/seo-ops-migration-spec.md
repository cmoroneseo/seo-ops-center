# SEO Ops — Workbook → App Migration Spec (Stage 0)

Feature-by-feature design sign-off. This is the no-code pass that fixes the
exact columns/behaviors before migration `003` is written. Principle: keep the
*intent* of each sheet, drop the *spreadsheet workarounds*
(see plan `~/.claude/plans/we-are-at-a-harmonic-duckling.md` §0).

Conventions used below:
- **Stored** = a column the user types/imports. **Computed** = derived on read
  (SQL view or app query), never stored, so it can't drift.
- **FK** = real foreign key (UUID), not a client-name string.
- Every entity carries `custom_fields jsonb` (ad-hoc columns, lossless import).
- All imported rows are editable (inline + bulk). No locked/read-only records.

---

## 1. Client (← "Client Overview" + "Client Campaigns" + "Client Analytics Map")

One `clients` row per client. Collapses three sheets into the master record.

| Field | Mode | Notes |
|---|---|---|
| name, domain, status | stored | status: active / inactive / pending (existing) |
| client_slug | stored | lowercased-alphanumeric of name; **import join key only**, not shown |
| launch_date, original_launch_date, launch_date_override | stored | override wins when present (sheet col B/T/U) |
| seo_hours | stored | monthly hour budget (col C) |
| engagement_model | stored | `Retainer` \| `Campaign` (from "Hour Type") |
| deliverables_spec | stored | raw cadence string, e.g. `2x/month`, `Campaign: 7 blogs` (col E) |
| blogs_due_per_month | stored* | *parsed from spec on import via `parseBlogsPerMonth`; thereafter editable |
| account_manager_id (+ _name fallback) | stored | FK to users; name kept when no user yet (Carlos/Abel) |
| tier | stored | 1/2/3 |
| target_blog_count, delivered_override | stored | col J / col N |
| notes, planning_tags | stored | col P / col Q |
| campaign_start, campaign_end, campaign_total_blogs, campaign_total_hours | stored | only meaningful when engagement_model='Campaign' (← Client Campaigns sheet) |
| ga4_property_id, gsc_url | stored | from Analytics Map; **no UI this phase**, powers later live-data |
| **actual_blogs_due_to_date** | **computed** | `actualBlogsDueToDate()` — was col K (prorated months×cadence, or campaign fixed) |
| **blogs_delivered (this month)** | **computed** | COUNT of deliverables delivered this month (was col L) |
| **past_due_blogs** | **computed** | max(0, due − delivered) (was col M) |
| **on_track_status** | **computed** | `onTrackStatus()` → `{status, severity, reason}`, not an emoji string (was col O) |

Decisions:
- Engagement changes mid-contract (the Change Log proves it). For now store
  current engagement on the client; the change_log table preserves history so
  past-month reports use the value-at-the-time. (Full effective-dated engagement
  records are a later refinement, noted but not built.)
- "Campaign vs Retainer" branching lives in the computed helpers, not in columns.

---

## 2. Deliverables (← "Deliverables Tracker")

New `deliverables` table. The sheet's single status cell becomes a real
lifecycle with timestamps → enables cycle-time analytics.

| Field | Mode | Notes |
|---|---|---|
| client_id | stored FK | replaces name-match |
| title | stored | blog title / deliverable name |
| type | stored | Content / Backlink / GBP / Other (sheet "Deliverables" col ≈ "Blog") |
| status | stored | lifecycle: Pending → In Progress → Review → Approved → Published |
| due_date, month | stored | month is `YYYY-MM` for fast monthly rollups |
| account_manager_id | stored FK | was a VLOOKUP back to Client Overview — now just the client's AM by default |
| delivered_on | stored | timestamp (sheet had free text like "Approved" → migrate to status + this) |
| counts_toward_hours | stored | default true |
| notes | stored | |
| **status_history** | stored (jsonb) or computed | record transitions `{status, at}` so we can measure time-in-review; minimal version = `delivered_on` + `created_at` |

Decisions:
- Map legacy statuses: `Not Started`→Pending, `In Progress`→In Progress,
  `Delivered`→Published (or Approved if "Approved" appears in col I).
- AM is denormalized from the client at creation but editable per-deliverable.

---

## 3. Hours (← "Daily Hours Log") — single source of truth

Reuse existing `time_logs`. **This is the only place hours are stored.**

| Field | Mode | Notes |
|---|---|---|
| date | stored | |
| client_id | stored FK | was client name |
| user_id | stored FK | from "Account Manager" name |
| hours | stored | |
| description | stored | "Task / Notes" |
| billable | stored | default true |

Everything the sheet recomputed from hours is **computed downstream**:
"Hours Logged", "Remaining", "% Used", planner "W# Logged", Department Metrics
"Actual Hours". No stored duplicates, no SUMIFS.

---

## 4. Monthly Planner (← 11 "<Month> Planner" tabs + "Hourly Planner")

Reuse `monthly_plans` (one row per client per `YYYY-MM`). Tabs → rows.

| Field | Mode | Notes |
|---|---|---|
| client_id, month | stored FK + text | unique(client_id, month) |
| weeks[] | mixed | array of `{week, label, planned, logged, variance}` |
| weeks[].planned | stored | the only typed value; optionally pre-filled via `tierWeekWeights` |
| weeks[].logged | **computed** | SUM(time_logs) for that client in that week |
| weeks[].variance | **computed** | planned − logged |
| total / remaining / carry_over | **computed** | were stored columns; now derived |
| notes | stored | |

Decisions:
- "Carry Over" (manual in sheet) becomes computed = prior month remaining; no
  hand-maintained column.
- Auto-distribution of `planned` across weeks (VelocitySystem/TimeAllocation)
  is **deferred**; `tierWeekWeights` is available to pre-fill as a convenience.

---

## 5. Client Change Log (← "Client Change Log") — now automatic

New `client_change_log`. Hand-typed in the sheet; here it's written
automatically whenever `seo_hours` or `blogs_due_per_month` changes.

| Field | Mode | Notes |
|---|---|---|
| client_id | stored FK | |
| date_of_change | stored | defaults now() |
| changed_by_id | stored FK | from auth.uid(), not typed |
| prev_seo_hours, new_seo_hours | stored | captured by trigger/app |
| prev_blog_count, new_blog_count | stored | |
| effective_date | stored | when the change takes effect (may differ from logged date) |
| notes | stored | reason (e.g. "Reallocation of budget") |

Decision: implement via a DB trigger on `clients` (or app-side audit write) so
it can't be forgotten. Historical rows imported as-is from the sheet.

---

## 6. Team Bonus (← "SEO Team Bonus Tracker") — admin-only

New `team_bonus`. RLS restricts reads to org owner/admin (not members/viewers).

| Field | Mode | Notes |
|---|---|---|
| user_id (+ member_name fallback) | stored FK | Carlos / Abel |
| month | stored | `YYYY-MM` |
| base_from_hours | stored or computed | from logged hours |
| kpi_bonus | stored | KPI count × $50 (ranking/visibility/etc.) |
| total_bonus | computed | `teamBonus()` = `MIN(base + kpi, cap)` |
| cap | stored | default 300 |
| notes | stored | |

Decision: keep the `MIN(..., 300)` cap + `×50` KPI logic in `teamBonus()` in
`lib/seo-ops-logic.ts`; store the inputs, compute the total.

---

## Rebuilt as live queries (NOT imported)

These sheets are pure formulas over the data above → rebuild as in-app queries,
no tables, no import:
- **Monthly SEO Summary** — per active client: hours logged vs budget, % used,
  `hoursUsageStatus()`. Source: time_logs + clients.
- **Dashboard** — blog-status counts for the month. Source: deliverables.
- **Department Metrics** — per AM: active clients, blogs due, total/actual hours,
  % alloc, monthly capacity (`NETWORKDAYS×8`). Source: clients + time_logs.
- **Client List** — just active clients. Source: clients filter.

## Deferred (documented, not built this phase)
GTM/CIPO checklists, auto-scheduler, Wrap & Trap, live analytics, billing gating.
