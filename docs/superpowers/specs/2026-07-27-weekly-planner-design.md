# Weekly Calendar & Task Planner — Design

**Date:** 2026-07-27
**Branch:** `feat/planner`
**Status:** Approved

## Purpose

A ClickUp Planner–style weekly time-grid at `/planner`. Today the app can tell you
*what* work exists (Tasks, Deliverables) but not *when* it happens. The planner adds
the missing time dimension: a week grid where meetings, focus blocks, and scheduled
tasks live side by side, and where unscheduled work can be dragged onto a time slot.

## Scope

In scope: week/day/month views, all-day row, live now-line, event cards colored by
kind, drag-to-move, drag-to-resize, drag backlog task → grid, click-drag empty slot →
quick create, event detail panel, reorderable Priorities list, "Meet with" teammate
filter, floating command bar.

Out of scope (deliberate): recurring calendar events (`personal_reminders` already
covers repeats), multi-timezone conversion, Google Calendar sync.

---

## Data model — migration 026

### `planner_events`

The calendar layer the app does not have yet.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `organization_id` | uuid not null → organizations | |
| `user_id` | uuid not null → users | owner |
| `title` | text not null | |
| `description` | text | |
| `kind` | text not null default `'event'` | check in `meeting, focus, ooo, lunch, event` — drives card color |
| `starts_at` | timestamptz not null | |
| `ends_at` | timestamptz not null | |
| `all_day` | boolean not null default false | renders in the all-day row |
| `location` | text | |
| `client_id` | uuid → clients on delete set null | |
| `task_id` | uuid → tasks on delete set null | links a time block to real work |
| `attendee_ids` | uuid[] default `'{}'` | powers the "Meet with" filter |
| `busy` | boolean not null default true | |
| `visibility` | text default `'default'` | check in `default, private` |
| `created_at` / `updated_at` | timestamptz | |

Constraint: `ends_at > starts_at`.

Indexes:
- `(organization_id, starts_at)` — the week-range query
- `(user_id, starts_at)` — "my events"
- GIN on `attendee_ids` — teammate filter

RLS — this table is **not** strictly personal, unlike `personal_notes` and
`personal_reminders`:

- **read:** `organization_id in (select get_user_org_ids())` AND
  (`visibility = 'default'` OR `user_id = auth.uid()`).
  Org-visible reads are what make the "Meet with <teammate>" filter possible.
- **write (insert/update/delete):** `user_id = auth.uid()` AND org check.

### `planner_priorities`

The reorderable Priorities list in the left rail.

| column | type | notes |
| --- | --- | --- |
| `id` | uuid pk | |
| `organization_id` | uuid not null | |
| `user_id` | uuid not null | |
| `task_id` | uuid → tasks on delete cascade | nullable |
| `label` | text | used when `task_id` is null |
| `sort_order` | integer not null default 0 | |
| `created_at` | timestamptz | |

Constraint: `task_id is not null or label is not null` — a priority is either a
pinned real task or free text ("Marathon Finishing System").

RLS: strictly personal — `user_id = auth.uid()` and org check, matching the
`personal_reminders` policy.

### Sources overlaid on the grid

The grid renders three record types, not one:

1. `planner_events` → time-blocked cards, colored by `kind`
2. `tasks` with a `startDate` → cards sized by `estimatedHours` (default 1h).
   Tasks **without** `startDate` are the sidebar Backlog.
3. `personal_reminders` → chips in the all-day row on their due date

Dragging a backlog task onto the grid writes `tasks.startDate` (and
`estimatedHours` if absent). It does **not** create a `planner_events` row — no
duplicate record, no sync problem.

---

## Architecture

### Route

`app/(dashboard)/planner/page.tsx`. New `Sidebar.tsx` nav entry (`CalendarRange`
icon) between Tasks and Deliverables. The planner is excluded from
`showProjectSidebar` in `app/(dashboard)/layout.tsx` — it has its own left rail and
must not render `ClientListPanel` alongside it.

### Component tree

```
app/(dashboard)/planner/page.tsx     data fetching, week state, selection state
components/planner/
  PlannerSidebar.tsx                 left rail shell
    PrioritiesList.tsx               reorderable, drag to sort
    MeetWithFilter.tsx               teammate search → filters grid
    TaskDrawer.tsx                   accordion; one instance per drawer
  PlannerHeader.tsx                  prev/next/today, month label, view select, TZ
  WeekGrid.tsx                       scroll container, owns drag state
    TimeAxis.tsx                     hour labels
    AllDayRow.tsx                    OOO, all-day events, reminder chips
    DayColumn.tsx                    one day; hit target for create-drag
    EventCard.tsx                    card + resize handles
    NowLine.tsx                      red line + time pill
  QuickCreatePopover.tsx             Event | Task | Focus time | OOO tabs
  EventDetailPanel.tsx               click a card → full detail
  PlannerCommandBar.tsx              floating cmdk search
lib/planner/
  layout.ts                          PURE: overlap packing, minute↔pixel, snapping
  layout.test.ts                     node:test
  use-planner-drag.ts                the single pointer-event hook
lib/supabase/
  planner-events.ts                  rowToPlannerEvent + CRUD
  planner-priorities.ts              CRUD + reorder
lib/types.ts                         PlannerEvent, PlannerEventKind, PlannerPriority
```

Each unit has one job. `layout.ts` is pure and knows nothing about React or
Supabase — it is the only place the geometry math lives, and the only place with
unit tests. `use-planner-drag.ts` knows about pointers and calls into `layout.ts`,
but performs no I/O; it reports committed values upward. `WeekGrid` renders and
delegates. The page owns data and persistence.

### Geometry (`lib/planner/layout.ts`)

Constants: `PX_PER_HOUR = 56`, `SNAP_MINUTES = 15`, default visible window
7 AM–8 PM with the full 24h scrollable.

- `minutesToY(minutes)` / `yToMinutes(y)` — inverse pairs, round-trip tested
- `snapMinutes(m)` — nearest 15
- `packOverlaps(events)` → `{ event, column, columnCount }[]`

`packOverlaps` is a standard interval-graph packing: sort by start; group into
clusters of transitively-overlapping events; within a cluster assign each event the
lowest column index whose last event has already ended; `columnCount` is the cluster
width. Rendering maps that to `left = column/columnCount`, `width = 1/columnCount`,
with a small stagger so stacked cards read as layered rather than tiled.

This function is where subtle bugs hide, so it carries the test burden.

### Interaction (`lib/planner/use-planner-drag.ts`)

One hook owns a single discriminated-union state so all four gestures share the same
pixel→time math and snapping:

```ts
type DragState =
  | { mode: 'idle' }
  | { mode: 'move';     eventId: string; grabOffsetMin: number }
  | { mode: 'resize';   eventId: string; edge: 'top' | 'bottom' }
  | { mode: 'create';   dayIndex: number; anchorMin: number }
  | { mode: 'schedule'; taskId: string };
```

Flow: `pointerdown` → `setPointerCapture` → `pointermove` updates a ghost preview
(no writes) → `pointerup` commits. Commits are optimistic: local state updates
first, the Supabase write follows, and a failure rolls the local state back and
surfaces the error. `pointercancel` and Escape abort without committing.

Minimum event duration on resize is 15 minutes. A `create` drag under 15 minutes is
treated as a click and opens `QuickCreatePopover` at a default 1-hour block.

### Views

- **Week** — the real grid, Sun–Sat, today's column header highlighted.
- **Day** — the same `WeekGrid` with one column. No separate component.
- **Month** — its own month-cell layout inside `components/planner/`.
  `components/tasks/TaskCalendarView.tsx` is **not** modified or imported; the
  tasks page keeps working exactly as it does now.

### Now-line

Red rule plus a time pill in the axis gutter, rendered only in today's column and
only when today falls in the visible range. Position recomputed on a 60-second
interval, cleared on unmount.

### Timezone

Everything is stored as `timestamptz` and rendered in the browser's local zone. The
header displays the short zone label derived from
`Intl.DateTimeFormat().resolvedOptions().timeZone`. No cross-zone conversion in v1.

### Command bar

`PlannerCommandBar` uses `cmdk` (already a dependency). It searches events, tasks,
and teammates, and exposes commands: Go to today, New event, Week/Day/Month, Jump to
date. Bound to `Cmd+/` so it does not collide with the existing global `Cmd+K`
search or `Cmd+Shift+T` timer shortcut owned by `TopNav`.

---

## Error handling

- Supabase helpers follow the existing convention: catch, `console.error` with a
  `[planner-events]` prefix, return `{ success: false, error }` or an empty array.
- Optimistic drag commits roll back local state on failure and show an inline error.
- A drag ending outside the grid cancels rather than committing a garbage time.
- Missing `estimatedHours` on a scheduled task defaults to a 1-hour block rather
  than a zero-height card.

## Testing

`lib/planner/layout.test.ts`, run with `node --test lib/planner/*.test.ts`
(node:test, matching `lib/seo-ops-logic.test.ts` — not vitest):

- `packOverlaps`: disjoint events, two overlapping, three-way overlap, a chain where
  A–B and B–C overlap but A–C do not, identical start/end, zero-length guard
- `minutesToY` / `yToMinutes` round-trip
- `snapMinutes` boundaries (7, 8, 22, 23 → 0, 15, 15, 30)
- All-day vs timed classification

Manual verification: `npx tsc --noEmit`, then the app in the browser — drag to move,
resize both edges, drag a backlog task in, click-drag an empty slot, switch views,
confirm the now-line lands on the right hour.

## Migration notes

Migration `026_planner.sql` creates both tables, mirrored into `schema.sql`. Applied
manually in the Supabase Dashboard SQL editor. Note that migration 021
(`marketing_plans`) is still listed as pending in `CLAUDE.md` — 026 is independent
of it and does not depend on 021 having been applied.
