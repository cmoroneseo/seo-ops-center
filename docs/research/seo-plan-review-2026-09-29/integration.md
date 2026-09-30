# SEO Plan integration — September 29, 2026

Branch: codex/seo-plan-integration. Preserved the original monthly UI in 4ecf6f6 and integrated remote main d4cb059.

## Resolved

- Combined the calendar-month heading, logged/planned/available capacity bar, monthly task editor, and nested All client tasks with bulk generation, month reports, and Client portal.
- Original Basecamp import dialog remains in Integrations and All client tasks. Added an existing-task picker that links original imported tasks rather than copying them. RPC checks client/org and plan category; retries reuse the link.
- Unreleased execution migration is 061, following pushed 059 task sync and 060 portal. schema.sql mirrors all three.
- Bulk and individual task promotion use a row-locking RPC. Reused tasks bypass creation notifications/activity.
- Linked tasks own execution dates, including cleared dates. Reports and client-safe portal slices use the same dates/statuses. Ignored items remain excluded.
- Linked checklist rows open the existing task modal rather than bypass completion/time reconciliation.
- Query errors have explicit recovery states; background plan refreshes preserve dirty task drafts and discard obsolete load results.

## Verification

- TypeScript passes after refreshing Next route types.
- Full suite: 1,307 passed, 0 failed.
- Targeted lint on monthly workspace/existing-task dialog/plan orchestrator/execution logic: passes.
- PGlite verifies promotion idempotency, created vs reused result, RLS rejection, existing-task linking retries, invalid category and wrong-client rejection, plus schema mirroring.
- Authenticated local verification completed September 30 in the in-app browser, Sandbox (testing), Sandbox Client A. Monthly heading/capacity, linked task editor, existing-task picker, Full plan, bulk preview, Results, and month navigation load.
- Inline estimate changed 2.5h → 3h: capacity updated to 3h planned/7h available with Tasks save confirmation. Restored to 2.5h, verified 2.5h planned/7.5h available. Completion review opens the existing time-confirmation dialog; cancelled without changing status.
- Nested All client tasks shows 3 active/1 completed. Basecamp import loads SEO Ops Sandbox (testing), then reports no to-do lists; no import submitted. Existing-task picker excludes the already-linked task and offers the two open unlinked sandbox tasks.
- Fixed stale SEO Marketing Plan heading and wrapping SEO Plan parent tab label found during visual checks. Screenshot: monthly-preview.png.
- Migration-dependent DB checks completed below; browser submissions for bulk creation and Basecamp import remain unverified.

## Database release verification — September 30

User authorized applying 061. Target confirmed: SEO Project Management, sgszojorcftyaknruckh, matching the local app configuration. Existing 059 task sync and 060 portal migrations were present.

- Applied exact 061_marketing_plan_execution.sql; recorded version 20260930054231.
- Verification found direct anon grants from Supabase default privileges survived revoking PUBLIC. Applied additive 062_marketing_plan_execution_permissions.sql to revoke anon explicitly. Both RPCs are SECURITY INVOKER with fixed search_path; authenticated can execute, anon cannot. RLS remains enabled on all three tables.
- Authenticated-role database checks on Sandbox Client A passed in a transaction that was rolled back: goal update, new promotion, promotion retry reusing task with created=false, existing-task link, and linking retry reusing item. No test data retained.
- PGlite regression reproduces the direct anon default grant and verifies 062 removes it while preserving authenticated access. Schema mirrors 062.
- Security advisors reported no findings for either new function. Existing advisor categories/counts stayed unchanged; unrelated legacy advisory findings remain outside this migration.

The DB migration gate is cleared. Browser checks for full bulk creation/import and client portal/report flows remain before release approval. Main/deployment were not changed; PR #94 remains draft.
