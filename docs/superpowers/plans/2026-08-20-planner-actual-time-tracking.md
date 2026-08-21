# Planner Actual-Time Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn scheduled task blocks into honest actual-time sessions with pause/resume switching, Stop-time Basecamp confirmation, immediate task/client updates, and correct SEO-hour accounting.

**Architecture:** Keep `tasks.start_date` and `scheduled_minutes` as the current forecast, snapshot that forecast onto an in-progress `time_logs` attempt, and store actual intervals in a new `time_log_segments` table. Authenticated server operations own atomic timer transitions; pure planner utilities derive duration, date splits, and five-minute display grouping; the timer provider only coordinates canonical server state. Finalization saves local time first, optionally completes the task, correlates client activity for grouped presentation, and then invokes the existing hardened Basecamp route.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript 5, Supabase/Postgres with RLS and authenticated RPCs, Tailwind CSS, Lucide React, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-20-planner-actual-time-tracking-design.md`

## Global Constraints

- A scheduled task block is a forecast until its timer starts.
- Starting work replaces the visible forecast with actual-time rendering while preserving the forecast snapshot in history.
- Every pause is excluded from tracked time; gaps under five minutes merge visually and gaps of five minutes or more remain visible.
- One timer may run per organization/user; multiple attempts may remain paused.
- Stop and Complete Task are separate actions; `Mark task complete` is unchecked by default.
- Basecamp is called only after Stop confirmation and only from protected server-side client/project provenance.
- Local time remains logged if Basecamp or task completion fails.
- Confirmed client-task time counts toward SEO hours by default; completion never adds hours.
- Same-operation time and completion are separate audit effects rendered as one activity-feed item.
- Manual time logs remain supported and do not invent calendar segments.
- Do not renumber migrations 031 or 032. Use migration 033 only if it is still the next available number at implementation time.
- Do not modify or commit the pre-existing untracked `artifacts/` directory.

---

## File Structure

### New files

- `lib/timer/segments.ts` — pure segment totals, local-date splitting, and five-minute display grouping.
- `lib/timer/segments.test.ts` — pure domain tests runnable through `node --test`.
- `lib/timer/contracts.ts` — shared timer attempt/segment DTOs and mutation request/response unions.
- `lib/timer/attempt-route.ts` — authenticated route orchestration with injected persistence/Basecamp dependencies.
- `lib/timer/attempt-route.test.ts` — authorization, mutation ordering, failure, and idempotency tests.
- `app/api/time-tracking/route.ts` — thin authenticated HTTP adapter.
- `lib/planner/actual-items.ts` — converts stored/running segments into read-only planner items.
- `lib/planner/actual-items.test.ts` — calendar normalization and forecast-replacement tests.
- `lib/workspace/activity-grouping.ts` — correlation-aware activity-feed presentation grouping.
- `lib/workspace/activity-grouping.test.ts` — grouped-versus-separate activity tests.
- `migrations/033_planner_time_segments.sql` — additive segment/schema/RPC migration, if 033 remains available.
- `lib/timer/segments-migration.test.ts` — static migration/schema parity and privilege tests.

### Existing files to modify

- `schema.sql` — mirror the additive migration exactly.
- `lib/types.ts` — segment, attempt, operation ID, forecast snapshot, and planner actual-item fields.
- `lib/supabase/time-logs.ts` — read DTOs and call `/api/time-tracking`; retain manual-log APIs.
- `components/providers/timer-provider.tsx` — one running timer plus multiple paused attempts and canonical recovery.
- `components/timer/FloatingTimer.tsx` — running controls and Paused Work list.
- `components/timer/TimerChip.tsx` — compact state for running and paused work.
- `components/timer/StopConfirmSheet.tsx` — begin-review/finalize flow, budget choice, completion choice, and Basecamp eligibility.
- `components/planner/EventCard.tsx` — Start/Pause/Resume/Stop affordances and actual-card styling.
- `components/planner/EventDetailPanel.tsx` — task-aware timer controls and history summary.
- `components/planner/WeekGrid.tsx` and `components/planner/MonthGrid.tsx` — render read-only actual items without drag handles.
- `app/(dashboard)/planner/page.tsx` — load timer attempts/segments and replace consumed forecast instances.
- `components/tasks/TaskDetailModal.tsx` — timer actions and detailed Time Logged rows/status.
- `components/workspace/ActivityFeed.tsx` — render correlation-grouped time/completion activity.
- `app/(dashboard)/workspace/[id]/page.tsx` — refresh activity/hours after finalization.
- `lib/supabase/client-activity.ts` and `app/api/activity/route.ts` — operation ID support for trusted grouped activity.
- `app/api/integrations/basecamp/timesheet/route.ts` — expose an idempotent retry result to finalization without weakening existing authorization.
- Existing timer/planner/Basecamp/security tests — update exact state contracts and preserve current boundaries.

---

### Task 1: Add Pure Segment and Display Logic

**Files:**
- Create: `lib/timer/segments.ts`
- Create: `lib/timer/segments.test.ts`
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: `TimeLogSegment`, `TimerAttempt`, `SegmentSlice`, `DisplaySegmentGroup`.
- Produces: `sumActiveSeconds(segments, now)`, `splitSegmentsByLocalDate(segments)`, and `groupSegmentsForDisplay(segments, thresholdMs)`.
- Consumes: no database or React dependencies.

- [ ] **Step 1: Write failing duration and grouping tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIVE_MINUTES_MS,
  groupSegmentsForDisplay,
  splitSegmentsByLocalDate,
  sumActiveSeconds,
} from './segments.ts';

const segment = (id: string, start: string, end?: string) => ({
  id,
  timeLogId: 'log-1',
  organizationId: 'org-1',
  userId: 'user-1',
  startedAt: start,
  endedAt: end,
});

test('active seconds exclude pause gaps', () => {
  const rows = [
    segment('a', '2026-08-20T17:15:00.000Z', '2026-08-20T19:15:00.000Z'),
    segment('b', '2026-08-20T20:00:00.000Z', '2026-08-20T22:00:00.000Z'),
  ];
  assert.equal(sumActiveSeconds(rows, new Date('2026-08-20T22:00:00.000Z')), 14_400);
});

test('gaps below five minutes merge but five minutes stays split', () => {
  const shortGap = [
    segment('a', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'),
    segment('b', '2026-08-20T18:04:59.000Z', '2026-08-20T19:00:00.000Z'),
  ];
  const exactGap = [
    segment('a', '2026-08-20T17:00:00.000Z', '2026-08-20T18:00:00.000Z'),
    segment('b', '2026-08-20T18:05:00.000Z', '2026-08-20T19:00:00.000Z'),
  ];
  assert.equal(groupSegmentsForDisplay(shortGap, FIVE_MINUTES_MS).length, 1);
  assert.equal(groupSegmentsForDisplay(exactGap, FIVE_MINUTES_MS).length, 2);
});

test('a segment crossing local midnight is split into date slices', () => {
  const slices = splitSegmentsByLocalDate([
    segment('a', '2026-08-21T06:30:00.000Z', '2026-08-21T07:30:00.000Z'),
  ], 'America/Los_Angeles');
  assert.deepEqual(slices.map(s => [s.localDate, s.activeSeconds]), [
    ['2026-08-20', 1_800],
    ['2026-08-21', 1_800],
  ]);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test lib/timer/segments.test.ts`

Expected: FAIL because `lib/timer/segments.ts` does not exist.

- [ ] **Step 3: Define the exact domain types**

Add to `lib/types.ts`:

```ts
export interface TimeLogSegment {
  id: string;
  timeLogId: string;
  organizationId: string;
  userId: string;
  startedAt: string;
  endedAt?: string;
}

export interface TimerAttempt extends TimeLog {
  plannedStartsAt?: string;
  plannedMinutes?: number;
  reviewingAt?: string;
  operationId?: string;
  segments: TimeLogSegment[];
}
```

Extend `TimeLog` with optional `operationId`, `plannedStartsAt`, `plannedMinutes`, and `reviewingAt` fields.

- [ ] **Step 4: Implement the pure functions**

`lib/timer/segments.ts` must export:

```ts
export const FIVE_MINUTES_MS = 5 * 60_000;

export function sumActiveSeconds(segments: TimeLogSegment[], now = new Date()): number;

export function groupSegmentsForDisplay(
  segments: TimeLogSegment[],
  thresholdMs = FIVE_MINUTES_MS,
  now = new Date(),
): DisplaySegmentGroup[];

export function splitSegmentsByLocalDate(
  segments: TimeLogSegment[],
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  now = new Date(),
): SegmentDateSlice[];
```

Sort without mutating input. Treat an open segment's end as `now`. Reject invalid/negative intervals. A display group's `activeSeconds` is the sum of its members, while its `startsAt`/`endsAt` span the rendered card.

- [ ] **Step 5: Run the focused tests and typecheck**

Run: `node --test lib/timer/segments.test.ts && npm run typecheck`

Expected: all segment tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the pure domain layer**

```bash
git add lib/types.ts lib/timer/segments.ts lib/timer/segments.test.ts
git commit -m "feat: model planner timer segments"
```

---

### Task 2: Add the Additive Segment Migration and Database Invariants

**Files:**
- Create: `migrations/033_planner_time_segments.sql` (or next free number)
- Create: `lib/timer/segments-migration.test.ts`
- Modify: `schema.sql`

**Interfaces:**
- Produces: `public.time_log_segments`, forecast/review/operation columns on `public.time_logs`, and `operation_id` on `public.client_activity_log`.
- Produces: authenticated RPCs `start_task_timer`, `pause_time_attempt`, `resume_time_attempt`, `switch_time_attempt`, `begin_stop_review`, and `finalize_time_attempt`.
- Enforces: one open segment per organization/user and ownership/tenant matching.

- [ ] **Step 1: Write a static RED test for required SQL constructs**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../migrations/033_planner_time_segments.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');

test('segment migration is additive, tenant-scoped, and mirrored', () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /create table(?: if not exists)? public\.time_log_segments/i);
    assert.match(sql, /where ended_at is null/i);
    assert.match(sql, /alter table public\.time_log_segments enable row level security/i);
    assert.match(sql, /planned_starts_at/i);
    assert.match(sql, /operation_id/i);
    assert.match(sql, /alter table public\.client_activity_log[\s\S]+operation_id/i);
  }
  assert.doesNotMatch(migration, /drop table|drop column/i);
});

test('timer RPC execution is not granted to anon', () => {
  assert.match(migration, /revoke execute on function public\.start_task_timer[^;]+ from public, anon/i);
  assert.match(migration, /grant execute on function public\.start_task_timer[^;]+ to authenticated/i);
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `node --test lib/timer/segments-migration.test.ts`

Expected: FAIL because the migration is absent.

- [ ] **Step 3: Write the additive table and column SQL**

The migration must add:

```sql
alter table public.time_logs
  add column if not exists planned_starts_at timestamptz,
  add column if not exists planned_minutes integer,
  add column if not exists reviewing_at timestamptz,
  add column if not exists operation_id uuid;

alter table public.time_logs
  drop constraint if exists time_logs_planned_minutes_positive;
alter table public.time_logs
  add constraint time_logs_planned_minutes_positive
  check (planned_minutes is null or planned_minutes > 0);

alter table public.client_activity_log
  add column if not exists operation_id uuid;

create index if not exists client_activity_log_operation_idx
  on public.client_activity_log (client_id, operation_id)
  where operation_id is not null;

create table if not exists public.time_log_segments (
  id uuid primary key default uuid_generate_v4(),
  time_log_id uuid not null references public.time_logs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint time_log_segments_positive check (ended_at is null or ended_at > started_at)
);

create unique index if not exists one_open_time_segment_per_user
  on public.time_log_segments (organization_id, user_id)
  where ended_at is null;
```

Add the two supporting indexes, RLS, org-member read policy, owner-only insert/update/delete policies, and a trigger that rejects segment organization/user values that differ from the parent log.

- [ ] **Step 4: Add atomic authenticated RPCs**

Each RPC must be `security definer`, set `search_path = public`, derive the actor with `auth.uid()`, verify the caller's organization membership and task/log ownership, and return canonical affected rows. `start_task_timer` must copy and clear the task forecast in the same transaction. `switch_time_attempt` must close the current open segment before opening the target segment. Do not accept organization, user, client, or provider IDs as trusted authorization inputs.

After creating each function:

```sql
revoke execute on function public.start_task_timer(uuid, timestamptz) from public, anon;
grant execute on function public.start_task_timer(uuid, timestamptz) to authenticated;
```

Repeat with the exact signatures for pause, resume, switch, begin-review, and finalize. `finalize_time_attempt` accepts the owned attempt ID, description, billable flag, budget flag, time zone, operation UUID, and finalization timestamp; it splits segments at local-midnight boundaries and returns the finalized daily log IDs plus trusted task/client IDs. It does not complete the task or call Basecamp. Do not grant direct execution of the segment-protection trigger function.

- [ ] **Step 5: Add conservative legacy migration logic**

Insert one open segment only for `status = 'in_progress' and timer_started_at is not null`, preserving `elapsed_seconds` as the legacy baseline. Do not fabricate closed segments for paused or logged rows. Make the insert idempotent with `not exists` against `time_log_segments.time_log_id`.

- [ ] **Step 6: Mirror the migration into `schema.sql`**

Copy the final table, indexes, policies, trigger, columns, and functions verbatim into the migration mirror section. Ensure the base `time_logs` definition also documents the four new columns.

- [ ] **Step 7: Run migration, schema, and security tests**

Run:

```bash
node --test lib/timer/segments-migration.test.ts lib/basecamp/authorization-migration.test.ts
npm run security:static
npm run typecheck
```

Expected: tests PASS, static review exits 0/advisory, typecheck exits 0.

- [ ] **Step 8: Commit the database contract**

```bash
git add migrations/033_planner_time_segments.sql schema.sql lib/timer/segments-migration.test.ts
git commit -m "feat: add planner timer segment persistence"
```

---

### Task 3: Add Authenticated Timer Attempt Operations

**Files:**
- Create: `lib/timer/contracts.ts`
- Create: `lib/timer/attempt-route.ts`
- Create: `lib/timer/attempt-route.test.ts`
- Create: `app/api/time-tracking/route.ts`
- Modify: `lib/supabase/time-logs.ts`

**Interfaces:**
- Produces: `POST /api/time-tracking` with discriminated actions `start`, `pause`, `resume`, `switch`, `begin_stop`, `finalize`, `discard`, and `retry_basecamp`.
- Produces: `getOpenTimerAttempts(organizationId)` for canonical recovery.
- Consumes: authenticated Supabase user, RPCs from Task 2, pure date totals from Task 1, and existing protected Basecamp timesheet route behavior.

- [ ] **Step 1: Define request and response unions**

```ts
export type TimerMutationRequest =
  | { action: 'start'; taskId: string; now?: string }
  | { action: 'pause'; timeLogId: string; now?: string }
  | { action: 'resume'; timeLogId: string; now?: string }
  | { action: 'switch'; fromTimeLogId: string; toTimeLogId?: string; toTaskId?: string; now?: string }
  | { action: 'begin_stop'; timeLogId: string; now?: string }
  | { action: 'finalize'; timeLogId: string; description: string; billable: boolean; countsTowardBudget: boolean; syncToBasecamp: boolean; markTaskComplete: boolean; timeZone: string }
  | { action: 'discard'; timeLogId: string }
  | { action: 'retry_basecamp'; timeLogId: string };

export interface TimerStateResponse {
  running: TimerAttempt | null;
  paused: TimerAttempt[];
  finalizedTimeLogIds?: string[];
  completionWarning?: string;
  basecampStatus?: 'not_requested' | 'syncing' | 'synced' | 'failed';
}
```

Validate that `switch` has exactly one of `toTimeLogId` and `toTaskId`.

- [ ] **Step 2: Write route RED tests with injected dependencies**

Cover: 401 without user; malformed JSON; cross-tenant log returns 403; Start trusts the task's client/organization rather than body IDs; switch orders pause before resume atomically; finalize saves local totals before Basecamp; completion failure returns a warning without rolling back time; Basecamp failure returns `failed` with finalized IDs; retry accepts only a finalized owned log.

Use a dependency shape:

```ts
export interface AttemptRouteDeps {
  getUser(): Promise<{ id: string } | null>;
  mutateRpc(name: string, args: Record<string, unknown>): Promise<unknown>;
  loadAttempts(userId: string): Promise<TimerStateResponse>;
  finalizeOwnedAttempt(input: FinalizeAttemptInput): Promise<FinalizeResult>;
  syncBasecamp(timeLogId: string, createIfMissing: boolean): Promise<{ ok: boolean; error?: string }>;
}
```

- [ ] **Step 3: Run the route test and verify RED**

Run: `node --test lib/timer/attempt-route.test.ts`

Expected: FAIL because the handler is not implemented.

- [ ] **Step 4: Implement the pure route handler**

Export `handleTimerMutation(request, deps): Promise<Response>`. Parse JSON once, reject unknown fields/actions, derive the user via `deps.getUser`, map start/pause/resume/switch/begin-stop to the exact RPC, and return canonical state after each mutation.

For `finalize`, generate one `operationId = crypto.randomUUID()`, call the transactional `finalize_time_attempt` RPC with the review input, and emit completion using the same operation ID only after local time is safe. Start Basecamp sync last.

- [ ] **Step 5: Implement the thin Next route**

`app/api/time-tracking/route.ts` must construct the authenticated server client from cookies, use `getUser()`, and inject concrete dependencies into `handleTimerMutation`. Malformed JSON returns 400; missing auth returns 401; inaccessible resources return 403; uniqueness conflicts return 409.

- [ ] **Step 6: Replace direct browser timer writes with API wrappers**

Keep `createTimeLog`, `updateTimeLog`, manual logging, reads, and deletion compatibility in `lib/supabase/time-logs.ts`. Replace `startTimer`, `pauseTimer`, `resumeTimer`, `stopTimer`, and singular `getInProgressTimer` usage with:

```ts
export async function mutateTimer(request: TimerMutationRequest): Promise<TimerStateResponse>;
export async function getOpenTimerAttempts(organizationId: string): Promise<TimerStateResponse>;
```

Map segment rows and new columns in `rowToTimeLog` without exposing database snake_case to UI code.

- [ ] **Step 7: Run focused tests, typecheck, and security checks**

Run:

```bash
node --test lib/timer/attempt-route.test.ts lib/timer/segments.test.ts
npm run typecheck
npm run security:static
```

Expected: all focused tests PASS; typecheck and security scan exit 0/advisory.

- [ ] **Step 8: Commit the authenticated operation layer**

```bash
git add app/api/time-tracking/route.ts lib/timer/contracts.ts lib/timer/attempt-route.ts lib/timer/attempt-route.test.ts lib/supabase/time-logs.ts
git commit -m "feat: add atomic timer attempt operations"
```

---

### Task 4: Support One Running Timer and Multiple Paused Attempts in React

**Files:**
- Modify: `components/providers/timer-provider.tsx`
- Modify: `components/timer/FloatingTimer.tsx`
- Modify: `components/timer/TimerChip.tsx`
- Modify: `components/timer/QuickStartPopover.tsx`
- Modify: `lib/timer-ui.test.ts`

**Interfaces:**
- Consumes: `mutateTimer` and `getOpenTimerAttempts` from Task 3.
- Produces: `runningTimer`, `pausedTimers`, `startTask`, `pause`, `resume`, `switchToTask`, `beginStop`, `finalize`, and `discard` through `useTimer()`.
- Emits: `planner:data-changed`, `timer:data-changed`, and `client-activity:data-changed` after canonical mutations.

- [ ] **Step 1: Write RED provider/UI contract tests**

Extend `lib/timer-ui.test.ts` to assert that provider state includes one running attempt plus a paused array, Starting while running opens switch confirmation, Resume calls the switch action when necessary, recovery loads all attempts, and FloatingTimer renders a Paused Work section with Resume and Stop controls.

Add a pure helper test for:

```ts
export function timerSwitchPrompt(from: TimerAttempt, toTitle: string): string {
  return `Pause “${from.taskTitle ?? from.clientName}” and start “${toTitle}”?`;
}
```

- [ ] **Step 2: Run the timer UI test and verify RED**

Run: `node --test lib/timer-ui.test.ts`

Expected: FAIL because the provider still exposes a single `timer`.

- [ ] **Step 3: Refactor provider state around canonical server responses**

Retain `timer` as a temporary alias of `runningTimer ?? mostRecentPaused` only while updating callers, then remove it in the same task. Do not calculate persisted elapsed seconds from client state. Tick only the displayed running segment; refresh from timestamps after each mutation and on visibility changes.

Starting/resuming while another attempt runs opens a confirmation callback; only confirmation calls `switch`. A rejected switch leaves both states unchanged.

- [ ] **Step 4: Render Paused Work in the floating timer**

Show the running attempt first and paused attempts ordered by most recently closed segment. Each row shows client, task, accumulated active duration, Resume, and Stop. Keep the existing quick-start shortcut and notes behavior scoped to the selected attempt.

- [ ] **Step 5: Add cross-tab refresh and recovery**

On `timer:data-changed`, `storage`/BroadcastChannel notification, window focus, and initial organization load, call `getOpenTimerAttempts`. Do not inspect or store auth secrets in local storage. Recovery must never ask the user to discard all paused work just because one running timer was found.

- [ ] **Step 6: Run timer, planner refresh, and type tests**

Run:

```bash
node --test lib/timer-ui.test.ts lib/planner/timer-sync.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit multi-attempt UI state**

```bash
git add components/providers/timer-provider.tsx components/timer/FloatingTimer.tsx components/timer/TimerChip.tsx components/timer/QuickStartPopover.tsx lib/timer-ui.test.ts
git commit -m "feat: support paused timer work queues"
```

---

### Task 5: Render Actual Work and Timer Controls in the Planner

**Files:**
- Create: `lib/planner/actual-items.ts`
- Create: `lib/planner/actual-items.test.ts`
- Modify: `lib/planner/items.ts`
- Modify: `components/planner/EventCard.tsx`
- Modify: `components/planner/EventDetailPanel.tsx`
- Modify: `components/planner/WeekGrid.tsx`
- Modify: `components/planner/MonthGrid.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`
- Modify: `lib/planner/items.test.ts`
- Modify: `lib/planner/responsive.test.ts`

**Interfaces:**
- Consumes: `TimerAttempt[]`, `groupSegmentsForDisplay`, and timer provider actions.
- Produces: planner source `actual_time` with `draggable: false` and `attemptId`.
- Preserves: event, reminder, overdue, and forecast drag behavior.

- [ ] **Step 1: Write RED actual-item normalization tests**

Test that a forecast task renders before Start, the same task forecast is omitted when an in-progress/logged attempt has a forecast snapshot for that instance, a 45-minute pause creates two cards, a four-minute pause creates one card, running cards end at injected `now`, and actual cards are never draggable.

Use an explicit interface:

```ts
export function actualAttemptToItems(attempt: TimerAttempt, now: Date): PlannerItem[];
export function shouldRenderForecast(task: Task, attempts: TimerAttempt[]): boolean;
```

- [ ] **Step 2: Run planner item tests and verify RED**

Run: `node --test lib/planner/actual-items.test.ts lib/planner/items.test.ts`

Expected: FAIL because `actual_time` is not a source.

- [ ] **Step 3: Extend planner item types and pure conversion**

Add `actual_time` to `PlannerItemSource`; permit `raw: TimerAttempt`; add optional `attemptId`, `activeSeconds`, and `timerState`. `plannerSourceLabel` returns `Actual work`. `plannerTimeLabel` uses actual ranges and active duration.

- [ ] **Step 4: Load and combine actual attempts in the planner page**

Fetch attempts/segments for the visible range and current organization. Exclude only the consumed forecast instance; do not hide a newly scheduled future forecast for an unfinished task. On `timer:data-changed`, reload attempts and tasks together to avoid duplicate or missing cards.

- [ ] **Step 5: Add task timer actions to cards and detail panel**

- Forecast card hover/focus: Start Timer.
- Running actual card: Pause and Stop.
- Paused actual card: Resume and Stop.
- Touch/narrow layout: actions live in the existing detail sheet.

If Start/Resume would switch work, use the provider confirmation. Buttons must stop propagation so they do not start drag/select gestures accidentally.

- [ ] **Step 6: Make actual cards read-only and accessible**

Week/Month grids render no move/resize handles for `actual_time`. Include textual Running/Paused state, not color alone. Add a polite live announcement only for Start, Pause, Resume, Stop, and failure transitions.

- [ ] **Step 7: Run planner logic, accessibility, and type tests**

Run:

```bash
node --test lib/planner/actual-items.test.ts lib/planner/items.test.ts lib/planner/responsive.test.ts lib/planner/layout.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit actual-time planner rendering**

```bash
git add app/'(dashboard)'/planner/page.tsx components/planner/EventCard.tsx components/planner/EventDetailPanel.tsx components/planner/WeekGrid.tsx components/planner/MonthGrid.tsx lib/planner/actual-items.ts lib/planner/actual-items.test.ts lib/planner/items.ts lib/planner/items.test.ts lib/planner/responsive.test.ts
git commit -m "feat: show actual task work in planner"
```

---

### Task 6: Finalize Time, SEO Hours, Completion, and Basecamp at Stop

**Files:**
- Modify: `components/timer/StopConfirmSheet.tsx`
- Modify: `components/providers/timer-provider.tsx`
- Modify: `lib/timer/attempt-route.ts`
- Modify: `lib/timer/attempt-route.test.ts`
- Modify: `app/api/integrations/basecamp/timesheet/route.ts`
- Modify: `lib/basecamp/timesheet-post-route.ts`
- Modify: `lib/basecamp/timesheet-post-route.test.ts`
- Modify: `lib/basecamp-timesheet-route.test.ts`

**Interfaces:**
- Consumes: `begin_stop` and `finalize` from Task 3.
- Produces: finalized daily log IDs, completion warning, and Basecamp state.
- Preserves: server-resolved protected client/project/recording authorization.

- [ ] **Step 1: Write RED Stop-review and finalization tests**

Cover: Stop closes the current segment before review; Cancel leaves Paused; client task defaults `countsTowardBudget` true; explicit non-budget override persists false; Mark Complete defaults false; finalization aggregates same-date segments; cross-date segments produce one row per date; no Basecamp call when toggle is off; Basecamp call occurs after local save; missing config/person mapping disables sync without blocking local save; completion failure returns warning; retry is idempotent.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test lib/timer/attempt-route.test.ts lib/basecamp/timesheet-post-route.test.ts lib/basecamp-timesheet-route.test.ts
```

Expected: new cases FAIL.

- [ ] **Step 3: Update StopConfirmSheet review fields**

Show total active duration and segment/date summary from canonical state. Add labeled controls for Billable, Counts toward SEO hours, Send to Basecamp, and Mark task complete. Default SEO hours true for client task work and false only for explicitly internal/non-budget work. Default completion false.

Stop invokes `begin_stop` before opening the editable review. Closing the sheet does not resume. Submit invokes `finalize` once and disables repeated submission.

- [ ] **Step 4: Finalize daily logs and operation correlation transactionally**

Inside the server finalization dependency, split midnight-crossing segments, retain the first local date on the original log, create additional date rows as necessary, assign one `operation_id`, calculate hours from active seconds, and set `status = 'logged'`, description, billable, budget flag, and date. Return all finalized IDs only after the local transaction succeeds.

- [ ] **Step 5: Apply optional completion without double-counting**

When requested, update the task to `done` with `completed_at` and emit `task.completed` with the same operation ID. Do not create/update time rows from completion code. If task update fails, return `completionWarning` and retain logged time.

- [ ] **Step 6: Integrate protected Basecamp sync last**

For every finalized date row, call the existing timesheet handler with `{ action: 'sync', timeLogId, createIfMissing: true }`. The handler must continue resolving organization membership, client config, project, task recording, and person mapping server-side. Return/persist Syncing, Synced, or Failed. Retry must inspect protected entry provenance before deciding create versus update and must never accept caller provider IDs.

- [ ] **Step 7: Dispatch refresh events after local success**

Dispatch `planner:data-changed`, `timer:data-changed`, `task:data-changed`, and `client-activity:data-changed` after local finalization. Basecamp status may update later without delaying the local UI.

- [ ] **Step 8: Run finalization, Basecamp, security, and type tests**

Run:

```bash
node --test lib/timer/attempt-route.test.ts lib/basecamp/timesheet-post-route.test.ts lib/basecamp-timesheet-route.test.ts
npm run security:static
npm run typecheck
```

Expected: PASS; security scan exits 0/advisory.

- [ ] **Step 9: Commit Stop-time orchestration**

```bash
git add components/timer/StopConfirmSheet.tsx components/providers/timer-provider.tsx lib/timer/attempt-route.ts lib/timer/attempt-route.test.ts app/api/integrations/basecamp/timesheet/route.ts lib/basecamp/timesheet-post-route.ts lib/basecamp/timesheet-post-route.test.ts lib/basecamp-timesheet-route.test.ts
git commit -m "feat: finalize tracked work at stop"
```

---

### Task 7: Update Task Time History and Group Client Activity

**Files:**
- Create: `lib/workspace/activity-grouping.ts`
- Create: `lib/workspace/activity-grouping.test.ts`
- Modify: `lib/types.ts`
- Modify: `lib/supabase/client-activity.ts`
- Modify: `app/api/activity/route.ts`
- Modify: `components/tasks/TaskDetailModal.tsx`
- Modify: `components/workspace/ActivityFeed.tsx`
- Modify: `app/(dashboard)/workspace/[id]/page.tsx`

**Interfaces:**
- Consumes: finalized logs/segments and shared `operationId` from Task 6.
- Produces: `groupClientActivity(items): ActivityPresentationItem[]`.
- Preserves: separate time-log and task-completion audit rows.

- [ ] **Step 1: Write RED activity grouping tests**

```ts
test('same-operation completion and time render as one item', () => {
  const grouped = groupClientActivity([
    timeItem({ operationId: 'op-1', hours: 4 }),
    taskEvent({ operationId: 'op-1', eventType: 'task.completed' }),
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].kind, 'time_and_completion');
});

test('later completion remains separate and hours are not duplicated', () => {
  const grouped = groupClientActivity([
    timeItem({ operationId: 'op-1', hours: 4 }),
    taskEvent({ operationId: 'op-2', eventType: 'task.completed' }),
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped.filter(i => i.hours === 4).length, 1);
});
```

Also test Basecamp status remains metadata on the grouped time item, not a third activity item.

- [ ] **Step 2: Run the activity test and verify RED**

Run: `node --test lib/workspace/activity-grouping.test.ts`

Expected: FAIL because grouping does not exist.

- [ ] **Step 3: Carry operation IDs through activity DTOs**

Add optional `operationId` to `ClientActivityEvent` and `TimeLog`. `logClientActivity` accepts it and stores it in the dedicated nullable `client_activity_log.operation_id` column from Task 2. Map that column in `rowToEvent`; do not duplicate the correlation ID inside metadata.

The browser `/api/activity` route must not accept arbitrary operation IDs for unrelated events. The trusted Stop finalization path supplies the server-generated correlation ID.

- [ ] **Step 4: Implement pure presentation grouping**

Group only a time log and `task.completed` event with the same non-null operation ID, task ID, client ID, and actor ID. Never group by timestamp proximity or title. Sort grouped items by the latest underlying occurrence and keep both source IDs for audit/drill-down.

- [ ] **Step 5: Render task Time Logged details**

Replace the total-only block in `TaskDetailModal` with total plus recent rows containing date, team member, active duration, session count/ranges, and Basecamp state. Add Retry Basecamp only for a failed finalized row. Keep Log time manually.

- [ ] **Step 6: Render grouped client activity without clutter**

Call `groupClientActivity` before date grouping/filter counts. Render:

```text
Carlos completed “Set up event tracking” and logged 4h
Synced to Basecamp
```

When operation IDs differ, preserve separate `4h logged` and `completed task` rows. Count a grouped item once in All, while the Hours and Tasks filters may both include it without duplicating the total-hours calculation.

- [ ] **Step 7: Refresh client hours and activity immediately**

Listen for `client-activity:data-changed` in the workspace page and increment the existing `activityRefreshKey`. Re-fetch time logs used by Monthly Planner/SEO-hour summaries after confirmed local time. Hours must sum only `countsTowardBudget` rows, as current helpers already do.

- [ ] **Step 8: Run activity, budget, task, and type tests**

Run:

```bash
node --test lib/workspace/activity-grouping.test.ts lib/time-budget-logic.test.ts lib/timer-ui.test.ts
npm run typecheck
```

Expected: PASS and the four-hour example contributes exactly four hours.

- [ ] **Step 9: Commit task/client presentation updates**

```bash
git add lib/workspace/activity-grouping.ts lib/workspace/activity-grouping.test.ts lib/types.ts lib/supabase/client-activity.ts app/api/activity/route.ts components/tasks/TaskDetailModal.tsx components/workspace/ActivityFeed.tsx app/'(dashboard)'/workspace/'[id]'/page.tsx
git commit -m "feat: surface tracked task work in client activity"
```

---

### Task 8: Complete Regression, Security, and Browser Verification

**Files:**
- Modify: `task-6-security-fix-report.md` only if a new protected-route invariant needs documentation
- Modify: relevant test files only for verified integration gaps

**Interfaces:**
- Consumes: all prior tasks.
- Produces: review-ready branch and migration/deployment handoff.

- [ ] **Step 1: Run all focused planner/timer/activity tests**

Run:

```bash
node --test \
  lib/timer/*.test.ts \
  lib/planner/*.test.ts \
  lib/workspace/*.test.ts \
  lib/timer-ui.test.ts \
  lib/time-budget-logic.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run all Basecamp and authorization regressions**

Run:

```bash
node --test \
  lib/basecamp/*.test.ts \
  lib/basecamp-timesheet-route.test.ts \
  lib/security/*.test.ts
```

Expected: PASS with no caller-controlled project, recording, person, organization, or client authority.

- [ ] **Step 3: Run static project verification**

Run:

```bash
npm run typecheck
npx eslint \
  app/api/time-tracking/route.ts \
  components/providers/timer-provider.tsx \
  components/timer \
  components/planner \
  components/tasks/TaskDetailModal.tsx \
  components/workspace/ActivityFeed.tsx \
  lib/timer \
  lib/planner \
  lib/workspace
npm run security:static
git diff --check
```

Expected: typecheck 0, lint 0 errors, security 0/advisory, diff check 0.

- [ ] **Step 4: Apply the migration to a non-production database and test invariants**

Verify: only one open segment per user/org; multiple paused attempts; cross-user and cross-tenant segment writes rejected; legacy logged rows unchanged; legacy running row recoverable; all new RPCs reject unauthenticated callers.

- [ ] **Step 5: Run the production-like browser scenario**

Using two configured test clients:

1. Schedule Client A task for 10:15.
2. Start at actual time and confirm forecast disappears.
3. Work, Pause, and verify the card stops growing.
4. Start Client B after confirming the switch.
5. Stop Client B, confirm SEO hours and optional Basecamp sync, leave incomplete.
6. Resume Client A after a gap over five minutes.
7. Stop Client A with Mark Complete selected.
8. Verify two actual Client A segments, one combined local time total, one grouped activity item, one SEO-hour contribution, one task completion, and correct Basecamp entries.
9. Force one Basecamp failure and verify local time remains, Failed appears, and Retry creates no duplicate.
10. Refresh/reopen and confirm running/paused recovery.

- [ ] **Step 6: Review the complete diff for migration and security scope**

Run:

```bash
git diff --stat 8779cf4..HEAD
git diff --check 8779cf4..HEAD
git status --short
```

Confirm `artifacts/` remains untracked/excluded and no environment/token files are staged.

- [ ] **Step 7: Handle any verification failure as a new scoped RED/GREEN step**

If verification exposes a defect, stop, add a named failing regression test to the task that owns the behavior, implement the minimal fix, rerun that task's checks plus Steps 1–3 above, and commit only the explicitly named test and implementation files. If no defect is found, create no cleanup commit.

---

## Deployment Handoff

1. Apply the additive planner-time-segments migration before deploying the code.
2. Deploy the verified commit to Preview first.
3. Repeat the two-client browser smoke test in Preview.
4. Deploy to Production only after Preview passes.
5. Confirm the live Basecamp project catalog and timesheet destination resolve.
6. Scan Vercel error logs after the first real Stop confirmation.
7. Keep rollback limited to application code; do not drop the additive segment table during rollback.
