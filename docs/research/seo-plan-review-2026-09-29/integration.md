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
- Goal save, fresh/bulk promotion, and existing-task link submission still require migration 061. No end-to-end claim for those writes or Basecamp import.

## Release gate

Apply 061 only after verifying target DB migration state; keep 059 and 060 already pushed. Then verify goal save, new and bulk promotion, existing Basecamp task linking, completion/time review, and report date consistency on the sandbox client. Do not deploy the integrated app before 061 is available. Production database and main deployment were not changed during integration.
