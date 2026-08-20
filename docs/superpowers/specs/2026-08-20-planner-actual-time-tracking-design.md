# Planner Actual-Time Tracking — Design

**Date:** 2026-08-20  
**Branch:** `feat/planner`  
**Status:** Awaiting written-spec approval

## Purpose

The planner currently uses a scheduled task block for two different ideas: when a
team member intends to work and when the work actually happened. This feature
separates those concepts while making the existing timer accessible directly from
the planner and task details.

A task placed at 10:15 AM is a forecast. It becomes actual time only when the
assignee starts the timer. Pauses do not count toward tracked time. Stopping the
timer finalizes the local time entry and, only after explicit confirmation, may
send the entry to the configured Basecamp timesheet for that client. Stopping time
never completes the task unless the user separately chooses to do so.

## Product decisions

The approved behavior is:

1. A scheduled task block is a forecast until its timer starts.
2. Starting work replaces the visible forecast with actual-time rendering. The
   original forecast is retained in the work history, not duplicated on the grid.
3. Every pause is recorded and excluded from tracked time.
4. Pauses shorter than five minutes are visually merged into one calendar card.
   Pauses of five minutes or longer leave a visible gap and produce separate
   actual-work cards.
5. Only one timer may run for a user at a time. Multiple tasks may remain paused.
6. Starting or resuming a different task requires confirmation and pauses the
   currently running task.
7. Stop opens a review step. Basecamp sync can be selected only in that step.
8. Stop and Complete Task are separate actions. The Stop review may offer an
   unchecked `Mark task complete` option.
9. A confirmed multi-segment work attempt creates one combined time entry per
   local calendar date, not one entry per segment.
10. Basecamp failure never discards confirmed local time. The task shows a retry
    action and the retry is idempotent.
11. Planned-versus-actual variance is not shown in the task UI. The captured plan
    remains available for future reporting.

## Approaches considered

### Mutate one task block

Move the scheduled task to the start time and stretch one card until Stop. This is
simple, but it destroys the forecast and falsely displays paused time as work.

### Render every timer segment

Keep the forecast and render every start/resume interval as a separate card. This
is precise, but short interruptions create distracting calendar fragments.

### Selected: forecast snapshot plus grouped actual segments

Snapshot the forecast when work begins, render actual segments in its place, and
visually merge gaps under five minutes. This preserves accurate time, meaningful
calendar gaps, and a readable day view.

## Core workflow

This workflow applies to task-linked planner cards and task details. Existing
manual logging for meetings and non-task planner events remains unchanged. Existing
global/client timer entry points may reuse the segment persistence layer, but they
do not consume or snapshot a task forecast unless a task is selected.

### Before work starts

The task's current `start_date` and `scheduled_minutes` define its forecast block.
The calendar card exposes Start Timer on hover and keyboard focus. The detail panel
uses Start Timer as a prominent action. On touch layouts, the action is available
inside the detail sheet rather than depending on hover.

### Start

Starting the timer:

1. Confirms a switch if another task is running.
2. Pauses the other task after confirmation.
3. Creates an in-progress time-log attempt for the selected task.
4. Copies the task's forecast start and duration into immutable snapshot fields on
   that attempt.
5. Clears the task's current schedule so unfinished work can be planned again
   after this attempt.
6. Opens the first actual-time segment at the current timestamp.
7. Replaces the forecast card with an active card positioned at the actual start.

If persistence fails, the timer must not appear to start. The forecast stays in
place and the user receives a recoverable error.

### Running

The actual card grows from its recorded start time to the current time. It shows a
running indicator, elapsed active time, and accessible Pause and Stop controls.
The global floating timer mirrors the same state.

### Pause

Pause closes the open segment at the current timestamp. The task moves into the
Paused Work list while retaining its accumulated active time. No Basecamp request
occurs.

If Pause fails to persist, the UI remains running and explains that the pause was
not saved. It must not silently show a paused state that the server cannot recover.

### Resume

Resume creates a new segment. If another timer is running, the user sees:

> Pause “Current task” and resume “Paused task”?

Confirming performs the switch as one server-authorized operation. Cancelling
leaves both timers unchanged.

### Stop and review

Selecting Stop first closes the current segment and holds the attempt in a paused,
reviewing state so review time is not counted. The confirmation sheet contains:

- accumulated active duration, excluding pauses;
- date, description, billable setting, client, and task;
- a session summary;
- `Send to {client}'s Basecamp timesheet`, shown only for a client task;
- the resolved Basecamp destination summary when configured;
- an unchecked `Mark task complete` option; and
- a primary action such as `Confirm 4h time entry`.

Cancelling the sheet returns the attempt to Paused rather than silently restarting
it. The user may resume or stop it later.

Confirming Stop finalizes local time first. If selected and eligible, Basecamp sync
runs second. Completing the task, when explicitly selected, is a separate update
after the time entry is safe. A completion failure does not undo time.

## Calendar behavior

### Forecast and actual rendering

- Before Start: render the task forecast normally.
- After Start: hide that forecast instance and render actual-time cards.
- Preserve the forecast snapshot in task work history.
- Actual cards are read-only timeline evidence; dragging or resizing them must not
  rewrite tracked time.
- If the stopped task remains incomplete, it returns to the backlog and can be
  scheduled again. A new forecast produces a new work attempt and history entry.

### Segment grouping

The database stores every segment. A pure presentation function groups adjacent
segments for the calendar:

- gap `< 5 minutes`: render one continuous card whose label reports active time;
- gap `>= 5 minutes`: render separate cards with an empty calendar gap.

Grouped cards remain linked to the same task and time-log attempt. Their accessible
name includes the task title, actual time range, active duration, and state.

### Example

A task forecast for 10:15 AM–1:00 PM is started immediately, paused at 12:15 PM,
resumed at 1:00 PM, and stopped at 3:00 PM. The calendar displays actual segments
at 10:15 AM–12:15 PM and 1:00 PM–3:00 PM. Stop confirms four hours. The 45-minute
gap is not billed or sent to Basecamp.

## Multiple paused tasks

Each user has at most one open segment but may have multiple paused attempts. The
floating timer contains:

1. the running task, if any;
2. a compact Paused Work section ordered by most recently paused; and
3. Resume and Stop actions for each paused task.

Starting a new client task does not finalize the paused task. For example, a user
can pause Kentina Hospitality, track and stop work for 12 Volt Power, then resume
Kentina. Each attempt retains its own client, task, duration, segments, and
Basecamp eligibility.

The same state must recover after refresh, browser restart, or a second device
sign-in. Server constraints, not browser state alone, enforce one running segment.

## Task-detail UI

The existing task panel gains timer-aware actions:

- Forecast: Start Timer
- Running: elapsed time, Pause, Stop
- Paused: accumulated time, Resume, Stop
- No active attempt: Start Timer and Log time manually

After Stop confirmation, the Time Logged section refreshes immediately. A row
shows the date, team member, total active duration, number and ranges of timer
segments, and Basecamp status:

- `Syncing to Basecamp…`
- `Synced to Basecamp`
- `Basecamp sync failed · Retry`
- no Basecamp badge when sync was not selected

The section shows a task-level total but does not show planned-versus-actual
variance. Manual time entries continue to appear but do not invent start/end
segments and therefore do not create actual-time calendar cards.

## Basecamp behavior

Basecamp is never called during Start, Pause, Resume, or the initial Stop click.
It is called only after the user confirms the Stop sheet and selects sync.

The browser submits only the intent to sync. The server resolves the task's client,
the protected client configuration, the authorized project, the Basecamp person,
and any task recording linkage. Caller-supplied provider IDs never become
authorization inputs.

One local-date total produces one Basecamp timesheet entry. Multiple timer segments
on the same date are aggregated. If an attempt contains work on multiple local
dates, finalization produces one local time-log row and one optional Basecamp entry
per date. The Stop sheet shows this date breakdown before confirmation.

Retry uses the finalized local time-log identifier and existing protected Basecamp
tuple. It must not create a duplicate provider entry if the first request succeeded
but the response was lost.

If Basecamp is unavailable or the client is not configured, local confirmation
remains available. The sync control is disabled with a plain explanation rather
than hiding the reason. A missing Basecamp person mapping is handled the same way:
the local entry can be confirmed, while the sheet explains how to enable sync for
that team member.

## Data model

Implementation uses the next available migration number with the logical name
`planner_time_segments`. If migration 033 is still free, use
`033_planner_time_segments.sql`; otherwise increment without renumbering an
already-applied migration.

### Changes to `time_logs`

Add two immutable forecast snapshot fields and one mutable review-state field:

| column | type | notes |
| --- | --- | --- |
| `planned_starts_at` | timestamptz null | task forecast when this attempt began |
| `planned_minutes` | integer null | forecast duration; positive when present |
| `reviewing_at` | timestamptz null | Stop clicked; attempt is paused for review |

`status = 'in_progress'` continues to represent both running and paused attempts.
An open segment distinguishes Running. An in-progress attempt with no open segment
is Paused or Reviewing. Finalized rows retain `status = 'logged'`.

### New `time_log_segments`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid primary key | generated server-side/database-side |
| `time_log_id` | uuid not null | references `time_logs(id)` on delete cascade |
| `organization_id` | uuid not null | tenant scope, matches parent |
| `user_id` | uuid not null | timer owner, matches parent |
| `started_at` | timestamptz not null | actual start/resume time |
| `ended_at` | timestamptz null | null only for the running segment |
| `created_at` | timestamptz not null | audit timestamp |

Constraints and indexes:

- `ended_at is null or ended_at > started_at`;
- one partial unique index on `(organization_id, user_id)` where `ended_at is null`;
- indexes on `(time_log_id, started_at)` and `(organization_id, user_id, started_at)`;
- a trigger or server transaction verifies segment tenant/user values match the
  parent time log;
- RLS permits organization-scoped reads and owner-only timer writes, while trusted
  server routes retain the access required for finalization and sync.

Existing logged rows require no synthetic segments. Existing in-progress rows are
migrated conservatively: a row with `timer_started_at` gets one open segment from
that timestamp; a paused row remains segmentless until resumed. The migration does
not invent historical start/end times.

The existing elapsed fields remain during rollout for compatibility and recovery.
Segment totals become authoritative for new attempts. For a migrated in-progress
attempt, its pre-migration `elapsed_seconds` is retained as a baseline and only new
segment duration is added to it. Removal of legacy fields is out of scope.

When finalization crosses a local midnight, any segment crossing that boundary is
split at midnight inside the finalization transaction. The original time-log row
retains the first date. Later dates receive new time-log rows, and their segment
pieces are re-parented in the same transaction. The operation either completes as
one unit or leaves the attempt in Reviewing; it cannot publish partial daily logs.

## Service boundaries

Timer persistence should expose operations with explicit contracts rather than
letting UI components coordinate several writes:

- `startAttempt(taskId)` snapshots and consumes the forecast, then opens a segment;
- `pauseAttempt(timeLogId)` closes the caller's open segment;
- `switchAttempt(fromId, toTaskOrAttemptId)` atomically pauses one and starts or
  resumes the other;
- `resumeAttempt(timeLogId)` opens a segment subject to the one-running constraint;
- `beginStopReview(timeLogId)` closes the segment and marks Reviewing;
- `finalizeAttempt(timeLogId, reviewInput)` totals segments, creates per-date logs
  when necessary, optionally completes the task, and requests Basecamp sync;
- `retryBasecamp(timeLogId)` retries only the protected finalized entry.

UI components consume these operations through the timer provider. Calendar cards,
the detail panel, the task panel, and the floating timer do not write timer tables
directly.

## Concurrency and recovery

- Database uniqueness prevents two open segments for one organization/user.
- Switch uses a transaction or server-side RPC so pause and start cannot partially
  succeed.
- Mutations return canonical timer state; the client replaces optimistic state
  with the server response.
- Realtime updates or a lightweight refresh event synchronize open tabs.
- On load, recovery returns all paused attempts plus the one running attempt.
- A stale Start conflict refreshes state and tells the user which timer is already
  running.
- Elapsed time is derived from persisted timestamps, not a browser interval alone.

## Error handling

- Start failure leaves the forecast unchanged.
- Pause failure leaves the timer visibly running.
- Resume/switch conflicts refresh canonical server state.
- Stop-review failure leaves the attempt running unless the server confirms that
  its segment closed.
- Local finalization failure keeps the attempt in Reviewing with a Retry Save
  action.
- Basecamp failure leaves local time logged and exposes Retry Basecamp.
- Task-completion failure leaves time logged and the task incomplete.
- Closing the Stop sheet without confirming leaves the attempt paused.
- Discard remains a separate destructive action with confirmation and never sends
  anything to Basecamp.

## Accessibility and responsive behavior

- Start, Pause, Resume, Stop, Retry, and Complete are real labeled buttons.
- Calendar hover controls also appear on keyboard focus; touch users use the detail
  sheet.
- Running and paused state is communicated through text and icons, not color alone.
- Timer updates use a polite live region at meaningful transitions, not every
  second.
- Focus moves into the Stop sheet and returns to the invoking control on close.
- Switching confirmation names both the task being paused and the task being
  started.
- Minimum interactive target size follows the planner's existing responsive
  accessibility rules.

## Testing

### Pure logic

- active-duration totals exclude pause gaps;
- segment display grouping uses `< 5 minutes` versus `>= 5 minutes` correctly;
- local-date grouping handles same-day and cross-midnight work;
- forecast snapshot stays immutable;
- manual logs produce no calendar segments.

### Persistence and concurrency

- starting snapshots and clears the current forecast atomically;
- only one open segment is allowed per user/organization;
- multiple paused attempts are allowed;
- switch closes one segment and opens the other atomically;
- reload recovery returns one running timer plus all paused timers;
- tenant and owner boundaries reject cross-user/cross-organization writes;
- migration preserves logged and paused legacy rows without invented history.

### UI behavior

- planner card and detail panel expose Start;
- running cards expose Pause and Stop;
- Paused Work can resume and stop any paused attempt;
- Stop and Complete remain independent;
- cancelling Stop leaves the attempt paused;
- confirmed time appears immediately in the task's Time Logged section;
- Basecamp states render Syncing, Synced, Failed, and Retry;
- keyboard, focus restoration, touch detail-sheet, and narrow viewport flows work.

### Basecamp

- no provider request occurs before Stop confirmation;
- same-day segments create one entry with their active-time total;
- cross-date work creates one entry per local date;
- client configuration and authorized project are resolved server-side;
- failed sync preserves local time;
- retry does not duplicate a successful provider entry.

### Verification

Run focused timer, planner, task, Basecamp, authorization, migration, and responsive
tests; full TypeScript checking; targeted lint; and production-like browser checks
for forecast → start → pause → client switch → resume → stop → task-card update.

## Rollout

1. Apply the additive migration before deploying code that writes segments.
2. Deploy compatibility code that can read legacy elapsed fields and new segments.
3. Smoke-test with two configured test clients and one internal task.
4. Confirm local time is safe when Basecamp is unavailable.
5. Confirm a retry cannot duplicate a provider entry.
6. Monitor timer mutation and Basecamp sync errors before considering legacy-field
   cleanup in a separate project.

## Out of scope

- automatic task completion;
- simultaneous running timers;
- planned-versus-actual variance in the task UI;
- editing actual calendar segments by drag/resize;
- retroactively constructing segments for historical time logs;
- deleting legacy timer fields during this rollout;
- manager utilization dashboards or performance scoring.
