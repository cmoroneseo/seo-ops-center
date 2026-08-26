# Timesheet Import & Review — Design

**Date:** 2026-08-25
**Status:** approved for planning
**Builds on:** migration 038 (timesheet ledger), `/timesheets` Ledger Grid

## Problem

SEO PM's ledger is empty of the work already recorded in Basecamp. Abel logs time
in Basecamp; none of it reaches SEO PM, so client budgets, the weekly grid, and
monthly approvals all understate reality.

Importing it naively makes things worse, because the Basecamp data is thin.

## What the real data says

Measured against Abel's August 2026 timesheet (person `39146116`):

| Fact | Value |
|---|---|
| Entries | 14 |
| Hours | 24.3 |
| Distinct Basecamp projects | 13 |
| Entries with a description | **1 of 14** |
| Entries linked to a to-do | **0 of 14** |
| Hours that today's importer would ingest | **0 of 24.3** |

Three consequences drive the whole design:

1. **Context, not identity, is the bottleneck.** 13 of 14 entries have an empty
   description. A row reading `0.4h` against a client is unusable for client
   reporting. This is a data-capture problem wearing an import problem's clothes.
2. **Task linkage cannot be a gate.** No entry links to a to-do. Blocking on it
   would import nothing.
3. **The current import gate is the wrong flag.** The importer requires
   `clients.custom_fields.basecamp_timesheet_enabled`, which was built as the
   *push* opt-in (send SEO PM time out to Basecamp). Every project Abel logged to
   has it off, or is not bound to a client at all.

### Measurement caveat, recorded deliberately

An earlier probe reported 33 entries / 43.9h. That was wrong.
`GET /projects/{id}/timesheet.json` returns the *same* entries on every page of
its `Link`-header pagination, so a naive pagination loop multiplies every entry
by its page count. The CSV report is the accurate source.

**This bug exists in shipped code** (`listBasecampTimesheetEntryStubs`,
`listBasecampProjectTimesheetEntries`). Dedupe on `basecamp_entry_id` means
reconciliation still lands correct rows, but it does N× the work and reports
inflated scan counts. Fixing it is in scope.

## Decisions

| Question | Decision |
|---|---|
| Import scope | Bound clients + projects explicitly named internal; unknown projects surface for a one-time decision |
| Where un-reviewed rows live | In `time_logs`, quarantined by status — not a staging table |
| Handoff | Member enriches, then explicit batch submit; manager approves or bounces |
| Context capture | Activity picker (not free text) + Basecamp to-do suggestions + bulk apply to selection |
| Budget eligibility | Derived from chosen activity, with per-entry override |
| Backfill transport | Server-side CSV fetch; webhook remains the ongoing path |

Rejected: merging duplicate blocks into one entry (breaks the 1:1 mapping back to
Basecamp entry IDs that makes re-import safe).

## Architecture

### Lifecycle

`time_logs.import_status` becomes a four-state machine, replacing today's
`'mapped' | 'needs_review' | 'voided'`:

```
needs_context  →  pending_review  →  mapped
                        ↓ (bounce)
                  needs_context
                                      voided  (deleted at provider, any state)
```

Only `mapped` rows count toward any budget total, client review, or approval.
Quarantine is a status, not a location — this preserves the founding rule that
`time_logs` is the one canonical ledger.

`needs_review` (migration 038) is replaced by `needs_context`. Safe: production
holds zero imported rows today.

### Issues, not just status

A quarantined row carries computed issues so the UI can show a checklist:

- `no_client` — no client resolved and not marked internal
- `no_activity` — no activity chosen (this is the 13-of-14 case)
- `no_task_link` — **advisory only**, never blocks

Issues are derived on read, never stored — same compute-on-read convention as
`lib/seo-ops-logic.ts`.

### Project roles — replacing the wrong gate

New table `basecamp_project_roles`:

| column | purpose |
|---|---|
| `organization_id` | tenant scope |
| `basecamp_project_id` | Basecamp bucket id |
| `basecamp_project_name` | last-seen name, for CSV name resolution |
| `role` | `client` \| `internal` \| `ignored` |
| `client_id` | required when role is `client` |

- `client` — time counts against that client's SEO budget
- `internal` — tracked as internal work, `client_id` null, never touches a
  client budget (Marketing Empire Group HQ, SEO HQ)
- `ignored` — permanently out of scope, stops re-surfacing

A project with no row imports as `needs_context` with `no_client`, so it is
decided once rather than silently skipped. `basecamp_timesheet_enabled` reverts
to meaning only what it always meant: the outbound push opt-in.

### Two import paths, one identity

**Backfill (CSV).** `GET https://3.basecampapi.com/{account}/reports/timesheet.csv`
with `people_ids[]`, `start_date`, `end_date`, using the existing OAuth token.
One request replaces the 101-project sweep and removes the 300s timeout risk.

Columns: `Date,Person,Hours,Project,Item,Notes,Created`. No entry id, no project
id, project by **name** — and names do not match client names exactly
("Pipe It Right" vs client "Pipe It Right Plumbing"). Name resolution goes
through `basecamp_project_roles.basecamp_project_name`, falling back to a
Basecamp project list lookup; unresolved names become `no_client`.

**Ongoing (webhook).** Unchanged from migration 038. Carries a real
`basecamp_entry_id` and to-do parent.

**The bridge.** CSV rows have no entry id, so they store
`import_fingerprint` — a hash of `person + project + date + hours + created`
(all 14 August rows are unique on this key; `Created` is second-precision).

When a webhook later fires for an entry that was already CSV-imported:

1. match on `basecamp_entry_id` — normal path;
2. if no match, match on `import_fingerprint` and **adopt** that row, stamping
   the entry id onto it;
3. only if neither matches, insert.

This extends `mergeImportedEntry`, whose existing rule — *an import may add
attribution, never remove it* — already covers the rest.

Manual CSV upload reuses the same parser, for when OAuth is down or the data
predates Basecamp's report range. **Deferred:** the server-side fetch covers
every case we currently have, and `parseTimesheetCsv` is transport-agnostic, so
adding an upload endpoint later is a route and a file input — not a redesign.

## Implementation plans

This design is executed as two sequential plans:

1. `docs/superpowers/plans/2026-08-25-timesheet-import-foundation.md` — schema,
   CSV parsing and identity, project roles, backfill. Ends with real data in the
   ledger, quarantined and provably duplicate-free.
2. `docs/superpowers/plans/2026-08-25-timesheet-import-review-workflow.md` —
   issues, state transitions, queue API, review UI, retiring the mapping sheet.

Plan 2 depends on Plan 1 being applied and verified against Abel's August.

### Activity catalog drives budget

`lib/scope-estimates.ts` already catalogs 28 SEO activities. Each gains a
`countsTowardBudget` default: client-facing delivery work counts, meetings and
internal admin do not. Choosing an activity sets both the description and the
budget flag in one action, with a visible per-entry override.

## Schema (migration 040)

```
time_logs
  activity_key      text        -- from the scope-estimates catalog
  import_fingerprint text       -- CSV identity when entry id is unknown
  submitted_at      timestamptz
  submitted_by      uuid
  reviewed_at       timestamptz
  reviewed_by       uuid
  review_note       text        -- manager's bounce reason

  import_status: add 'needs_context' | 'pending_review', drop 'needs_review'

basecamp_project_roles   (above)
timesheet_import_runs    id, organization_id, requested_by, user_id,
                         from, to, source ('csv'|'upload'|'api'),
                         status, scanned, imported, skipped,
                         started_at, finished_at, error
```

Partial unique index on `import_fingerprint` where not null, mirroring the
existing `basecamp_entry_id` invariant.

All new provenance columns extend the `protect_time_log_import_provenance`
trigger — service-role only, consistent with migrations 031/032/038.

## Authorization

| Action | Who |
|---|---|
| Run a backfill | Manager |
| Edit a `needs_context` row | The owning member, or a manager |
| Submit a batch | The owning member, or a manager |
| Approve / bounce | Manager only |
| Edit a `mapped` row | Existing hardened time-log routes |

A member may never read or edit another member's rows. Enforced server-side;
org-scoped RLS cannot express member-level privacy on its own.

## UI

A new **Imports** tab on `/timesheets`, beside My timesheet / Team / Client
review. Members see their own queue; managers see everyone's.

One dense row per entry:

```
☐  Date   Project → Client   Hours   [Activity ▾]   Detail   [$]   Task   Issues
```

`Detail` is optional free text appended to the activity label; together they
become `time_logs.description`. The activity alone satisfies the `no_activity`
check, so detail is never required.

This tab supersedes the `MappingReviewSheet` shipped with migration 038, which
only resolved identity and was manager-only. The Team tab's attention rail links
here instead of opening that sheet.

- Suggestion chips under a row: to-dos Abel completed in that project that day,
  one tap to accept.
- Selecting rows reveals a bulk bar: set activity / client / budget on all.
- Sticky footer: `12 of 14 ready · Submit for review`.
- Manager view adds Approve and Bounce (with reason) per row, plus
  "Approve all ready".

Backfill is a manager control on the same tab: pick member and date range, watch
the run record report scanned/imported/skipped.

## Interaction with approvals

Importing into an already-approved client month must not silently change the
approved total. It does not: the frozen-snapshot rule from migration 038 means
new rows raise a post-approval-change flag for a manager decision. No new
mechanism required.

## Testing

Pure, `node:test`, no network:

- CSV parsing: quoted fields, embedded commas, empty notes, name resolution
- Fingerprint stability and collision behavior
- Fingerprint adoption: CSV row + later webhook → one row, entry id stamped
- Issue derivation, including `no_task_link` never blocking
- Activity → budget derivation and override
- Submit eligibility and every state transition, including bounce
- Pagination fix: a repeated `Link` URL terminates instead of looping

Route level: role boundaries (member cannot touch another's rows), submit and
approve transitions, backfill authorization.

Migration: additive-only, trigger coverage of new columns, both partial unique
indexes, schema mirror.

## Out of scope

- Importing other providers
- Editing Basecamp from the review screen (one-way in)
- Retroactively re-deriving activities for already-`mapped` rows
- Any change to how approved snapshots are computed
