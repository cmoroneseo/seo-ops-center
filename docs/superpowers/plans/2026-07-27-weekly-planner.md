# Weekly Calendar & Task Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a ClickUp Planner–style weekly time-grid at `/planner` where meetings, focus blocks, and scheduled tasks render side by side and can be dragged, resized, and created directly on the grid.

**Architecture:** All geometry math lives in one pure, unit-tested module (`lib/planner/layout.ts`). One pointer-event hook (`lib/planner/use-planner-drag.ts`) owns every gesture through a single discriminated-union state, so move / resize / create / schedule share the same snapping and pixel→time conversion. React components render and delegate; the page owns data and persistence. Three record sources overlay the same grid: `planner_events` (new table), `tasks` with a `start_date`, and `personal_reminders` (all-day chips).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, `date-fns` v4, `cmdk`, `lucide-react`, Supabase (Postgres + RLS), `node:test` for unit tests.

## Global Constraints

- **No new dependencies.** Drag-and-drop is hand-rolled with pointer events. Everything needed (`date-fns`, `cmdk`, `lucide-react`) is already installed.
- **Tests use `node:test`, never vitest.** Run with `node --test lib/planner/*.test.ts`.
- **DB → TS mapping** via `rowToX` / `xToRow` functions in each `lib/supabase/*.ts` file. snake_case columns, camelCase TypeScript.
- **Enums** are Postgres text CHECK constraints, typed as TS string unions.
- **Every migration is mirrored into `schema.sql`.**
- **No `Co-Authored-By:` or any Anthropic trailer in any commit message, ever.**
- **Run `npx tsc --noEmit` before every commit.** The project is TypeScript strict.
- **Do not modify `components/tasks/TaskCalendarView.tsx`.** The tasks page must keep working unchanged.
- Branch is `feat/planner`, already created. Never commit to `main`.
- Geometry constants, defined once in `lib/planner/layout.ts`: `PX_PER_HOUR = 56`, `SNAP_MINUTES = 15`, `MIN_EVENT_MINUTES = 15`, `DEFAULT_START_HOUR = 7`, `DEFAULT_END_HOUR = 20`.

---

### Task 1: Pure geometry module

The foundation. Everything else consumes this. It is pure — no React, no Supabase, no `Date` mutation — which is why it is built first and is the only module with unit tests.

**Files:**
- Create: `lib/planner/layout.ts`
- Test: `lib/planner/layout.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PX_PER_HOUR: 56`, `SNAP_MINUTES: 15`, `MIN_EVENT_MINUTES: 15`, `DEFAULT_START_HOUR: 7`, `DEFAULT_END_HOUR: 20`
  - `minutesToY(minutes: number, startHour?: number): number`
  - `yToMinutes(y: number, startHour?: number): number`
  - `snapMinutes(minutes: number): number`
  - `clampMinutes(minutes: number): number`
  - `interface PackableInterval { id: string; startMin: number; endMin: number }`
  - `interface PackedInterval<T> { item: T; column: number; columnCount: number }`
  - `packOverlaps<T extends PackableInterval>(items: T[]): PackedInterval<T>[]`
  - `minutesSinceMidnight(iso: string): number`
  - `durationMinutes(startIso: string, endIso: string): number`

- [ ] **Step 1: Write the failing test**

Create `lib/planner/layout.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PX_PER_HOUR,
    minutesToY,
    yToMinutes,
    snapMinutes,
    clampMinutes,
    packOverlaps,
    minutesSinceMidnight,
    durationMinutes,
} from './layout.ts';

// --- pixel <-> minute conversion -------------------------------------------

test('minutesToY places the grid start hour at y=0', () => {
    assert.equal(minutesToY(7 * 60, 7), 0);
});

test('minutesToY scales one hour to PX_PER_HOUR', () => {
    assert.equal(minutesToY(8 * 60, 7), PX_PER_HOUR);
});

test('minutesToY handles a half hour', () => {
    assert.equal(minutesToY(7 * 60 + 30, 7), PX_PER_HOUR / 2);
});

test('yToMinutes is the inverse of minutesToY', () => {
    for (const minutes of [420, 480, 555, 720, 1140]) {
        assert.equal(yToMinutes(minutesToY(minutes, 7), 7), minutes);
    }
});

// --- snapping ---------------------------------------------------------------

test('snapMinutes rounds to the nearest 15', () => {
    assert.equal(snapMinutes(7), 0);
    assert.equal(snapMinutes(8), 15);
    assert.equal(snapMinutes(22), 15);
    assert.equal(snapMinutes(23), 30);
    assert.equal(snapMinutes(60), 60);
});

test('clampMinutes keeps values inside a single day', () => {
    assert.equal(clampMinutes(-30), 0);
    assert.equal(clampMinutes(2000), 1440);
    assert.equal(clampMinutes(600), 600);
});

// --- ISO helpers ------------------------------------------------------------

test('minutesSinceMidnight reads local wall-clock time', () => {
    const iso = new Date(2026, 6, 27, 9, 30).toISOString();
    assert.equal(minutesSinceMidnight(iso), 9 * 60 + 30);
});

test('durationMinutes measures the gap between two ISO strings', () => {
    const start = new Date(2026, 6, 27, 9, 0).toISOString();
    const end = new Date(2026, 6, 27, 10, 30).toISOString();
    assert.equal(durationMinutes(start, end), 90);
});

// --- overlap packing --------------------------------------------------------

test('packOverlaps gives disjoint events the full width', () => {
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 660, endMin: 720 },
    ]);
    assert.deepEqual(
        packed.map(p => [p.item.id, p.column, p.columnCount]),
        [['a', 0, 1], ['b', 0, 1]],
    );
});

test('packOverlaps splits two overlapping events into two columns', () => {
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 660 },
        { id: 'b', startMin: 600, endMin: 720 },
    ]);
    assert.deepEqual(
        packed.map(p => [p.item.id, p.column, p.columnCount]),
        [['a', 0, 2], ['b', 1, 2]],
    );
});

test('packOverlaps splits a three-way overlap into three columns', () => {
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 720 },
        { id: 'b', startMin: 560, endMin: 700 },
        { id: 'c', startMin: 580, endMin: 680 },
    ]);
    assert.deepEqual(
        packed.map(p => [p.item.id, p.column, p.columnCount]),
        [['a', 0, 3], ['b', 1, 3], ['c', 2, 3]],
    );
});

test('packOverlaps clusters transitively: A-B overlap, B-C overlap, A-C do not', () => {
    // A 9:00-10:00, B 9:45-11:00, C 10:30-11:30
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 585, endMin: 660 },
        { id: 'c', startMin: 630, endMin: 690 },
    ]);
    // All three share a cluster, so all report the same columnCount.
    assert.deepEqual(packed.map(p => p.columnCount), [2, 2, 2]);
    // A and C do not overlap, so C reuses A's column.
    const byId = Object.fromEntries(packed.map(p => [p.item.id, p.column]));
    assert.equal(byId.a, 0);
    assert.equal(byId.b, 1);
    assert.equal(byId.c, 0);
});

test('packOverlaps treats touching events as disjoint', () => {
    // A ends exactly when B starts.
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 600, endMin: 660 },
    ]);
    assert.deepEqual(packed.map(p => p.columnCount), [1, 1]);
});

test('packOverlaps handles identical start and end times', () => {
    const packed = packOverlaps([
        { id: 'a', startMin: 540, endMin: 600 },
        { id: 'b', startMin: 540, endMin: 600 },
    ]);
    assert.deepEqual(
        packed.map(p => [p.item.id, p.column, p.columnCount]),
        [['a', 0, 2], ['b', 1, 2]],
    );
});

test('packOverlaps returns an empty array for no input', () => {
    assert.deepEqual(packOverlaps([]), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test lib/planner/layout.test.ts
```

Expected: FAIL — `Cannot find module './layout.ts'`.

- [ ] **Step 3: Write the implementation**

Create `lib/planner/layout.ts`:

```ts
/**
 * Pure geometry for the weekly planner grid.
 *
 * No React, no Supabase, no Date mutation. Every pixel<->time conversion and
 * every overlap decision in the planner routes through this module, which is
 * why it is the only planner module carrying unit tests.
 */

export const PX_PER_HOUR = 56;
export const SNAP_MINUTES = 15;
export const MIN_EVENT_MINUTES = 15;
export const DEFAULT_START_HOUR = 7;
export const DEFAULT_END_HOUR = 20;

const MINUTES_PER_DAY = 24 * 60;

/** Vertical offset in px for a wall-clock minute, relative to the grid's first hour. */
export function minutesToY(minutes: number, startHour: number = DEFAULT_START_HOUR): number {
    return ((minutes - startHour * 60) / 60) * PX_PER_HOUR;
}

/** Inverse of minutesToY. */
export function yToMinutes(y: number, startHour: number = DEFAULT_START_HOUR): number {
    return (y / PX_PER_HOUR) * 60 + startHour * 60;
}

/** Round to the nearest drag increment. */
export function snapMinutes(minutes: number): number {
    return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/** Keep a minute offset inside a single day. */
export function clampMinutes(minutes: number): number {
    return Math.min(MINUTES_PER_DAY, Math.max(0, minutes));
}

/** Local wall-clock minutes since midnight for an ISO timestamp. */
export function minutesSinceMidnight(iso: string): number {
    const d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
}

/** Whole minutes between two ISO timestamps. */
export function durationMinutes(startIso: string, endIso: string): number {
    return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
}

export interface PackableInterval {
    id: string;
    startMin: number;
    endMin: number;
}

export interface PackedInterval<T> {
    item: T;
    /** Zero-based horizontal slot within the cluster. */
    column: number;
    /** How many slots the cluster is divided into. */
    columnCount: number;
}

/**
 * Interval-graph packing.
 *
 * Sorts by start time, groups items into clusters of transitively-overlapping
 * intervals, then assigns each item the lowest column index whose previous
 * occupant has already ended. Every item in a cluster reports the same
 * columnCount so the renderer can size them all to 1/columnCount.
 *
 * Touching intervals (one ends exactly as the next begins) do NOT overlap.
 * Results are returned in the caller's original order.
 */
export function packOverlaps<T extends PackableInterval>(items: T[]): PackedInterval<T>[] {
    if (items.length === 0) return [];

    const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    const result = new Map<string, { column: number; columnCount: number }>();

    let cluster: T[] = [];
    let clusterEnd = -Infinity;

    const flush = () => {
        if (cluster.length === 0) return;
        // columnEnds[i] = the end minute of the last item placed in column i
        const columnEnds: number[] = [];
        const placements: { id: string; column: number }[] = [];

        for (const item of cluster) {
            let column = columnEnds.findIndex(end => end <= item.startMin);
            if (column === -1) {
                column = columnEnds.length;
                columnEnds.push(item.endMin);
            } else {
                columnEnds[column] = item.endMin;
            }
            placements.push({ id: item.id, column });
        }

        for (const p of placements) {
            result.set(p.id, { column: p.column, columnCount: columnEnds.length });
        }
        cluster = [];
        clusterEnd = -Infinity;
    };

    for (const item of sorted) {
        // A new cluster starts when this item begins at or after everything seen so far.
        if (item.startMin >= clusterEnd) flush();
        cluster.push(item);
        clusterEnd = Math.max(clusterEnd, item.endMin);
    }
    flush();

    return items.map(item => {
        const placement = result.get(item.id) ?? { column: 0, columnCount: 1 };
        return { item, column: placement.column, columnCount: placement.columnCount };
    });
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test lib/planner/layout.test.ts
```

Expected: PASS — all 13 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit && git add lib/planner/layout.ts lib/planner/layout.test.ts && git commit -m "Add pure geometry module for planner grid"
```

---

### Task 2: Migration 026 and shared types

**Files:**
- Create: `migrations/026_planner.sql`
- Modify: `schema.sql` (append at end)
- Modify: `lib/types.ts` (append at end)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `planner_events`, `planner_priorities`; types `PlannerEventKind`, `PlannerEventVisibility`, `PlannerEvent`, `PlannerPriority`.

- [ ] **Step 1: Write the migration**

Create `migrations/026_planner.sql`:

```sql
-- =============================================================================
-- 026: Weekly Planner — calendar events + the sidebar Priorities list
-- =============================================================================
-- planner_events is NOT strictly personal, unlike personal_notes and
-- personal_reminders: org members can read each other's non-private events so
-- the "Meet with <teammate>" filter can show their calendar. Writes stay
-- owner-only.
--
-- Scheduled tasks are NOT duplicated here. A task lands on the grid by having
-- tasks.start_date set; dragging it writes that column directly.
-- =============================================================================

create table public.planner_events (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  title text not null,
  description text,
  kind text not null default 'event' check (kind in ('meeting', 'focus', 'ooo', 'lunch', 'event')),
  starts_at timestamp with time zone not null,
  ends_at timestamp with time zone not null,
  all_day boolean not null default false,
  location text,
  client_id uuid references public.clients(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  attendee_ids uuid[] not null default '{}',
  busy boolean not null default true,
  visibility text not null default 'default' check (visibility in ('default', 'private')),
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint planner_events_ends_after_starts check (ends_at > starts_at)
);

-- The week-range query: every visible event in an org between two timestamps
create index planner_events_org_range_idx
  on public.planner_events (organization_id, starts_at);

-- "My events"
create index planner_events_user_idx
  on public.planner_events (user_id, starts_at);

-- "Meet with" teammate filter
create index planner_events_attendees_idx
  on public.planner_events using gin (attendee_ids);

alter table public.planner_events enable row level security;

create policy "Org members can read visible planner events"
  on public.planner_events for select
  using (
    organization_id in (select get_user_org_ids())
    and (visibility = 'default' or user_id = auth.uid())
  );

create policy "Users can insert their own planner events"
  on public.planner_events for insert
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

create policy "Users can update their own planner events"
  on public.planner_events for update
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

create policy "Users can delete their own planner events"
  on public.planner_events for delete
  using ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

-- =============================================================================
-- planner_priorities — the reorderable Priorities list in the planner rail
-- =============================================================================
-- A priority is either a pinned real task (task_id) or free text (label).

create table public.planner_priorities (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  task_id uuid references public.tasks(id) on delete cascade,
  label text,
  sort_order integer not null default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint planner_priorities_needs_target check (task_id is not null or label is not null)
);

create index planner_priorities_user_idx
  on public.planner_priorities (user_id, sort_order);

alter table public.planner_priorities enable row level security;

create policy "Users can manage their own planner priorities"
  on public.planner_priorities for all
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );
```

- [ ] **Step 2: Mirror into schema.sql**

Append the entire contents of `migrations/026_planner.sql` to the end of `schema.sql`, minus the `-- ===` banner comment header lines. This is the project convention — `schema.sql` is the full current schema.

- [ ] **Step 3: Add the shared types**

Append to `lib/types.ts`:

```ts
// ---------------------------------------------------------------------------
// Weekly Planner (migration 026)
// ---------------------------------------------------------------------------

export type PlannerEventKind = 'meeting' | 'focus' | 'ooo' | 'lunch' | 'event';
export type PlannerEventVisibility = 'default' | 'private';

export interface PlannerEvent {
    id: string;
    organizationId: string;
    userId: string;
    title: string;
    description?: string;
    kind: PlannerEventKind;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    location?: string;
    clientId?: string;
    taskId?: string;
    attendeeIds: string[];
    busy: boolean;
    visibility: PlannerEventVisibility;
    createdAt: string;
    updatedAt: string;
}

export interface PlannerPriority {
    id: string;
    organizationId: string;
    userId: string;
    taskId?: string;
    label?: string;
    sortOrder: number;
    createdAt: string;
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add migrations/026_planner.sql schema.sql lib/types.ts && git commit -m "Add planner_events and planner_priorities schema"
```

- [ ] **Step 6: Hand the SQL to Carlos to apply**

Migration 026 must be pasted into the Supabase Dashboard SQL editor by hand — this project applies migrations manually. Tell Carlos: *"Paste `migrations/026_planner.sql` into the Supabase Dashboard SQL editor and run it."* Do not proceed to Task 3 assuming the tables exist; the CRUD layer is written against the schema either way, but nothing will load in the browser until this runs.

---

### Task 3: Supabase CRUD layers

**Files:**
- Create: `lib/supabase/planner-events.ts`
- Create: `lib/supabase/planner-priorities.ts`

**Interfaces:**
- Consumes: `PlannerEvent`, `PlannerPriority` from `lib/types.ts` (Task 2); `createClient` from `lib/supabase/client.ts`.
- Produces:
  - `rowToPlannerEvent(row: any): PlannerEvent`
  - `listPlannerEvents(params: { organizationId: string; rangeStart: string; rangeEnd: string }): Promise<PlannerEvent[]>`
  - `createPlannerEvent(params: PlannerEventInsert): Promise<PlannerEvent | null>`
  - `updatePlannerEvent(id: string, patch: PlannerEventPatch): Promise<PlannerEvent | null>`
  - `deletePlannerEvent(id: string): Promise<boolean>`
  - `interface PlannerEventInsert`, `interface PlannerEventPatch`
  - `listPlannerPriorities(params: { organizationId: string; userId: string }): Promise<PlannerPriority[]>`
  - `createPlannerPriority(params: { organizationId: string; userId: string; taskId?: string; label?: string; sortOrder: number }): Promise<PlannerPriority | null>`
  - `reorderPlannerPriorities(ordered: { id: string; sortOrder: number }[]): Promise<boolean>`
  - `deletePlannerPriority(id: string): Promise<boolean>`

- [ ] **Step 1: Write the events CRUD layer**

Create `lib/supabase/planner-events.ts`:

```ts
import { createClient } from './client';
import { PlannerEvent, PlannerEventKind, PlannerEventVisibility } from '../types';

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToPlannerEvent(row: any): PlannerEvent {
    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        title: row.title,
        description: row.description ?? undefined,
        kind: row.kind as PlannerEventKind,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        allDay: row.all_day,
        location: row.location ?? undefined,
        clientId: row.client_id ?? undefined,
        taskId: row.task_id ?? undefined,
        attendeeIds: row.attendee_ids ?? [],
        busy: row.busy,
        visibility: row.visibility as PlannerEventVisibility,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

export interface PlannerEventInsert {
    organizationId: string;
    userId: string;
    title: string;
    description?: string;
    kind: PlannerEventKind;
    startsAt: string;
    endsAt: string;
    allDay?: boolean;
    location?: string;
    clientId?: string;
    taskId?: string;
    attendeeIds?: string[];
    busy?: boolean;
    visibility?: PlannerEventVisibility;
}

export interface PlannerEventPatch {
    title?: string;
    description?: string | null;
    kind?: PlannerEventKind;
    startsAt?: string;
    endsAt?: string;
    allDay?: boolean;
    location?: string | null;
    clientId?: string | null;
    taskId?: string | null;
    attendeeIds?: string[];
    busy?: boolean;
    visibility?: PlannerEventVisibility;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Every event overlapping [rangeStart, rangeEnd). An event that starts before
 * the window but ends inside it still belongs on the grid, hence the
 * starts_at < rangeEnd AND ends_at > rangeStart pair rather than a BETWEEN.
 */
export async function listPlannerEvents(params: {
    organizationId: string;
    rangeStart: string;
    rangeEnd: string;
}): Promise<PlannerEvent[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('planner_events')
            .select('*')
            .eq('organization_id', params.organizationId)
            .lt('starts_at', params.rangeEnd)
            .gt('ends_at', params.rangeStart)
            .order('starts_at', { ascending: true });
        if (error) throw error;
        return (data ?? []).map(rowToPlannerEvent);
    } catch (err) {
        console.error('[planner-events] list error:', err);
        return [];
    }
}

export async function createPlannerEvent(params: PlannerEventInsert): Promise<PlannerEvent | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('planner_events')
            .insert([{
                organization_id: params.organizationId,
                user_id: params.userId,
                title: params.title,
                description: params.description ?? null,
                kind: params.kind,
                starts_at: params.startsAt,
                ends_at: params.endsAt,
                all_day: params.allDay ?? false,
                location: params.location ?? null,
                client_id: params.clientId ?? null,
                task_id: params.taskId ?? null,
                attendee_ids: params.attendeeIds ?? [],
                busy: params.busy ?? true,
                visibility: params.visibility ?? 'default',
            }])
            .select('*')
            .single();
        if (error) throw error;
        return rowToPlannerEvent(data);
    } catch (err) {
        console.error('[planner-events] create error:', err);
        return null;
    }
}

export async function updatePlannerEvent(
    id: string,
    patch: PlannerEventPatch,
): Promise<PlannerEvent | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.title !== undefined) row.title = patch.title;
        if (patch.description !== undefined) row.description = patch.description;
        if (patch.kind !== undefined) row.kind = patch.kind;
        if (patch.startsAt !== undefined) row.starts_at = patch.startsAt;
        if (patch.endsAt !== undefined) row.ends_at = patch.endsAt;
        if (patch.allDay !== undefined) row.all_day = patch.allDay;
        if (patch.location !== undefined) row.location = patch.location;
        if (patch.clientId !== undefined) row.client_id = patch.clientId;
        if (patch.taskId !== undefined) row.task_id = patch.taskId;
        if (patch.attendeeIds !== undefined) row.attendee_ids = patch.attendeeIds;
        if (patch.busy !== undefined) row.busy = patch.busy;
        if (patch.visibility !== undefined) row.visibility = patch.visibility;

        const { data, error } = await supabase
            .from('planner_events')
            .update(row)
            .eq('id', id)
            .select('*')
            .single();
        if (error) throw error;
        return rowToPlannerEvent(data);
    } catch (err) {
        console.error('[planner-events] update error:', err);
        return null;
    }
}

export async function deletePlannerEvent(id: string): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('planner_events').delete().eq('id', id);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[planner-events] delete error:', err);
        return false;
    }
}
```

- [ ] **Step 2: Write the priorities CRUD layer**

Create `lib/supabase/planner-priorities.ts`:

```ts
import { createClient } from './client';
import { PlannerPriority } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToPlannerPriority(row: any): PlannerPriority {
    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        taskId: row.task_id ?? undefined,
        label: row.label ?? undefined,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
    };
}

export async function listPlannerPriorities(params: {
    organizationId: string;
    userId: string;
}): Promise<PlannerPriority[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('planner_priorities')
            .select('*')
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        return (data ?? []).map(rowToPlannerPriority);
    } catch (err) {
        console.error('[planner-priorities] list error:', err);
        return [];
    }
}

export async function createPlannerPriority(params: {
    organizationId: string;
    userId: string;
    taskId?: string;
    label?: string;
    sortOrder: number;
}): Promise<PlannerPriority | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('planner_priorities')
            .insert([{
                organization_id: params.organizationId,
                user_id: params.userId,
                task_id: params.taskId ?? null,
                label: params.label ?? null,
                sort_order: params.sortOrder,
            }])
            .select('*')
            .single();
        if (error) throw error;
        return rowToPlannerPriority(data);
    } catch (err) {
        console.error('[planner-priorities] create error:', err);
        return null;
    }
}

/** Persist a new order after a drag. Writes each changed row's sort_order. */
export async function reorderPlannerPriorities(
    ordered: { id: string; sortOrder: number }[],
): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        await Promise.all(
            ordered.map(({ id, sortOrder }) =>
                supabase.from('planner_priorities').update({ sort_order: sortOrder }).eq('id', id),
            ),
        );
        return true;
    } catch (err) {
        console.error('[planner-priorities] reorder error:', err);
        return false;
    }
}

export async function deletePlannerPriority(id: string): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('planner_priorities').delete().eq('id', id);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[planner-priorities] delete error:', err);
        return false;
    }
}
```

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit && git add lib/supabase/planner-events.ts lib/supabase/planner-priorities.ts && git commit -m "Add planner events and priorities CRUD layers"
```

---

### Task 4: Route, nav entry, and the unified item model

Gets `/planner` reachable and defines the one shape every grid component renders. `PlannerItem` is the seam between "three different record types" and "one grid" — no component below this task knows a `planner_events` row from a `task` row.

**Files:**
- Create: `lib/planner/items.ts`
- Create: `app/(dashboard)/planner/page.tsx`
- Modify: `components/dashboard/Sidebar.tsx:5-13`
- Modify: `app/(dashboard)/layout.tsx:57`

**Interfaces:**
- Consumes: `PlannerEvent`, `Task`, `Reminder` from `lib/types.ts`; `listPlannerEvents` (Task 3); `getTasks` from `lib/supabase/tasks.ts`; `listReminders` from `lib/supabase/personal-reminders.ts`; `durationMinutes` from `lib/planner/layout.ts`.
- Produces:
  - `type PlannerItemSource = 'event' | 'task' | 'reminder'`
  - `interface PlannerItem { id: string; source: PlannerItemSource; title: string; startsAt: string; endsAt: string; allDay: boolean; kind: PlannerEventKind; clientName?: string; ownerId?: string; attendeeIds: string[]; draggable: boolean; raw: PlannerEvent | Task | Reminder }`
  - `eventToItem(e: PlannerEvent): PlannerItem`
  - `taskToItem(t: Task): PlannerItem | null`
  - `reminderToItem(r: Reminder): PlannerItem`
  - `TASK_DEFAULT_MINUTES = 60`

- [ ] **Step 1: Write the item model**

Create `lib/planner/items.ts`:

```ts
import { PlannerEvent, PlannerEventKind, Task, Reminder } from '../types';

/** A task with no estimatedHours still needs a visible block. */
export const TASK_DEFAULT_MINUTES = 60;

export type PlannerItemSource = 'event' | 'task' | 'reminder';

/**
 * The single shape the grid renders. Events, scheduled tasks, and reminders
 * all normalize into this so no grid component branches on record type.
 */
export interface PlannerItem {
    id: string;
    source: PlannerItemSource;
    title: string;
    startsAt: string;
    endsAt: string;
    allDay: boolean;
    kind: PlannerEventKind;
    clientName?: string;
    ownerId?: string;
    attendeeIds: string[];
    /** Reminders are read-only on the grid; events and tasks can be dragged. */
    draggable: boolean;
    raw: PlannerEvent | Task | Reminder;
}

export function eventToItem(e: PlannerEvent): PlannerItem {
    return {
        id: `event:${e.id}`,
        source: 'event',
        title: e.title,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        kind: e.kind,
        ownerId: e.userId,
        attendeeIds: e.attendeeIds,
        draggable: true,
        raw: e,
    };
}

/**
 * A task lands on the grid only when it has a startDate. Tasks without one are
 * the Backlog. Duration comes from estimatedHours, defaulting to one hour so a
 * task never renders as a zero-height sliver.
 */
export function taskToItem(t: Task): PlannerItem | null {
    if (!t.startDate) return null;
    const start = new Date(t.startDate);
    if (Number.isNaN(start.getTime())) return null;
    const minutes = t.estimatedHours ? Math.round(t.estimatedHours * 60) : TASK_DEFAULT_MINUTES;
    const end = new Date(start.getTime() + minutes * 60_000);
    return {
        id: `task:${t.id}`,
        source: 'task',
        title: t.title,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        allDay: false,
        kind: 'focus',
        clientName: t.clientName,
        attendeeIds: t.assigneeIds ?? [],
        draggable: true,
        raw: t,
    };
}

/** Reminders render as all-day chips on their due date. */
export function reminderToItem(r: Reminder): PlannerItem {
    const due = new Date(r.dueAt);
    return {
        id: `reminder:${r.id}`,
        source: 'reminder',
        title: r.title,
        startsAt: due.toISOString(),
        endsAt: due.toISOString(),
        allDay: true,
        kind: 'event',
        attendeeIds: [],
        draggable: false,
        raw: r,
    };
}
```

- [ ] **Step 2: Add the nav entry**

In `components/dashboard/Sidebar.tsx`, change the lucide import on line 5 to include `CalendarRange`:

```tsx
import { LayoutDashboard, CheckSquare, Briefcase, ClipboardList, PackageCheck, CalendarRange } from 'lucide-react';
```

And add the entry to `navigation` between Tasks and Deliverables:

```tsx
export const navigation = [
  { name: 'Home', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Workspace', href: '/workspace', icon: Briefcase },
  { name: 'Reports', href: '/reports', icon: ClipboardList },
  { name: 'Tasks', href: '/tasks', icon: CheckSquare },
  { name: 'Planner', href: '/planner', icon: CalendarRange },
  { name: 'Deliverables', href: '/deliverables', icon: PackageCheck },
];
```

- [ ] **Step 3: Keep ClientListPanel off the planner**

The planner has its own left rail and must not render `ClientListPanel` beside it. In `app/(dashboard)/layout.tsx`, the `showProjectSidebar` line already excludes `/planner` because it is an allow-list (`isWorkspace || isTasks || isDashboard`) — verify this by reading line 57 and confirming `/planner` is not in it. No change needed if so.

The planner manages its own scrolling, so it must also opt out of the `<main>` padding. Change the `<main>` className expression so planner pages get no padding:

```tsx
const isPlanner = pathname.startsWith('/planner');
```

Add that next to the other `is*` consts, then in the `<main>` `cn(...)` call replace the padding branch:

```tsx
<main className={cn(
    "flex-1 min-w-0 overflow-y-auto",
    isSetupPage
        ? "flex flex-col items-center justify-center"
        : isPlanner
            ? "overflow-hidden p-0 pt-14 lg:pt-0"
            : "p-4 sm:p-6 lg:p-8 pt-[calc(3.5rem+1rem)] pb-20 lg:pt-8 lg:pb-8"
)}>
```

- [ ] **Step 4: Write the page shell**

Create `app/(dashboard)/planner/page.tsx`. This loads all three sources for the visible week and holds the state the later tasks fill in.

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, startOfWeek, endOfWeek } from 'date-fns';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { PlannerEvent, Task, Reminder } from '@/lib/types';
import { listPlannerEvents } from '@/lib/supabase/planner-events';
import { getTasks } from '@/lib/supabase/tasks';
import { listReminders } from '@/lib/supabase/personal-reminders';
import { PlannerItem, eventToItem, taskToItem, reminderToItem } from '@/lib/planner/items';

export type PlannerView = 'day' | 'week' | 'month';

export default function PlannerPage() {
    const { organization } = useOrganization();
    const { userId } = useCurrentMember();

    const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
    const [view, setView] = useState<PlannerView>('week');
    const [events, setEvents] = useState<PlannerEvent[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Visible range. Week view spans Sun-Sat; day view is a single day. Month
    // view widens the range in Task 11.
    const range = useMemo(() => {
        if (view === 'day') {
            const start = new Date(anchorDate);
            start.setHours(0, 0, 0, 0);
            return { start, end: addDays(start, 1) };
        }
        return { start: startOfWeek(anchorDate), end: addDays(endOfWeek(anchorDate), 1) };
    }, [anchorDate, view]);

    const load = useCallback(async () => {
        if (!organization?.id || !userId) return;
        setIsLoading(true);
        const [e, t, r] = await Promise.all([
            listPlannerEvents({
                organizationId: organization.id,
                rangeStart: range.start.toISOString(),
                rangeEnd: range.end.toISOString(),
            }),
            getTasks(organization.id, {}),
            listReminders({ organizationId: organization.id, userId }),
        ]);
        setEvents(e);
        setTasks(t);
        setReminders(r);
        setIsLoading(false);
    }, [organization?.id, userId, range.start, range.end]);

    useEffect(() => { void load(); }, [load]);

    // Everything that belongs on the grid, normalized to one shape.
    const items: PlannerItem[] = useMemo(() => {
        const fromTasks = tasks
            .map(taskToItem)
            .filter((i): i is PlannerItem => i !== null);
        return [
            ...events.map(eventToItem),
            ...fromTasks,
            ...reminders.filter(r => r.status === 'pending').map(reminderToItem),
        ];
    }, [events, tasks, reminders]);

    // Tasks with no startDate are the backlog.
    const backlog = useMemo(
        () => tasks.filter(t => !t.startDate && t.status !== 'done'),
        [tasks],
    );

    return (
        <div className="flex h-full min-h-0 w-full">
            <div className="flex flex-1 min-w-0 flex-col">
                <div className="p-6 text-sm text-muted-foreground">
                    {isLoading
                        ? 'Loading planner…'
                        : `${items.length} items, ${backlog.length} in backlog — grid arrives in Task 5.`}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 5: Verify it renders**

```bash
npx tsc --noEmit
```

Expected: no errors. Then run `npm run dev`, visit `http://localhost:3000/planner`, and confirm the Planner icon appears in the left rail, the route loads, and the placeholder line reports item counts (zero items is correct until migration 026 is applied and events exist).

- [ ] **Step 6: Commit**

```bash
git add lib/planner/items.ts "app/(dashboard)/planner/page.tsx" components/dashboard/Sidebar.tsx "app/(dashboard)/layout.tsx" && git commit -m "Add planner route, nav entry, and unified item model"
```

---

### Task 5: Week grid — header, axis, columns, now-line

Read-only rendering. No dragging yet.

**Files:**
- Create: `components/planner/PlannerHeader.tsx`
- Create: `components/planner/TimeAxis.tsx`
- Create: `components/planner/NowLine.tsx`
- Create: `components/planner/WeekGrid.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`

**Interfaces:**
- Consumes: `PlannerItem` (Task 4); `PX_PER_HOUR`, `DEFAULT_START_HOUR`, `DEFAULT_END_HOUR`, `minutesToY` (Task 1); `PlannerView` from the page (Task 4).
- Produces:
  - `<PlannerHeader anchorDate view onPrev onNext onToday onViewChange />`
  - `<TimeAxis startHour endHour />`
  - `<NowLine startHour />`
  - `<WeekGrid days items startHour endHour onSlotClick />` where `days: Date[]`

- [ ] **Step 1: Write the header**

Create `components/planner/PlannerHeader.tsx`:

```tsx
'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

export type PlannerView = 'day' | 'week' | 'month';

const VIEWS: PlannerView[] = ['day', 'week', 'month'];

/** Short zone label for the header, e.g. "PDT". */
export function localTimezoneLabel(): string {
    const parts = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
        .formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? '';
}

interface PlannerHeaderProps {
    anchorDate: Date;
    view: PlannerView;
    onPrev: () => void;
    onNext: () => void;
    onToday: () => void;
    onViewChange: (view: PlannerView) => void;
}

export function PlannerHeader({
    anchorDate, view, onPrev, onNext, onToday, onViewChange,
}: PlannerHeaderProps) {
    return (
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <button
                onClick={onPrev}
                aria-label="Previous"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
                <ChevronLeft className="h-4 w-4" />
            </button>
            <button
                onClick={onNext}
                aria-label="Next"
                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
                <ChevronRight className="h-4 w-4" />
            </button>

            <h1 className="text-lg font-semibold">{format(anchorDate, 'MMMM yyyy')}</h1>

            <button
                onClick={onToday}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
                Today
            </button>

            <div className="ml-auto flex items-center gap-3">
                <span className="text-xs text-muted-foreground">{localTimezoneLabel()}</span>
                <div className="flex rounded-md border border-border p-0.5">
                    {VIEWS.map(v => (
                        <button
                            key={v}
                            onClick={() => onViewChange(v)}
                            className={cn(
                                'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                                view === v
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:text-foreground',
                            )}
                        >
                            {v}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Write the time axis and now-line**

Create `components/planner/TimeAxis.tsx`:

```tsx
'use client';

import { PX_PER_HOUR } from '@/lib/planner/layout';

interface TimeAxisProps {
    startHour: number;
    endHour: number;
}

function hourLabel(hour: number): string {
    const h = hour % 24;
    if (h === 0) return '12 am';
    if (h === 12) return '12 pm';
    return h < 12 ? `${h} am` : `${h - 12} pm`;
}

export function TimeAxis({ startHour, endHour }: TimeAxisProps) {
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);
    return (
        <div className="w-16 shrink-0 select-none border-r border-border">
            {hours.map(hour => (
                <div
                    key={hour}
                    style={{ height: PX_PER_HOUR }}
                    className="relative"
                >
                    <span className="absolute -top-2 right-2 text-[11px] text-muted-foreground">
                        {hourLabel(hour)}
                    </span>
                </div>
            ))}
        </div>
    );
}
```

Create `components/planner/NowLine.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { minutesToY } from '@/lib/planner/layout';

interface NowLineProps {
    startHour: number;
}

/**
 * Red current-time rule. Rendered inside today's column only, and only when
 * today is in the visible range — the caller decides that.
 */
export function NowLine({ startHour }: NowLineProps) {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 60_000);
        return () => clearInterval(id);
    }, []);

    const minutes = now.getHours() * 60 + now.getMinutes();
    const top = minutesToY(minutes, startHour);

    return (
        <div
            className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
            style={{ top }}
        >
            <span className="-ml-9 rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                {now.getHours() % 12 || 12}:{String(now.getMinutes()).padStart(2, '0')}
            </span>
            <div className="h-px flex-1 bg-red-500" />
        </div>
    );
}
```

- [ ] **Step 3: Write the grid**

Create `components/planner/WeekGrid.tsx`. Event cards arrive in Task 6 — for now the columns render hour lines and the now-line.

```tsx
'use client';

import { isToday, isSameDay, format } from 'date-fns';
import { cn } from '@/lib/utils';
import { PX_PER_HOUR, DEFAULT_START_HOUR, DEFAULT_END_HOUR } from '@/lib/planner/layout';
import { PlannerItem } from '@/lib/planner/items';
import { TimeAxis } from './TimeAxis';
import { NowLine } from './NowLine';

interface WeekGridProps {
    days: Date[];
    items: PlannerItem[];
    startHour?: number;
    endHour?: number;
}

export function WeekGrid({
    days,
    items,
    startHour = DEFAULT_START_HOUR,
    endHour = DEFAULT_END_HOUR,
}: WeekGridProps) {
    const bodyHeight = (endHour - startHour) * PX_PER_HOUR;
    const hourLines = Array.from({ length: endHour - startHour }, (_, i) => i);

    const timedItems = items.filter(i => !i.allDay);

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Day headers */}
            <div className="flex border-b border-border">
                <div className="w-16 shrink-0 border-r border-border" />
                {days.map(day => (
                    <div key={day.toISOString()} className="flex-1 px-2 py-2 text-center">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {format(day, 'EEE')}
                        </div>
                        <div
                            className={cn(
                                'mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium',
                                isToday(day) && 'bg-red-500 text-white',
                            )}
                        >
                            {format(day, 'd')}
                        </div>
                    </div>
                ))}
            </div>

            {/* Scrollable time body */}
            <div className="flex min-h-0 flex-1 overflow-y-auto">
                <TimeAxis startHour={startHour} endHour={endHour} />
                {days.map(day => {
                    const dayItems = timedItems.filter(i => isSameDay(new Date(i.startsAt), day));
                    return (
                        <div
                            key={day.toISOString()}
                            className="relative flex-1 border-r border-border last:border-r-0"
                            style={{ height: bodyHeight }}
                            data-day={day.toISOString()}
                        >
                            {hourLines.map(i => (
                                <div
                                    key={i}
                                    className="border-b border-border/50"
                                    style={{ height: PX_PER_HOUR }}
                                />
                            ))}
                            {isToday(day) && <NowLine startHour={startHour} />}
                            {/* Event cards render here in Task 6 */}
                            <span className="sr-only">{dayItems.length} items</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Wire the grid into the page**

In `app/(dashboard)/planner/page.tsx`, replace the placeholder `<div className="p-6 …">` block with the header and grid, and add the navigation handlers. Add these imports:

```tsx
import { addDays, addWeeks, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';
import { PlannerHeader } from '@/components/planner/PlannerHeader';
import { WeekGrid } from '@/components/planner/WeekGrid';
```

Remove the local `export type PlannerView` line and import it from the header instead:

```tsx
import { PlannerHeader, PlannerView } from '@/components/planner/PlannerHeader';
```

Add above the `return`:

```tsx
const days = useMemo(
    () => (view === 'day' ? [range.start] : eachDayOfInterval({ start: range.start, end: addDays(range.end, -1) })),
    [range.start, range.end, view],
);

const step = view === 'day' ? 1 : 7;
const handlePrev = () => setAnchorDate(d => addDays(d, -step));
const handleNext = () => setAnchorDate(d => addDays(d, step));
const handleToday = () => setAnchorDate(new Date());
```

And replace the returned JSX body:

```tsx
return (
    <div className="flex h-full min-h-0 w-full">
        <div className="flex flex-1 min-w-0 flex-col">
            <PlannerHeader
                anchorDate={anchorDate}
                view={view}
                onPrev={handlePrev}
                onNext={handleNext}
                onToday={handleToday}
                onViewChange={setView}
            />
            <WeekGrid days={days} items={items} />
        </div>
    </div>
);
```

- [ ] **Step 5: Verify in the browser**

```bash
npx tsc --noEmit
```

Then `npm run dev` and open `/planner`. Confirm: seven day columns Sun–Sat, hour labels 7 am–8 pm down the left, today's date in a red circle, a red now-line at the correct current time, and prev/next/today moving the week.

- [ ] **Step 6: Commit**

```bash
git add components/planner "app/(dashboard)/planner/page.tsx" && git commit -m "Add planner week grid with time axis and now-line"
```

---

### Task 6: Event cards and the all-day row

**Files:**
- Create: `components/planner/EventCard.tsx`
- Create: `components/planner/AllDayRow.tsx`
- Modify: `components/planner/WeekGrid.tsx`

**Interfaces:**
- Consumes: `PlannerItem` (Task 4); `packOverlaps`, `minutesToY`, `minutesSinceMidnight`, `durationMinutes`, `PX_PER_HOUR` (Task 1).
- Produces:
  - `KIND_STYLES: Record<PlannerEventKind, { card: string; accent: string }>`
  - `<EventCard item column columnCount startHour onClick onMoveStart onResizeStart />` — the last two are optional and stay unused until Task 7.
  - `<AllDayRow days items onItemClick />`

- [ ] **Step 1: Write the card**

Create `components/planner/EventCard.tsx`:

```tsx
'use client';

import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { PlannerEventKind } from '@/lib/types';
import { PlannerItem } from '@/lib/planner/items';
import { minutesToY, minutesSinceMidnight, durationMinutes, PX_PER_HOUR } from '@/lib/planner/layout';

/** One place defines what each kind looks like. */
export const KIND_STYLES: Record<PlannerEventKind, { card: string; accent: string }> = {
    meeting: { card: 'bg-blue-500/15 text-blue-700 dark:text-blue-300', accent: 'bg-blue-500' },
    focus:   { card: 'bg-violet-500/15 text-violet-700 dark:text-violet-300', accent: 'bg-violet-500' },
    ooo:     { card: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', accent: 'bg-amber-500' },
    lunch:   { card: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', accent: 'bg-emerald-500' },
    event:   { card: 'bg-sky-500/15 text-sky-700 dark:text-sky-300', accent: 'bg-sky-500' },
};

interface EventCardProps {
    item: PlannerItem;
    column: number;
    columnCount: number;
    startHour: number;
    onClick?: (item: PlannerItem) => void;
    onMoveStart?: (item: PlannerItem, e: React.PointerEvent) => void;
    onResizeStart?: (item: PlannerItem, edge: 'top' | 'bottom', e: React.PointerEvent) => void;
}

export function EventCard({
    item, column, columnCount, startHour, onClick, onMoveStart, onResizeStart,
}: EventCardProps) {
    const startMin = minutesSinceMidnight(item.startsAt);
    const minutes = Math.max(15, durationMinutes(item.startsAt, item.endsAt));
    const top = minutesToY(startMin, startHour);
    const height = (minutes / 60) * PX_PER_HOUR;

    // Stacked cards inset slightly rather than tiling edge to edge.
    const widthPct = 100 / columnCount;
    const style: React.CSSProperties = {
        top,
        height,
        left: `${column * widthPct}%`,
        width: `calc(${widthPct}% - 4px)`,
    };

    const styles = KIND_STYLES[item.kind];
    const isShort = minutes < 45;

    return (
        <div
            style={style}
            onPointerDown={e => onMoveStart?.(item, e)}
            onClick={() => onClick?.(item)}
            className={cn(
                'absolute z-10 overflow-hidden rounded-md border border-black/5 px-2 py-1 text-left shadow-sm',
                'transition-shadow hover:shadow-md',
                onMoveStart && 'cursor-grab active:cursor-grabbing',
                styles.card,
            )}
        >
            <div className={cn('absolute inset-y-0 left-0 w-0.5', styles.accent)} />
            <div className={cn('truncate text-[11px] font-semibold leading-tight', isShort && 'text-[10px]')}>
                {item.title}
            </div>
            {!isShort && (
                <div className="truncate text-[10px] opacity-75">
                    {format(new Date(item.startsAt), 'h:mm')} – {format(new Date(item.endsAt), 'h:mm a')}
                </div>
            )}

            {onResizeStart && (
                <>
                    <div
                        onPointerDown={e => { e.stopPropagation(); onResizeStart(item, 'top', e); }}
                        className="absolute inset-x-0 top-0 h-1.5 cursor-ns-resize"
                    />
                    <div
                        onPointerDown={e => { e.stopPropagation(); onResizeStart(item, 'bottom', e); }}
                        className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                    />
                </>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Write the all-day row**

Create `components/planner/AllDayRow.tsx`:

```tsx
'use client';

import { isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { PlannerItem } from '@/lib/planner/items';
import { KIND_STYLES } from './EventCard';

interface AllDayRowProps {
    days: Date[];
    items: PlannerItem[];
    onItemClick?: (item: PlannerItem) => void;
}

/** OOO blocks, all-day events, and reminder chips. */
export function AllDayRow({ days, items, onItemClick }: AllDayRowProps) {
    const allDay = items.filter(i => i.allDay);

    return (
        <div className="flex border-b border-border">
            <div className="flex w-16 shrink-0 items-center justify-end border-r border-border pr-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    All day
                </span>
            </div>
            {days.map(day => {
                const dayItems = allDay.filter(i => isSameDay(new Date(i.startsAt), day));
                return (
                    <div
                        key={day.toISOString()}
                        className="min-h-[28px] flex-1 space-y-0.5 border-r border-border p-1 last:border-r-0"
                    >
                        {dayItems.map(item => (
                            <button
                                key={item.id}
                                onClick={() => onItemClick?.(item)}
                                className={cn(
                                    'block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium',
                                    KIND_STYLES[item.kind].card,
                                )}
                            >
                                {item.title}
                            </button>
                        ))}
                    </div>
                );
            })}
        </div>
    );
}
```

- [ ] **Step 3: Render cards in the grid**

In `components/planner/WeekGrid.tsx`, add these imports:

```tsx
import { packOverlaps, minutesSinceMidnight, durationMinutes } from '@/lib/planner/layout';
import { EventCard } from './EventCard';
import { AllDayRow } from './AllDayRow';
```

Add `onItemClick?: (item: PlannerItem) => void;` to `WeekGridProps` and destructure it.

Insert `<AllDayRow days={days} items={items} onItemClick={onItemClick} />` directly after the day-headers `</div>` and before the scrollable body.

Then replace the `<span className="sr-only">{dayItems.length} items</span>` placeholder with the packed cards:

```tsx
{packOverlaps(
    dayItems.map(i => ({
        id: i.id,
        startMin: minutesSinceMidnight(i.startsAt),
        endMin: minutesSinceMidnight(i.startsAt) + Math.max(15, durationMinutes(i.startsAt, i.endsAt)),
        item: i,
    })),
).map(({ item: packed, column, columnCount }) => (
    <EventCard
        key={packed.id}
        item={packed.item}
        column={column}
        columnCount={columnCount}
        startHour={startHour}
        onClick={onItemClick}
    />
))}
```

- [ ] **Step 4: Verify with real data**

```bash
npx tsc --noEmit
```

Then in the Supabase Dashboard SQL editor, insert two deliberately overlapping events so the packing is visible (replace both UUIDs with real values from your `organizations` and `users` tables):

```sql
insert into public.planner_events (organization_id, user_id, title, kind, starts_at, ends_at)
values
  ('<org-uuid>', '<user-uuid>', 'Leadership sync', 'meeting', now()::date + interval '10 hours', now()::date + interval '11 hours'),
  ('<org-uuid>', '<user-uuid>', 'Client brief',    'event',   now()::date + interval '10 hours 30 minutes', now()::date + interval '11 hours 30 minutes'),
  ('<org-uuid>', '<user-uuid>', 'Lunch',           'lunch',   now()::date + interval '13 hours', now()::date + interval '14 hours');
```

Reload `/planner`. Expected: the two 10 am events render side by side at half width each; Lunch renders full width in green at 1 pm.

- [ ] **Step 5: Commit**

```bash
git add components/planner && git commit -m "Add planner event cards and all-day row"
```

---

### Task 7: Drag to move and resize

The interaction core. One hook, one state union, one commit path.

**Files:**
- Create: `lib/planner/use-planner-drag.ts`
- Modify: `components/planner/WeekGrid.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`

**Interfaces:**
- Consumes: `PlannerItem` (Task 4); `snapMinutes`, `clampMinutes`, `yToMinutes`, `minutesSinceMidnight`, `durationMinutes`, `MIN_EVENT_MINUTES`, `PX_PER_HOUR` (Task 1).
- Produces:
  - `interface DragCommit { itemId: string; source: PlannerItemSource; startsAt: string; endsAt: string }`
  - `interface DragPreview { itemId: string; startMin: number; endMin: number; dayIndex: number }`
  - `usePlannerDrag(opts: { days: Date[]; startHour: number; onCommit: (c: DragCommit) => void | Promise<void>; onCreate?: (dayIndex: number, startMin: number, endMin: number) => void })` returning `{ preview, beginMove, beginResize, beginCreate, gridRef }`

- [ ] **Step 1: Write the hook**

Create `lib/planner/use-planner-drag.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PlannerItem, PlannerItemSource } from './items';
import {
    snapMinutes,
    clampMinutes,
    yToMinutes,
    minutesSinceMidnight,
    durationMinutes,
    MIN_EVENT_MINUTES,
} from './layout';

export interface DragCommit {
    itemId: string;
    source: PlannerItemSource;
    startsAt: string;
    endsAt: string;
}

export interface DragPreview {
    itemId: string;
    startMin: number;
    endMin: number;
    dayIndex: number;
}

type DragState =
    | { mode: 'idle' }
    | { mode: 'move'; item: PlannerItem; grabOffsetMin: number; durationMin: number }
    | { mode: 'resize'; item: PlannerItem; edge: 'top' | 'bottom' }
    | { mode: 'create'; dayIndex: number; anchorMin: number };

interface Options {
    days: Date[];
    startHour: number;
    onCommit: (commit: DragCommit) => void | Promise<void>;
    onCreate?: (dayIndex: number, startMin: number, endMin: number) => void;
}

/** Combine a calendar day with a minute offset into an ISO timestamp. */
function toIso(day: Date, minutes: number): string {
    const d = new Date(day);
    d.setHours(0, 0, 0, 0);
    d.setMinutes(minutes);
    return d.toISOString();
}

/**
 * Every planner gesture — move, resize, create — funnels through this hook so
 * they share one snapping rule and one pixel->time conversion. Pointer capture
 * keeps the drag alive when the cursor leaves the card.
 */
export function usePlannerDrag({ days, startHour, onCommit, onCreate }: Options) {
    const gridRef = useRef<HTMLDivElement | null>(null);
    const stateRef = useRef<DragState>({ mode: 'idle' });
    const [preview, setPreview] = useState<DragPreview | null>(null);

    /** Pointer position -> { dayIndex, minutes } in grid space. */
    const resolve = useCallback((e: PointerEvent | React.PointerEvent) => {
        const grid = gridRef.current;
        if (!grid) return null;
        const rect = grid.getBoundingClientRect();
        const columnWidth = rect.width / Math.max(1, days.length);
        const dayIndex = Math.min(
            days.length - 1,
            Math.max(0, Math.floor((e.clientX - rect.left) / columnWidth)),
        );
        const y = e.clientY - rect.top + grid.scrollTop;
        return { dayIndex, minutes: clampMinutes(snapMinutes(yToMinutes(y, startHour))) };
    }, [days.length, startHour]);

    const beginMove = useCallback((item: PlannerItem, e: React.PointerEvent) => {
        if (!item.draggable) return;
        const at = resolve(e);
        if (!at) return;
        const startMin = minutesSinceMidnight(item.startsAt);
        stateRef.current = {
            mode: 'move',
            item,
            grabOffsetMin: at.minutes - startMin,
            durationMin: Math.max(MIN_EVENT_MINUTES, durationMinutes(item.startsAt, item.endsAt)),
        };
        (e.target as Element).setPointerCapture?.(e.pointerId);
    }, [resolve]);

    const beginResize = useCallback((item: PlannerItem, edge: 'top' | 'bottom', e: React.PointerEvent) => {
        if (!item.draggable) return;
        stateRef.current = { mode: 'resize', item, edge };
        (e.target as Element).setPointerCapture?.(e.pointerId);
    }, []);

    const beginCreate = useCallback((e: React.PointerEvent) => {
        const at = resolve(e);
        if (!at) return;
        stateRef.current = { mode: 'create', dayIndex: at.dayIndex, anchorMin: at.minutes };
        setPreview({ itemId: '__new__', startMin: at.minutes, endMin: at.minutes, dayIndex: at.dayIndex });
    }, [resolve]);

    // Global listeners: the pointer routinely leaves the element it started on.
    useEffect(() => {
        const handleMove = (e: PointerEvent) => {
            const state = stateRef.current;
            if (state.mode === 'idle') return;
            const at = resolve(e);
            if (!at) return;

            if (state.mode === 'move') {
                const startMin = clampMinutes(at.minutes - state.grabOffsetMin);
                setPreview({
                    itemId: state.item.id,
                    startMin,
                    endMin: clampMinutes(startMin + state.durationMin),
                    dayIndex: at.dayIndex,
                });
            } else if (state.mode === 'resize') {
                const startMin = minutesSinceMidnight(state.item.startsAt);
                const endMin = startMin + durationMinutes(state.item.startsAt, state.item.endsAt);
                const dayIndex = days.findIndex(d =>
                    new Date(d).toDateString() === new Date(state.item.startsAt).toDateString());
                const next = state.edge === 'top'
                    ? { startMin: Math.min(at.minutes, endMin - MIN_EVENT_MINUTES), endMin }
                    : { startMin, endMin: Math.max(at.minutes, startMin + MIN_EVENT_MINUTES) };
                setPreview({ itemId: state.item.id, ...next, dayIndex: Math.max(0, dayIndex) });
            } else if (state.mode === 'create') {
                const lo = Math.min(state.anchorMin, at.minutes);
                const hi = Math.max(state.anchorMin, at.minutes);
                setPreview({ itemId: '__new__', startMin: lo, endMin: hi, dayIndex: state.dayIndex });
            }
        };

        const handleUp = () => {
            const state = stateRef.current;
            const current = preview;
            stateRef.current = { mode: 'idle' };
            setPreview(null);
            if (state.mode === 'idle' || !current) return;

            const day = days[current.dayIndex];
            if (!day) return;

            if (state.mode === 'create') {
                // A drag shorter than the snap increment reads as a click.
                const span = Math.max(current.endMin - current.startMin, 0);
                const endMin = span < MIN_EVENT_MINUTES ? current.startMin + 60 : current.endMin;
                onCreate?.(current.dayIndex, current.startMin, clampMinutes(endMin));
                return;
            }

            void onCommit({
                itemId: state.item.id,
                source: state.item.source,
                startsAt: toIso(day, current.startMin),
                endsAt: toIso(day, Math.max(current.endMin, current.startMin + MIN_EVENT_MINUTES)),
            });
        };

        const handleKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            stateRef.current = { mode: 'idle' };
            setPreview(null);
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', handleKey);
        window.addEventListener('keydown', handleKey);
        return () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleKey);
            window.removeEventListener('keydown', handleKey);
        };
    }, [days, preview, resolve, onCommit, onCreate]);

    return { preview, beginMove, beginResize, beginCreate, gridRef };
}
```

- [ ] **Step 2: Wire the hook into the grid**

In `components/planner/WeekGrid.tsx`, extend `WeekGridProps`:

```tsx
onCommit?: (commit: DragCommit) => void | Promise<void>;
onCreate?: (dayIndex: number, startMin: number, endMin: number) => void;
```

Import and call the hook:

```tsx
import { usePlannerDrag, DragCommit } from '@/lib/planner/use-planner-drag';
```

Inside the component:

```tsx
const { preview, beginMove, beginResize, beginCreate, gridRef } = usePlannerDrag({
    days,
    startHour,
    onCommit: onCommit ?? (() => {}),
    onCreate,
});
```

Attach `ref={gridRef}` to the scrollable body `<div className="flex min-h-0 flex-1 overflow-y-auto">`.

Give each day column an empty-slot handler so a press on blank space starts a create drag:

```tsx
onPointerDown={e => {
    // Only blank space — cards stop propagation themselves.
    if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.hourLine) {
        beginCreate(e);
    }
}}
```

Add `data-hour-line="1"` to each hour-line `<div>` so pressing on a line counts as blank space.

Pass the gesture starters to each card:

```tsx
onMoveStart={beginMove}
onResizeStart={beginResize}
```

Finally, apply the live preview. Where a card's item id matches `preview?.itemId`, override its rendered position — build the item passed to `EventCard` from the preview values:

```tsx
const previewed = preview && preview.itemId === packed.item.id && days[preview.dayIndex]
    ? {
        ...packed.item,
        startsAt: (() => { const d = new Date(days[preview.dayIndex]); d.setHours(0, 0, 0, 0); d.setMinutes(preview.startMin); return d.toISOString(); })(),
        endsAt:   (() => { const d = new Date(days[preview.dayIndex]); d.setHours(0, 0, 0, 0); d.setMinutes(preview.endMin);   return d.toISOString(); })(),
      }
    : packed.item;
```

and pass `item={previewed}`.

- [ ] **Step 3: Commit the drag on the page**

In `app/(dashboard)/planner/page.tsx`, add the commit handler. It is optimistic — local state moves first, the write follows, a failure reloads from the server.

```tsx
import { updatePlannerEvent } from '@/lib/supabase/planner-events';
import { updateTask } from '@/lib/supabase/tasks';
import { DragCommit } from '@/lib/planner/use-planner-drag';
import { durationMinutes } from '@/lib/planner/layout';
```

```tsx
const handleCommit = useCallback(async (commit: DragCommit) => {
    const rawId = commit.itemId.split(':')[1];
    if (!rawId) return;

    if (commit.source === 'event') {
        // Optimistic: move it locally, then persist.
        setEvents(prev => prev.map(e =>
            e.id === rawId ? { ...e, startsAt: commit.startsAt, endsAt: commit.endsAt } : e));
        const saved = await updatePlannerEvent(rawId, {
            startsAt: commit.startsAt,
            endsAt: commit.endsAt,
        });
        if (!saved) {
            console.error('[planner] failed to move event, reloading');
            void load();
        }
        return;
    }

    if (commit.source === 'task') {
        const hours = durationMinutes(commit.startsAt, commit.endsAt) / 60;
        setTasks(prev => prev.map(t =>
            t.id === rawId ? { ...t, startDate: commit.startsAt, estimatedHours: hours } : t));
        const res = await updateTask(rawId, {
            startDate: commit.startsAt,
            estimatedHours: hours,
        });
        if (!res.success) {
            console.error('[planner] failed to move task:', res.error);
            void load();
        }
    }
}, [load]);
```

Pass `onCommit={handleCommit}` to `<WeekGrid>`.

- [ ] **Step 4: Verify in the browser**

```bash
npx tsc --noEmit
```

Then `npm run dev` and on `/planner`: drag the Leadership sync card to 2 pm and confirm it snaps to 15-minute increments, lands there, and survives a page reload. Drag its bottom edge down and confirm the duration grows and persists. Drag its top edge and confirm it cannot be shrunk below 15 minutes. Press Escape mid-drag and confirm the card snaps back.

- [ ] **Step 5: Commit**

```bash
git add lib/planner/use-planner-drag.ts components/planner/WeekGrid.tsx "app/(dashboard)/planner/page.tsx" && git commit -m "Add drag to move and resize on the planner grid"
```

---

### Task 8: Quick-create popover

The tabbed Event / Task / Focus time / OOO popover from the reference screenshots, opened by clicking or drag-selecting empty grid space.

**Files:**
- Create: `components/planner/QuickCreatePopover.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`

**Interfaces:**
- Consumes: `createPlannerEvent`, `PlannerEventInsert` (Task 3); `createTask` from `lib/supabase/tasks.ts`; `PlannerEventKind` from `lib/types.ts`.
- Produces: `<QuickCreatePopover open anchor draft onClose onCreated />` where `draft: { startsAt: string; endsAt: string }` and `anchor: { x: number; y: number }`.

- [ ] **Step 1: Write the popover**

Create `components/planner/QuickCreatePopover.tsx`. It uses the hand-rolled dropdown pattern (`useState` + outside-click ref) the project already uses, not Radix.

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerEventKind } from '@/lib/types';
import { createPlannerEvent } from '@/lib/supabase/planner-events';
import { createTask } from '@/lib/supabase/tasks';

type Tab = 'event' | 'task' | 'focus' | 'ooo';

const TABS: { id: Tab; label: string }[] = [
    { id: 'event', label: 'Event' },
    { id: 'task', label: 'Task' },
    { id: 'focus', label: 'Focus time' },
    { id: 'ooo', label: 'OOO' },
];

const TAB_KIND: Record<Exclude<Tab, 'task'>, PlannerEventKind> = {
    event: 'event',
    focus: 'focus',
    ooo: 'ooo',
};

interface QuickCreatePopoverProps {
    organizationId: string;
    userId: string;
    anchor: { x: number; y: number };
    draft: { startsAt: string; endsAt: string };
    onClose: () => void;
    onCreated: () => void;
}

export function QuickCreatePopover({
    organizationId, userId, anchor, draft, onClose, onCreated,
}: QuickCreatePopoverProps) {
    const [tab, setTab] = useState<Tab>('event');
    const [title, setTitle] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [onClose]);

    const handleSave = async () => {
        const trimmed = title.trim();
        if (!trimmed || isSaving) return;
        setIsSaving(true);

        if (tab === 'task') {
            // Size the task to the drafted block so it renders where it was drawn,
            // rather than falling back to TASK_DEFAULT_MINUTES.
            const hours =
                (new Date(draft.endsAt).getTime() - new Date(draft.startsAt).getTime()) / 3_600_000;
            const res = await createTask({
                organizationId,
                title: trimmed,
                startDate: draft.startsAt,
                dueDate: draft.startsAt,
                estimatedHours: hours,
                priority: 'medium',
                status: 'todo',
                assigneeIds: [userId],
                createdBy: userId,
            });
            if (!res.success) console.error('[planner] create task failed:', res.error);
        } else {
            const created = await createPlannerEvent({
                organizationId,
                userId,
                title: trimmed,
                kind: TAB_KIND[tab],
                startsAt: draft.startsAt,
                endsAt: draft.endsAt,
                visibility: tab === 'focus' ? 'private' : 'default',
                busy: tab !== 'ooo',
            });
            if (!created) console.error('[planner] create event failed');
        }

        setIsSaving(false);
        onCreated();
        onClose();
    };

    return (
        <div
            ref={ref}
            style={{ left: anchor.x, top: anchor.y }}
            className="fixed z-50 w-[340px] rounded-xl border border-border bg-popover p-3 shadow-xl"
        >
            <div className="mb-3 flex items-center gap-1">
                {TABS.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={cn(
                            'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                            tab === t.id
                                ? 'bg-muted text-foreground'
                                : 'text-muted-foreground hover:text-foreground',
                        )}
                    >
                        {t.label}
                    </button>
                ))}
                <button
                    onClick={onClose}
                    aria-label="Close"
                    className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <input
                ref={inputRef}
                value={title}
                onChange={e => setTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleSave(); }}
                placeholder={tab === 'task' ? 'Task name' : 'Add title'}
                className="w-full rounded-lg border-2 border-primary/60 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            />

            <div className="mt-2 text-xs text-muted-foreground">
                {format(new Date(draft.startsAt), 'MMM d, yyyy')}{' · '}
                {format(new Date(draft.startsAt), 'h:mm a')} → {format(new Date(draft.endsAt), 'h:mm a')}
            </div>

            <div className="mt-3 flex justify-end gap-2">
                <button
                    onClick={onClose}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                    Cancel
                </button>
                <button
                    onClick={() => void handleSave()}
                    disabled={!title.trim() || isSaving}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                    {isSaving ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Open it from the page**

In `app/(dashboard)/planner/page.tsx`:

```tsx
import { QuickCreatePopover } from '@/components/planner/QuickCreatePopover';
```

```tsx
const [quickCreate, setQuickCreate] = useState<{
    anchor: { x: number; y: number };
    startsAt: string;
    endsAt: string;
} | null>(null);

const handleCreate = useCallback((dayIndex: number, startMin: number, endMin: number) => {
    const day = days[dayIndex];
    if (!day) return;
    const at = (minutes: number) => {
        const d = new Date(day);
        d.setHours(0, 0, 0, 0);
        d.setMinutes(minutes);
        return d.toISOString();
    };
    setQuickCreate({
        // Centered-ish; the popover is 340px wide.
        anchor: { x: Math.min(window.innerWidth - 360, window.innerWidth / 2), y: 160 },
        startsAt: at(startMin),
        endsAt: at(endMin),
    });
}, [days]);
```

Pass `onCreate={handleCreate}` to `<WeekGrid>`, and render the popover after it:

```tsx
{quickCreate && organization?.id && userId && (
    <QuickCreatePopover
        organizationId={organization.id}
        userId={userId}
        anchor={quickCreate.anchor}
        draft={{ startsAt: quickCreate.startsAt, endsAt: quickCreate.endsAt }}
        onClose={() => setQuickCreate(null)}
        onCreated={() => void load()}
    />
)}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

On `/planner`: click an empty 3 pm slot — the popover opens with a 1-hour draft. Type a title, press Enter, confirm the card appears at 3 pm. Then drag from 4 pm to 6 pm on empty space and confirm the popover shows a 2-hour draft. Switch to the Task tab, save, and confirm a task card appears and shows up on `/tasks` too.

- [ ] **Step 4: Commit**

```bash
git add components/planner/QuickCreatePopover.tsx "app/(dashboard)/planner/page.tsx" && git commit -m "Add quick-create popover for planner events and tasks"
```

---

### Task 9: Left rail — priorities, teammate filter, task drawers, backlog scheduling

**Files:**
- Create: `components/planner/TaskDrawer.tsx`
- Create: `components/planner/PrioritiesList.tsx`
- Create: `components/planner/MeetWithFilter.tsx`
- Create: `components/planner/PlannerSidebar.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`
- Modify: `components/planner/WeekGrid.tsx`

**Interfaces:**
- Consumes: `Task`, `PlannerPriority`, `OrganizationMember`, `User` from `lib/types.ts`; the priorities CRUD (Task 3); `getOrganizationMembers` from `lib/supabase/organizations.ts`; `updateTask` from `lib/supabase/tasks.ts`.
- Produces:
  - `<TaskDrawer title tasks defaultOpen onTaskClick onTaskDragStart />`
  - `<PrioritiesList priorities tasks onAdd onRemove onReorder />`
  - `<MeetWithFilter members selectedIds onToggle />`
  - `<PlannerSidebar ... />` composing the three
  - `interface TeamMember { userId: string; name: string }`

- [ ] **Step 1: Write the task drawer**

Create `components/planner/TaskDrawer.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Task } from '@/lib/types';

interface TaskDrawerProps {
    title: string;
    tasks: Task[];
    defaultOpen?: boolean;
    emptyLabel?: string;
    onTaskClick?: (task: Task) => void;
    /** Fires on pointerdown so the grid can pick the task up. */
    onTaskDragStart?: (task: Task, e: React.PointerEvent) => void;
}

export function TaskDrawer({
    title, tasks, defaultOpen = false, emptyLabel = 'No tasks match these filters',
    onTaskClick, onTaskDragStart,
}: TaskDrawerProps) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-border/60 py-2">
            <button
                onClick={() => setOpen(o => !o)}
                className="flex w-full items-center gap-1 px-3 py-1 text-sm font-medium text-foreground"
            >
                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
                {title}
                {tasks.length > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">{tasks.length}</span>
                )}
            </button>

            {open && (
                <div className="mt-1 space-y-1 px-3">
                    {tasks.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                            {emptyLabel}
                        </div>
                    ) : (
                        tasks.map(task => (
                            <div
                                key={task.id}
                                onPointerDown={e => onTaskDragStart?.(task, e)}
                                onClick={() => onTaskClick?.(task)}
                                className={cn(
                                    'rounded-md border border-border bg-card px-2.5 py-1.5 text-xs',
                                    onTaskDragStart && 'cursor-grab active:cursor-grabbing',
                                    'hover:border-primary/40',
                                )}
                            >
                                <div className="truncate font-medium">{task.title}</div>
                                {task.clientName && (
                                    <div className="truncate text-[10px] text-muted-foreground">
                                        {task.clientName}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Write the priorities list**

Create `components/planner/PrioritiesList.tsx`. Reordering is hand-rolled: press a row, move, drop.

```tsx
'use client';

import { useState } from 'react';
import { Plus, X, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerPriority, Task } from '@/lib/types';

interface PrioritiesListProps {
    priorities: PlannerPriority[];
    tasks: Task[];
    onAdd: (label: string) => void;
    onRemove: (id: string) => void;
    onReorder: (orderedIds: string[]) => void;
}

export function PrioritiesList({ priorities, tasks, onAdd, onRemove, onReorder }: PrioritiesListProps) {
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState('');
    const [dragId, setDragId] = useState<string | null>(null);

    const labelFor = (p: PlannerPriority) =>
        p.label ?? tasks.find(t => t.id === p.taskId)?.title ?? 'Untitled priority';

    const handleDrop = (targetId: string) => {
        if (!dragId || dragId === targetId) { setDragId(null); return; }
        const ids = priorities.map(p => p.id);
        const from = ids.indexOf(dragId);
        const to = ids.indexOf(targetId);
        if (from === -1 || to === -1) { setDragId(null); return; }
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        onReorder(ids);
        setDragId(null);
    };

    const submit = () => {
        const trimmed = draft.trim();
        if (trimmed) onAdd(trimmed);
        setDraft('');
        setAdding(false);
    };

    return (
        <div className="border-b border-border/60 px-3 py-3">
            <div className="mb-2 text-sm font-medium">Priorities</div>

            <div className="space-y-1">
                {priorities.map((p, i) => (
                    <div
                        key={p.id}
                        draggable
                        onDragStart={() => setDragId(p.id)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => handleDrop(p.id)}
                        className={cn(
                            'group flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted',
                            dragId === p.id && 'opacity-50',
                        )}
                    >
                        <GripVertical className="h-3 w-3 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100" />
                        <span className="w-3 shrink-0 text-muted-foreground">{i + 1}</span>
                        <span className="truncate">{labelFor(p)}</span>
                        <button
                            onClick={() => onRemove(p.id)}
                            aria-label="Remove priority"
                            className="ml-auto opacity-0 group-hover:opacity-100"
                        >
                            <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                        </button>
                    </div>
                ))}
            </div>

            {adding ? (
                <input
                    autoFocus
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onBlur={submit}
                    onKeyDown={e => {
                        if (e.key === 'Enter') submit();
                        if (e.key === 'Escape') { setDraft(''); setAdding(false); }
                    }}
                    placeholder="What matters most?"
                    className="mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus:border-primary"
                />
            ) : (
                <button
                    onClick={() => setAdding(true)}
                    className="mt-1 flex items-center gap-1 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                >
                    <Plus className="h-3 w-3" /> Add priority
                </button>
            )}
        </div>
    );
}
```

- [ ] **Step 3: Write the teammate filter**

Create `components/planner/MeetWithFilter.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TeamMember {
    userId: string;
    name: string;
}

interface MeetWithFilterProps {
    members: TeamMember[];
    selectedIds: string[];
    onToggle: (userId: string) => void;
}

export function MeetWithFilter({ members, selectedIds, onToggle }: MeetWithFilterProps) {
    const [query, setQuery] = useState('');

    const matches = query.trim()
        ? members.filter(m => m.name.toLowerCase().includes(query.trim().toLowerCase()))
        : [];

    return (
        <div className="border-b border-border/60 px-3 py-3">
            <div className="mb-2 text-sm font-medium">Meet with</div>

            <div className="relative">
                <Users className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search for people..."
                    className="w-full rounded-md border border-border bg-transparent py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary"
                />
            </div>

            {matches.length > 0 && (
                <div className="mt-1 space-y-0.5">
                    {matches.map(m => (
                        <button
                            key={m.userId}
                            onClick={() => { onToggle(m.userId); setQuery(''); }}
                            className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted"
                        >
                            {m.name}
                        </button>
                    ))}
                </div>
            )}

            {selectedIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {selectedIds.map(id => {
                        const member = members.find(m => m.userId === id);
                        return (
                            <button
                                key={id}
                                onClick={() => onToggle(id)}
                                className={cn(
                                    'flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary',
                                )}
                            >
                                {member?.name ?? 'Teammate'}
                                <X className="h-2.5 w-2.5" />
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 4: Compose the rail**

Create `components/planner/PlannerSidebar.tsx`:

```tsx
'use client';

import { Task, PlannerPriority } from '@/lib/types';
import { PrioritiesList } from './PrioritiesList';
import { MeetWithFilter, TeamMember } from './MeetWithFilter';
import { TaskDrawer } from './TaskDrawer';

interface PlannerSidebarProps {
    priorities: PlannerPriority[];
    tasks: Task[];
    assignedToMe: Task[];
    todayAndOverdue: Task[];
    backlog: Task[];
    members: TeamMember[];
    selectedMemberIds: string[];
    onToggleMember: (userId: string) => void;
    onAddPriority: (label: string) => void;
    onRemovePriority: (id: string) => void;
    onReorderPriorities: (orderedIds: string[]) => void;
    onTaskDragStart: (task: Task, e: React.PointerEvent) => void;
}

export function PlannerSidebar(props: PlannerSidebarProps) {
    return (
        <aside className="flex h-full w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card">
            <div className="px-3 py-3 text-base font-semibold">Planner</div>

            <PrioritiesList
                priorities={props.priorities}
                tasks={props.tasks}
                onAdd={props.onAddPriority}
                onRemove={props.onRemovePriority}
                onReorder={props.onReorderPriorities}
            />

            <MeetWithFilter
                members={props.members}
                selectedIds={props.selectedMemberIds}
                onToggle={props.onToggleMember}
            />

            <TaskDrawer title="Assigned to me" tasks={props.assignedToMe} />
            <TaskDrawer title="Today & overdue" tasks={props.todayAndOverdue} />
            <TaskDrawer
                title="Backlog"
                tasks={props.backlog}
                defaultOpen
                onTaskDragStart={props.onTaskDragStart}
            />
        </aside>
    );
}
```

- [ ] **Step 5: Support dropping a backlog task onto the grid**

In `lib/planner/use-planner-drag.ts`, extend the `DragState` union with a schedule mode:

```ts
| { mode: 'schedule'; taskId: string; title: string; durationMin: number }
```

Add a starter alongside `beginMove`:

```ts
const beginSchedule = useCallback((taskId: string, title: string, durationMin: number, e: React.PointerEvent) => {
    stateRef.current = { mode: 'schedule', taskId, title, durationMin };
    (e.target as Element).setPointerCapture?.(e.pointerId);
}, []);
```

In `handleMove`, add the branch:

```ts
} else if (state.mode === 'schedule') {
    setPreview({
        itemId: `task:${state.taskId}`,
        startMin: at.minutes,
        endMin: clampMinutes(at.minutes + state.durationMin),
        dayIndex: at.dayIndex,
    });
}
```

In `handleUp`, the existing non-create branch already commits `state.item.id` — that path does not exist for schedule mode, so add an explicit branch before it:

```ts
if (state.mode === 'schedule') {
    void onCommit({
        itemId: `task:${state.taskId}`,
        source: 'task',
        startsAt: toIso(day, current.startMin),
        endsAt: toIso(day, Math.max(current.endMin, current.startMin + MIN_EVENT_MINUTES)),
    });
    return;
}
```

Return `beginSchedule` from the hook, and add it to `WeekGridProps` as an outward-facing prop so the page can hand it to the sidebar:

```tsx
onDragHandlesReady?: (handles: { beginSchedule: (taskId: string, title: string, durationMin: number, e: React.PointerEvent) => void }) => void;
```

Call it once on mount inside `WeekGrid`:

```tsx
useEffect(() => { onDragHandlesReady?.({ beginSchedule }); }, [onDragHandlesReady, beginSchedule]);
```

- [ ] **Step 6: Wire the rail into the page**

In `app/(dashboard)/planner/page.tsx`:

```tsx
import { PlannerSidebar } from '@/components/planner/PlannerSidebar';
import { TeamMember } from '@/components/planner/MeetWithFilter';
import { PlannerPriority } from '@/lib/types';
import { getOrganizationMembers } from '@/lib/supabase/organizations';
import {
    listPlannerPriorities, createPlannerPriority,
    reorderPlannerPriorities, deletePlannerPriority,
} from '@/lib/supabase/planner-priorities';
import { isToday, isPast } from 'date-fns';
import { TASK_DEFAULT_MINUTES } from '@/lib/planner/items';
```

Add state and derived lists:

```tsx
const [priorities, setPriorities] = useState<PlannerPriority[]>([]);
const [members, setMembers] = useState<TeamMember[]>([]);
const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
const [scheduleHandle, setScheduleHandle] = useState<
    ((taskId: string, title: string, durationMin: number, e: React.PointerEvent) => void) | null
>(null);

useEffect(() => {
    if (!organization?.id || !userId) return;
    void listPlannerPriorities({ organizationId: organization.id, userId }).then(setPriorities);
    void getOrganizationMembers(organization.id).then(rows =>
        setMembers(rows.map(m => ({
            userId: m.userId,
            name: m.user?.fullName || m.user?.email || 'Team member',
        }))));
}, [organization?.id, userId]);

const assignedToMe = useMemo(
    () => tasks.filter(t => (t.assigneeIds ?? []).includes(userId) && t.status !== 'done'),
    [tasks, userId],
);

const todayAndOverdue = useMemo(
    () => tasks.filter(t =>
        t.status !== 'done' && t.dueDate &&
        (isToday(new Date(t.dueDate)) || isPast(new Date(t.dueDate)))),
    [tasks],
);
```

Filter the grid by selected teammates — an empty selection means no filter:

```tsx
const visibleItems = useMemo(() => {
    if (selectedMemberIds.length === 0) return items;
    return items.filter(i =>
        (i.ownerId && selectedMemberIds.includes(i.ownerId)) ||
        i.attendeeIds.some(id => selectedMemberIds.includes(id)));
}, [items, selectedMemberIds]);
```

Pass `items={visibleItems}` to `<WeekGrid>` instead of `items`, add `onDragHandlesReady={h => setScheduleHandle(() => h.beginSchedule)}`, and render the rail before the grid column:

```tsx
<PlannerSidebar
    priorities={priorities}
    tasks={tasks}
    assignedToMe={assignedToMe}
    todayAndOverdue={todayAndOverdue}
    backlog={backlog}
    members={members}
    selectedMemberIds={selectedMemberIds}
    onToggleMember={id => setSelectedMemberIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])}
    onAddPriority={async label => {
        if (!organization?.id || !userId) return;
        const created = await createPlannerPriority({
            organizationId: organization.id, userId, label, sortOrder: priorities.length,
        });
        if (created) setPriorities(prev => [...prev, created]);
    }}
    onRemovePriority={async id => {
        setPriorities(prev => prev.filter(p => p.id !== id));
        await deletePlannerPriority(id);
    }}
    onReorderPriorities={async orderedIds => {
        setPriorities(prev => orderedIds
            .map((id, i) => { const p = prev.find(x => x.id === id); return p ? { ...p, sortOrder: i } : null; })
            .filter((p): p is PlannerPriority => p !== null));
        await reorderPlannerPriorities(orderedIds.map((id, i) => ({ id, sortOrder: i })));
    }}
    onTaskDragStart={(task, e) => {
        const minutes = task.estimatedHours ? Math.round(task.estimatedHours * 60) : TASK_DEFAULT_MINUTES;
        scheduleHandle?.(task.id, task.title, minutes, e);
    }}
/>
```

- [ ] **Step 7: Verify**

```bash
npx tsc --noEmit
```

On `/planner`: add a priority and confirm it persists across reload; drag one priority above another and confirm the order sticks. Type a teammate's name in "Meet with", select them, and confirm the grid narrows to their events. Open Backlog, drag a task onto Wednesday 2 pm, and confirm it becomes a card there and disappears from the backlog on reload.

- [ ] **Step 8: Commit**

```bash
git add components/planner lib/planner/use-planner-drag.ts "app/(dashboard)/planner/page.tsx" && git commit -m "Add planner sidebar with priorities, teammate filter, and backlog scheduling"
```

---

### Task 10: Event detail panel

**Files:**
- Create: `components/planner/EventDetailPanel.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`

**Interfaces:**
- Consumes: `PlannerItem` (Task 4); `updatePlannerEvent`, `deletePlannerEvent` (Task 3); `TeamMember` (Task 9); `KIND_STYLES` (Task 6).
- Produces: `<EventDetailPanel item members onClose onChanged onDeleted />`

- [ ] **Step 1: Write the panel**

Create `components/planner/EventDetailPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { X, Trash2, MapPin, Users, Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PlannerEvent } from '@/lib/types';
import { PlannerItem } from '@/lib/planner/items';
import { updatePlannerEvent, deletePlannerEvent } from '@/lib/supabase/planner-events';
import { TeamMember } from './MeetWithFilter';
import { KIND_STYLES } from './EventCard';

interface EventDetailPanelProps {
    item: PlannerItem;
    members: TeamMember[];
    onClose: () => void;
    onChanged: () => void;
    onDeleted: () => void;
}

export function EventDetailPanel({ item, members, onClose, onChanged, onDeleted }: EventDetailPanelProps) {
    const isEvent = item.source === 'event';
    const event = isEvent ? (item.raw as PlannerEvent) : null;

    const [title, setTitle] = useState(item.title);
    const [description, setDescription] = useState(event?.description ?? '');

    useEffect(() => {
        setTitle(item.title);
        setDescription((item.raw as PlannerEvent).description ?? '');
    }, [item]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    const save = async () => {
        if (!event) return;
        const trimmed = title.trim();
        if (!trimmed) return;
        if (trimmed === event.title && description === (event.description ?? '')) return;
        const saved = await updatePlannerEvent(event.id, { title: trimmed, description });
        if (saved) onChanged();
    };

    const attendeeNames = (event?.attendeeIds ?? [])
        .map(id => members.find(m => m.userId === id)?.name)
        .filter(Boolean);

    return (
        <aside className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <span className={cn('h-2.5 w-2.5 rounded-full', KIND_STYLES[item.kind].accent)} />
                <span className="text-xs font-medium capitalize text-muted-foreground">{item.kind}</span>
                <button
                    onClick={onClose}
                    aria-label="Close details"
                    className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="space-y-4 px-4 py-4">
                <input
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onBlur={() => void save()}
                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                    readOnly={!isEvent}
                    className="w-full rounded-md bg-transparent text-base font-semibold outline-none focus:bg-muted focus:px-2 focus:py-1"
                />

                <div className="text-xs text-muted-foreground">
                    {format(new Date(item.startsAt), 'EEEE, MMMM d')}
                    <br />
                    {item.allDay
                        ? 'All day'
                        : `${format(new Date(item.startsAt), 'h:mm a')} – ${format(new Date(item.endsAt), 'h:mm a')}`}
                </div>

                {event?.location && (
                    <div className="flex items-center gap-2 text-xs">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {event.location}
                    </div>
                )}

                {item.clientName && (
                    <div className="flex items-center gap-2 text-xs">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {item.clientName}
                    </div>
                )}

                {attendeeNames.length > 0 && (
                    <div className="flex items-start gap-2 text-xs">
                        <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>{attendeeNames.join(', ')}</span>
                    </div>
                )}

                {isEvent && (
                    <textarea
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        onBlur={() => void save()}
                        placeholder="Add description"
                        rows={5}
                        className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none focus:border-primary"
                    />
                )}

                {!isEvent && (
                    <p className="text-xs text-muted-foreground">
                        {item.source === 'task'
                            ? 'This block is a task. Edit it from the Tasks page.'
                            : 'This is a reminder.'}
                    </p>
                )}
            </div>

            {isEvent && event && (
                <button
                    onClick={async () => {
                        if (!confirm('Delete this event?')) return;
                        const ok = await deletePlannerEvent(event.id);
                        if (ok) onDeleted();
                    }}
                    className="mx-4 mb-4 mt-auto flex items-center justify-center gap-2 rounded-md border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                    <Trash2 className="h-3.5 w-3.5" /> Delete event
                </button>
            )}
        </aside>
    );
}
```

- [ ] **Step 2: Open it from the page**

In `app/(dashboard)/planner/page.tsx`:

```tsx
import { EventDetailPanel } from '@/components/planner/EventDetailPanel';
```

```tsx
const [selected, setSelected] = useState<PlannerItem | null>(null);
```

Pass `onItemClick={setSelected}` to `<WeekGrid>`, and render the panel as the last child of the outer flex row:

```tsx
{selected && (
    <EventDetailPanel
        item={selected}
        members={members}
        onClose={() => setSelected(null)}
        onChanged={() => { setSelected(null); void load(); }}
        onDeleted={() => { setSelected(null); void load(); }}
    />
)}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

Click an event card: the panel opens on the right showing time, attendees, and an editable title. Retitle it, click away, and confirm the card label updates. Delete it and confirm it disappears. Click a task card and confirm the panel opens read-only with the "Edit it from the Tasks page" note. Press Escape to close.

- [ ] **Step 4: Commit**

```bash
git add components/planner/EventDetailPanel.tsx "app/(dashboard)/planner/page.tsx" && git commit -m "Add planner event detail panel"
```

---

### Task 11: Day and month views

Day view already works — it reuses `WeekGrid` with one column. This task adds the month grid and widens the data range for it.

**Files:**
- Create: `components/planner/MonthGrid.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`

**Interfaces:**
- Consumes: `PlannerItem` (Task 4); `KIND_STYLES` (Task 6).
- Produces: `<MonthGrid anchorDate items onItemClick onDayClick />`

- [ ] **Step 1: Write the month grid**

Create `components/planner/MonthGrid.tsx`. This is its own component — `components/tasks/TaskCalendarView.tsx` is not touched.

```tsx
'use client';

import {
    startOfMonth, endOfMonth, startOfWeek, endOfWeek,
    eachDayOfInterval, isSameMonth, isToday, isSameDay, format,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { PlannerItem } from '@/lib/planner/items';
import { KIND_STYLES } from './EventCard';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE = 3;

interface MonthGridProps {
    anchorDate: Date;
    items: PlannerItem[];
    onItemClick?: (item: PlannerItem) => void;
    onDayClick?: (day: Date) => void;
}

export function MonthGrid({ anchorDate, items, onItemClick, onDayClick }: MonthGridProps) {
    const days = eachDayOfInterval({
        start: startOfWeek(startOfMonth(anchorDate)),
        end: endOfWeek(endOfMonth(anchorDate)),
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid grid-cols-7 border-b border-border">
                {DAY_LABELS.map(label => (
                    <div key={label} className="px-2 py-2 text-center text-[11px] uppercase tracking-wide text-muted-foreground">
                        {label}
                    </div>
                ))}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto">
                {days.map(day => {
                    const dayItems = items.filter(i => isSameDay(new Date(i.startsAt), day));
                    const overflow = dayItems.length - MAX_VISIBLE;
                    return (
                        <div
                            key={day.toISOString()}
                            onClick={() => onDayClick?.(day)}
                            className={cn(
                                'min-h-[110px] border-b border-r border-border p-1.5',
                                !isSameMonth(day, anchorDate) && 'bg-muted/30',
                            )}
                        >
                            <div
                                className={cn(
                                    'mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                                    isToday(day) && 'bg-red-500 text-white',
                                    !isSameMonth(day, anchorDate) && 'text-muted-foreground',
                                )}
                            >
                                {format(day, 'd')}
                            </div>

                            <div className="space-y-0.5">
                                {dayItems.slice(0, MAX_VISIBLE).map(item => (
                                    <button
                                        key={item.id}
                                        onClick={e => { e.stopPropagation(); onItemClick?.(item); }}
                                        className={cn(
                                            'block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium',
                                            KIND_STYLES[item.kind].card,
                                        )}
                                    >
                                        {item.title}
                                    </button>
                                ))}
                                {overflow > 0 && (
                                    <div className="px-1 text-[10px] text-muted-foreground">
                                        +{overflow} more
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Widen the range and switch views**

In `app/(dashboard)/planner/page.tsx`, add the month imports:

```tsx
import { startOfMonth, endOfMonth, addMonths } from 'date-fns';
import { MonthGrid } from '@/components/planner/MonthGrid';
```

Extend the `range` memo to cover month view:

```tsx
const range = useMemo(() => {
    if (view === 'day') {
        const start = new Date(anchorDate);
        start.setHours(0, 0, 0, 0);
        return { start, end: addDays(start, 1) };
    }
    if (view === 'month') {
        return {
            start: startOfWeek(startOfMonth(anchorDate)),
            end: addDays(endOfWeek(endOfMonth(anchorDate)), 1),
        };
    }
    return { start: startOfWeek(anchorDate), end: addDays(endOfWeek(anchorDate), 1) };
}, [anchorDate, view]);
```

Make prev/next step by month in month view:

```tsx
const handlePrev = () => setAnchorDate(d => (view === 'month' ? addMonths(d, -1) : addDays(d, view === 'day' ? -1 : -7)));
const handleNext = () => setAnchorDate(d => (view === 'month' ? addMonths(d, 1) : addDays(d, view === 'day' ? 1 : 7)));
```

Delete the now-unused `step` const. Then branch the render:

```tsx
{view === 'month' ? (
    <MonthGrid
        anchorDate={anchorDate}
        items={visibleItems}
        onItemClick={setSelected}
        onDayClick={day => { setAnchorDate(day); setView('day'); }}
    />
) : (
    <WeekGrid
        days={days}
        items={visibleItems}
        onItemClick={setSelected}
        onCommit={handleCommit}
        onCreate={handleCreate}
        onDragHandlesReady={h => setScheduleHandle(() => h.beginSchedule)}
    />
)}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

On `/planner`: switch to Day and confirm a single column with working drag. Switch to Month and confirm a full month grid, events as chips, days outside the month dimmed, `+N more` where a day is crowded, and clicking a day jumping to Day view for that date.

- [ ] **Step 4: Commit**

```bash
git add components/planner/MonthGrid.tsx "app/(dashboard)/planner/page.tsx" && git commit -m "Add planner day and month views"
```

---

### Task 12: Floating command bar

**Files:**
- Create: `components/planner/PlannerCommandBar.tsx`
- Modify: `app/(dashboard)/planner/page.tsx`

**Interfaces:**
- Consumes: `PlannerItem` (Task 4); `TeamMember` (Task 9); `PlannerView` (Task 5); `cmdk` (already a dependency).
- Produces: `<PlannerCommandBar items members onSelectItem onSelectMember onGoToToday onViewChange />`

- [ ] **Step 1: Write the command bar**

Create `components/planner/PlannerCommandBar.tsx`. Bound to `Cmd+/` — `Cmd+K` and `Cmd+Shift+T` are already owned by `TopNav` and must not be intercepted.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import { Search } from 'lucide-react';
import { format } from 'date-fns';
import { PlannerItem } from '@/lib/planner/items';
import { TeamMember } from './MeetWithFilter';
import { PlannerView } from './PlannerHeader';

interface PlannerCommandBarProps {
    items: PlannerItem[];
    members: TeamMember[];
    onSelectItem: (item: PlannerItem) => void;
    onSelectMember: (userId: string) => void;
    onGoToToday: () => void;
    onViewChange: (view: PlannerView) => void;
}

export function PlannerCommandBar({
    items, members, onSelectItem, onSelectMember, onGoToToday, onViewChange,
}: PlannerCommandBarProps) {
    const [open, setOpen] = useState(false);

    // Cmd+/ — Cmd+K and Cmd+Shift+T belong to TopNav.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === '/' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                setOpen(o => !o);
            }
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, []);

    const run = (fn: () => void) => { fn(); setOpen(false); };

    if (!open) {
        return (
            <button
                onClick={() => setOpen(true)}
                className="fixed bottom-6 left-1/2 z-40 flex w-[420px] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-popover px-4 py-2.5 text-xs text-muted-foreground shadow-lg hover:border-primary/40"
            >
                <Search className="h-3.5 w-3.5" />
                Search events, teammates, commands...
                <kbd className="ml-auto rounded border border-border px-1.5 py-0.5 text-[10px]">⌘/</kbd>
            </button>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-32">
            <Command
                className="w-[520px] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
                loop
            >
                <div className="flex items-center gap-2 border-b border-border px-3">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Command.Input
                        autoFocus
                        placeholder="Search events, teammates, commands..."
                        className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                    />
                </div>

                <Command.List className="max-h-80 overflow-y-auto p-2">
                    <Command.Empty className="py-6 text-center text-xs text-muted-foreground">
                        No results.
                    </Command.Empty>

                    <Command.Group heading="Commands" className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        <Command.Item
                            onSelect={() => run(onGoToToday)}
                            className="cursor-pointer rounded px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
                        >
                            Go to today
                        </Command.Item>
                        {(['day', 'week', 'month'] as PlannerView[]).map(v => (
                            <Command.Item
                                key={v}
                                onSelect={() => run(() => onViewChange(v))}
                                className="cursor-pointer rounded px-2 py-1.5 text-sm capitalize data-[selected=true]:bg-muted"
                            >
                                Switch to {v} view
                            </Command.Item>
                        ))}
                    </Command.Group>

                    {items.length > 0 && (
                        <Command.Group heading="Events" className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {items.slice(0, 30).map(item => (
                                <Command.Item
                                    key={item.id}
                                    value={`${item.title} ${item.kind}`}
                                    onSelect={() => run(() => onSelectItem(item))}
                                    className="cursor-pointer rounded px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
                                >
                                    <span className="truncate">{item.title}</span>
                                    <span className="ml-2 text-[10px] text-muted-foreground">
                                        {format(new Date(item.startsAt), 'EEE h:mm a')}
                                    </span>
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}

                    {members.length > 0 && (
                        <Command.Group heading="Teammates" className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {members.map(m => (
                                <Command.Item
                                    key={m.userId}
                                    value={m.name}
                                    onSelect={() => run(() => onSelectMember(m.userId))}
                                    className="cursor-pointer rounded px-2 py-1.5 text-sm data-[selected=true]:bg-muted"
                                >
                                    Filter to {m.name}
                                </Command.Item>
                            ))}
                        </Command.Group>
                    )}
                </Command.List>
            </Command>
        </div>
    );
}
```

- [ ] **Step 2: Mount it**

In `app/(dashboard)/planner/page.tsx`:

```tsx
import { PlannerCommandBar } from '@/components/planner/PlannerCommandBar';
```

Render it as the last element inside the outer wrapper `<div>`:

```tsx
<PlannerCommandBar
    items={items}
    members={members}
    onSelectItem={item => { setAnchorDate(new Date(item.startsAt)); setSelected(item); }}
    onSelectMember={id => setSelectedMemberIds(prev =>
        prev.includes(id) ? prev : [...prev, id])}
    onGoToToday={handleToday}
    onViewChange={setView}
/>
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit
```

On `/planner`: the pill sits at the bottom center. Click it or press `Cmd+/` — the palette opens. Type part of an event title and press Enter: the week jumps to that event and its detail panel opens. Run "Switch to month view" and confirm the view changes. Confirm `Cmd+K` still opens the global search and does not open this palette.

- [ ] **Step 4: Final check and commit**

```bash
npx tsc --noEmit && node --test lib/planner/layout.test.ts && npm run lint
```

All three must pass.

```bash
git add components/planner/PlannerCommandBar.tsx "app/(dashboard)/planner/page.tsx" && git commit -m "Add planner floating command bar"
```

- [ ] **Step 5: Update CLAUDE.md**

Add to the "What's shipped" section of `CLAUDE.md`:

```markdown
- **Weekly Planner** (migration 026, Jul 2026):
  - `/planner` page — ClickUp Planner-style week time-grid, own left rail (no ClientListPanel)
  - `planner_events` (org-readable, owner-writable — powers the "Meet with" teammate filter) + `planner_priorities` (strictly personal)
  - Grid overlays three sources as one `PlannerItem` shape: planner_events, tasks with `start_date` (sized by `estimated_hours`), pending reminders as all-day chips
  - Dragging a backlog task writes `tasks.start_date` — no duplicate record
  - `lib/planner/layout.ts` — pure geometry (overlap packing, minute↔pixel, snapping), unit-tested with node:test
  - `lib/planner/use-planner-drag.ts` — one pointer-event hook, one state union for move/resize/create/schedule; 15-min snap, optimistic commits
  - Day/Week/Month views; `Cmd+/` command bar (Cmd+K stays with TopNav)
```

Add `026: planner_events + planner_priorities (applied Jul 2026)` to the "Migrations applied to production" list.

```bash
git add CLAUDE.md && git commit -m "Document weekly planner in project context"
```

---

## Done criteria

- `node --test lib/planner/layout.test.ts` — 13 passing
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- `/planner` renders a week grid with a live now-line
- Events move, resize, and persist across reload
- A backlog task drags onto the grid and gains a start time
- Click-drag on empty space creates an event or task
- Day, Week, and Month views all render
- The "Meet with" filter narrows the grid to a teammate's events
- `/tasks` still works exactly as before — `TaskCalendarView.tsx` is unmodified
