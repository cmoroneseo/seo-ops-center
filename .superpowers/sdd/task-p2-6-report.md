# Task P2-6 Report: Import review queue UI

## Status

DONE

Commit: `644aa62 feat: add import review queue UI`

## Implemented

- Added an Imports tab for every timesheet member.
- Added a grouped activity picker backed by `TIMESHEET_ACTIVITIES`; choosing an activity sends its budget default in the same edit.
- Added row-level client, activity, budget, optional-detail, task-link advisory, suggestion, selection, and review-note UI.
- Added one-click task suggestions with request deduplication for rows sharing the same organization/client/date context.
- Added explicit ready/attention counts, batch submit, bulk client assignment, clear-selection, and manager approve-all actions.
- Added manager-only pending-review approve/send-back controls. Their visibility comes from the queue API's server-authorized `isManager` value.
- Added manager-only Basecamp backfill controls, including the empty-queue state. The control reuses the shell's organization-member fetch and does not offer a manual CSV upload.
- Kept the server authoritative: every mutation attempt performs one queue reload; failed authoritative reloads discard row-local optimistic drafts and fall back to the last server payload.
- Parallelized independent queue/client reads and bulk row PATCH requests, avoided duplicate organization-member reads, and cleared organization-scoped UI state on organization changes.
- Added accessible labels, focus styles, disabled states, status/error announcements, semantic Tailwind tokens, and amber decision/attention styling.

## TDD evidence

### RED

Command:

```text
node --import tsx --test lib/timesheets/import-review-ui.test.ts
```

After adding minimal component stubs so the test reached behavior assertions, the focused suite failed as expected:

```text
tests 5
pass 0
fail 5
```

The failures were the intended missing behaviors: empty activity-picker markup, no activity budget edit, absent manager review controls, absent empty-queue backfill, and absent bulk/readiness/submit affordances.

### GREEN

Command:

```text
node --import tsx --test lib/timesheets/import-review-ui.test.ts
```

Result:

```text
tests 5
pass 5
fail 0
```

## Final verification

- `npx tsc --noEmit` — exit 0, silent.
- `npx eslint components/timesheets` — exit 0, silent.
- `node --import tsx --test lib/timesheets/import-review-ui.test.ts` — 5/5 passing.
- `npm test` — 657/657 passing, 0 failures.
- `npm run build` — exit 0; production build and static generation completed. The build still prints existing repository-wide warnings outside the changed files.
- `git diff --check` — clean before staging.

## Files changed

- `components/timesheets/ActivityPicker.tsx`
- `components/timesheets/BackfillControl.tsx`
- `components/timesheets/ImportReviewView.tsx`
- `components/timesheets/ImportRow.tsx`
- `components/timesheets/TimesheetsShell.tsx`
- `lib/timesheets/import-review-ui.test.ts`
- `.superpowers/sdd/task-p2-6-report.md`

## Self-review

- Completeness: checked every brief step and all binding UI constraints; no manual upload was added.
- React: independent reads start together, identical suggestion reads share a promise, the shell's member data is reused, callback dependencies are explicit, state updates use functional setters where they depend on prior state, and no component is declared inside another component.
- Recovery: mutation errors reload server state; reload errors reset optimistic row drafts; organization changes remount the queue and clear member options before refetching.
- Accessibility: every interactive control has a visible or accessible label plus focus and disabled states; errors/statuses are announced.
- Scope: no migration or API contract changes were made.

## Concerns

- Migration 041 is not live, so verification intentionally stopped at unit tests, typecheck, lint, and production build; no live import/backfill mutation was attempted.

## Round 1 reliability fix — 2026-08-25

### Status

DONE. Commit subject: `fix: harden import review queue interactions`.

### Findings addressed

- Detail-only and same-activity suggestions now preserve the current explicit budget value. The activity default is applied only when a suggestion actually changes the activity.
- Internal rows are normalized in UI helpers to `clientId: null` and `countsTowardBudget: false`. Bulk client plans omit internal rows and expose exact affected/excluded counts in the selection bar and completion notice.
- Suggestion results are keyed to the current request, so an old client's suggestions disappear synchronously on render. The module cache now deduplicates only active requests and evicts both successful and failed requests when they settle.
- Bulk PATCHes use `Promise.allSettled` through a tested helper. The UI waits for every sibling request, aggregates failures, performs one authoritative reload, and reports partial success without starting recovery early.
- Queue reads use latest-request sequencing, preventing older successes and failures from overwriting newer state. Backfill returns and awaits the queue reload promise, while a shared functional operation counter coordinates backfill and entry mutations without hiding queue content.
- Invalid date ranges now use the destructive semantic text token. Amber remains reserved for human review and attention states.
- No CSV upload, migration, or server contract changes were added.

### Round 1 TDD evidence

Focused RED checkpoint:

```text
node --import tsx --test lib/timesheets/import-review-ui.test.ts
tests 14
pass 13
fail 1
```

The remaining failure was the intentional bulk-selection assertion for exact external affected/internal excluded counts before queue wiring was completed. Earlier helper-first RED runs also failed the newly added budget, internal normalization, cache lifetime, all-settled, and request-order assertions before their implementations were added.

Final focused GREEN:

```text
node --import tsx --test lib/timesheets/import-review-ui.test.ts
tests 16
pass 16
fail 0
duration_ms 386.48
```

The 16 tests execute the edit builders, internal-row normalization, bulk planner, in-flight cache, request-key result filter, all-settled coordinator, latest-request sequencer, tracked async lifecycle, and role/empty/count UI rendering.

### Round 1 final verification

- `npm test` — exit 0; 668 tests, 668 passed, 0 failed, duration 4027.078459 ms.
- `npx tsc --noEmit` — exit 0, silent (rerun after the production build).
- `npm run build` — exit 0; Next.js 15.5.18 compiled successfully in 7.7 s and generated 45/45 static pages. Existing repository-wide warnings remain outside the changed files.
- `npx eslint components/timesheets lib/timesheets/import-review-ui.ts` — exit 0, silent.
- `git diff --check` — exit 0, silent.

### Round 1 files changed

- `components/timesheets/BackfillControl.tsx`
- `components/timesheets/ImportReviewView.tsx`
- `components/timesheets/ImportRow.tsx`
- `lib/timesheets/import-review-ui.ts`
- `lib/timesheets/import-review-ui.test.ts`
- `.superpowers/sdd/task-p2-6-report.md`

### Round 1 concerns

- Migration 041 is still not live. Per the task constraint, no live queue mutation or backfill was attempted; verification is limited to executable tests, typecheck, targeted lint, and production build.
