# SEO Plan implementation and integration review — September 29, 2026

## Verdict

Safe to continue development after preserving the uncommitted workspace and integrating against the latest remote main. Do not blindly pull, overwrite the folder, or deploy the old local version. The missing UI is present locally but was never committed or pushed. The named feature branch still points to the original base commit, not the UI implementation.

Reviewed local main 66c52f7, remote main d4cb059, and the uncommitted working tree. Remote refs were refreshed. Latest SEO Plan commits: 6902040 (bulk generation/status sync), 321c93b (report step/month view); d4cb059 also adds a client portal. Remote source was exported to /tmp for checks without altering the checkout. No app source, branch, production data, or deployment was changed during this review.

## Feature inventory

| Agreed feature | Latest pushed main | Local working files |
|---|---|---|
| SEO Plan naming | Yes, centralized SEO_PLAN_LABEL | Yes, some strings still hardcoded |
| Monthly execution workspace | No | Yes, ExecutionWorkspace.tsx |
| Large calendar month heading | No | Yes |
| Logged/planned/available capacity bar | No | Yes |
| Adjacent inline task editor | No | Yes |
| This month / Full plan / Results | No | Yes |
| Client tasks nested inside SEO Plan | No; separate Tasks tab remains | Yes |
| Basecamp import inside nested tasks | No; Integrations entry retained | Yes; original modal reused |
| Bulk generation with preview/failures | Yes | Not integrated |
| Durable task-to-checklist status sync | Migration 059 added | Not integrated; local computes status from joined tasks |
| Step or engagement-month reports | Yes; report-only view | Not integrated |
| Client portal | Yes, new staff tab and portal routes | Not integrated |
| Atomic task promotion + plan goal | No | Migration 059 local only |
| Prioritization rationale / source evidence | No dedicated implementation | Description text only; richer integrations remain future work |

The report “Month 1, Month 2” grouping is an engagement-month view. It does not implement the calendar-month workspace selected in this conversation.

## Findings to resolve

### P1 — UI work is uncommitted and has no remote branch containing it

`git status` shows 17 tracked modified files plus new execution component/logic/tests/migration and research files. `feat/marketing-plan-monthly-execution` points to 9046194. There is no commit history for ExecutionWorkspace.tsx. This explains why pushing Cursor's commits did not publish the UI. Preserve all working files before any checkout/reset. The remote main also contains portal work absent locally; publishing the old local version could omit those changes.

### P1 — Two different migrations use 059

Remote: migrations/059_marketing_plan_task_sync.sql, plus 060_client_portal.sql. Local: migrations/059_marketing_plan_execution.sql. Their SQL serves different purposes and can be combined, but the duplicate version needs resolution. Keep the existing pushed versions and rename the unreleased execution migration to the next unused version (currently 061 after a fresh check). Update schema mirror and tests. Repository presence does not establish which migrations have run in production; verify actual DB state before release.

### P1 — Report dates can disagree with linked task dates

Remote lib/marketing-plan-logic.ts:293–301 prefers an item's saved dueDate over its linked task. MarketingPlanReportBlock.tsx:61 fetches task dates only when the item date is blank. After task generation, moving a task from September to October leaves its checklist date unchanged; reports can keep it in September. Our local resolvePlanItem instead treats linked task dates as authoritative. Use one precedence rule in execution, reports, exports, and portal reads; include cleared due dates in coverage.

### P1 — Promotion is not fully atomic

Remote lib/supabase/marketing-plans.ts:227–244 creates a task, then attempts to claim the item link; on failure it deletes the new task without checking cleanup success. createTask already emits assignment notifications and activity before the link succeeds. Concurrent requests or a link-write failure can produce phantom notifications/activity or an orphan if deletion fails. The local row-locking RPC addresses task/link atomicity. Retain the new bulk preview while routing each creation through that atomic path. Idempotent retries should return the existing task. Notifications should reflect actual creation, rather than fire again on reused tasks.

### P2 — Linked-item checkbox bypasses normal completion review

Remote ItemRow.tsx:toggleDone directly calls updateTask with done. TaskDetailModal.tsx:328 instead opens completion reconciliation before marking done, including time review and open-timer handling. Completing the same task from the checklist skips that workflow. Route linked completion through the same review path; our local Open task / Review & complete flow already does this. The existing sync tests validate status transitions, not completion/time consistency.

### P2 — Query failures can look like an absent or empty plan

Remote getMarketingPlan returns null on plan errors and a plan without items on item errors (lib/supabase/marketing-plans.ts:60,69). The UI may invite creation when loading actually failed. Preserve the local explicit error/retry behavior and update remote consumers to catch errors if this helper starts throwing. Report loader currently lacks an error catch; do not simply substitute the throwing local helper without updating that consumer.

### P2 — Imported tasks are accessible but not selectable as monthly SEO priorities

The local nested All client tasks view preserves Basecamp import. Monthly execution only reads marketing_plan_items linked to tasks. Schedule work picks plan items and creates/reuses their tasks; it offers no way to select an already-imported task and attach it to a priority. This is a workflow gap, not data loss. Add an explicit “Add existing task to plan” flow with client/org validation so imported work can enter the plan without duplication.

### P2 — Live status sync does not refresh the open checklist automatically

Remote sync trigger makes item statuses durable, but MarketingPlanTab loads on mount and its own actions; it has no task realtime/focus refresh. An update from Tasks or Basecamp can leave an already-open checklist stale. Preserve local focus/timer refresh and consider scoped realtime updates. The local resolver also currently overwrites ignored state for linked items while the remote trigger deliberately preserves ignored; settle that behavior during integration.

## Merge assessment

A three-way merge simulation using local working files, local main as the base, and remote main showed conflicts in ItemRow, MarketingPlanTab, marketing-plans CRUD, workspace page, and schema.sql. Shared types merged textually, but this is not proof of behavioral compatibility. Resolve intentionally to preserve bulk generation, report views, portal navigation, the monthly UI, and the original Basecamp import components/routes.

## Validation

Latest remote source: TypeScript passed; 29 focused tests passed across marketing-plan logic, task-sync migration (PGlite), bulk-generation panel, and report view. Local TypeScript and execution/migration checks were also run. These checks do not verify production migration state, deployed commit, or a real Basecamp import. No broad portal security audit was performed.

## Recommended continuation

1. Snapshot the entire uncommitted implementation on a feature branch, including currently untracked code/tests/migration.
2. Integrate latest main without discarding bulk generation, month reports, or Client portal.
3. Renumber the local execution migration and unify promotion/date/status behavior.
4. Close the completion/error-handling gaps, then add existing-task selection for Basecamp imports.
5. Verify combined tests, sandbox UI, import/duplicate handling, report dates, and actual DB migration state before releasing.
