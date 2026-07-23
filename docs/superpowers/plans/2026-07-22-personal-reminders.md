# Personal Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A personal reminders tool (UserMenu → Personal Tools → Reminders) with ClickUp-style natural-language capture, optional client linking, simple recurrence, and delivery via the existing bell-notification system through a Vercel cron.

**Architecture:** Mirrors the Notepad personal-tool pattern exactly: `personal_reminders` table with strictly-personal RLS, `lib/supabase/personal-reminders.ts` CRUD with row mappers, a fixed panel component mounted in the dashboard layout, opened by a `reminders:open` window event from UserMenu. A 5-minute cron converts due reminders into `notifications` rows (new type `reminder_due`), which surface through the existing realtime NotificationBell. Pure date logic lives in `lib/reminders-logic.ts` and is unit-tested with `node:test`.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, Supabase, date-fns v4 (already installed), chrono-node (new dependency), lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-07-22-personal-reminders-design.md`

## Global Constraints

- Branch: `feat/reminders` (already created). Never commit to `main`.
- **Never add `Co-Authored-By:` or any trailer to commit messages.**
- DB columns snake_case → TS camelCase via `rowToReminder` mapper (project convention).
- Enums are text CHECK constraints in Postgres, string unions in TS.
- Every migration is mirrored into `schema.sql`.
- Tests run with `node --test lib/*.test.ts` (node:test, NOT vitest).
- Run `npx tsc --noEmit` before every push.
- Components use the hand-rolled dropdown pattern (useState + outside-click refs), not Radix.
- 4-space indentation in `lib/supabase/*` and notepad-style components; 2-space in `components/notifications/*` — match the file you're editing.
- Migration 021 realtime note applies: `personal_reminders` does NOT need realtime; the `notifications` table already has it.

---

### Task 1: Migration 025 + schema.sql mirror

**Files:**
- Create: `migrations/025_personal_reminders.sql`
- Modify: `schema.sql` (append at end)

**Interfaces:**
- Produces: table `public.personal_reminders` (columns below) consumed by Tasks 3 and 4; notification type `reminder_due` and entity type `reminder` allowed by the `notifications` CHECK constraints, consumed by Task 4.

- [ ] **Step 1: Write the migration**

Create `migrations/025_personal_reminders.sql`:

```sql
-- =============================================================================
-- 025: Personal Reminders — ClickUp-style reminders (UserMenu → Personal Tools)
-- =============================================================================
-- Strictly personal: RLS restricts rows to the creating user (auth.uid()).
-- A 5-minute Vercel cron (/api/cron/fire-reminders) turns due reminders into
-- bell notifications (type 'reminder_due'). Recurrence advances on completion.
-- notify_offset_minutes: 0 = notify on due date, N = notify N minutes before,
-- NULL = don't notify (reminder only shows in the panel).
-- =============================================================================

create table public.personal_reminders (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  user_id uuid references public.users(id) on delete cascade not null,
  title text not null,
  notes text,
  due_at timestamp with time zone not null,
  notify_offset_minutes integer default 0,
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly')),
  client_id uuid references public.clients(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  notified_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Cron sweep: pending, not-yet-notified reminders ordered by due time
create index personal_reminders_cron_idx
  on public.personal_reminders (due_at)
  where status = 'pending' and notified_at is null;

-- Panel queries: a user's reminders by status and due time
create index personal_reminders_user_idx
  on public.personal_reminders (user_id, status, due_at);

alter table public.personal_reminders enable row level security;

create policy "Users can manage their own personal reminders"
  on public.personal_reminders for all
  using      ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) )
  with check ( user_id = auth.uid() and organization_id in (select get_user_org_ids()) );

-- =============================================================================
-- Notifications — allow the reminder_due type and reminder entity
-- =============================================================================
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in (
    'task_assigned', 'task_mentioned', 'note_mentioned',
    'deliverable_assigned', 'deliverable_overdue', 'deliverable_at_risk', 'deliverable_status',
    'reminder_due'
  ));

alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('task', 'task_comment', 'client_note', 'deliverable', 'reminder'));
```

- [ ] **Step 2: Mirror into schema.sql**

Append the entire content of Step 1 (minus the header comment block) to the end of `schema.sql`, preceded by a `-- 025: personal_reminders` section comment. For the notifications constraints, do NOT append duplicates — instead find the existing `notifications_type_check` / `notifications_entity_type_check` definitions in `schema.sql` (added by migration 015's mirror) and edit them in place to include `'reminder_due'` and `'reminder'`. If schema.sql only has the original migration-013 inline CHECK on the `type` column, update that inline CHECK instead.

- [ ] **Step 3: Sanity-check SQL syntax**

Run: `grep -c "personal_reminders" schema.sql`
Expected: at least 4 (table, two indexes, policy).

- [ ] **Step 4: Commit**

```bash
git add migrations/025_personal_reminders.sql schema.sql
git commit -m "Add personal_reminders table and reminder_due notification type"
```

**Note for Carlos (deploy time, not part of this task):** migration 025 must be pasted into the Supabase Dashboard SQL editor before the feature branch merges. No superuser statements needed — the whole file runs as-is.

---

### Task 2: Types + pure reminder logic (TDD)

**Files:**
- Modify: `lib/types.ts` (append after `PersonalNote`, ~line 653)
- Create: `lib/reminders-logic.ts`
- Test: `lib/reminders-logic.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3–6):
  - Types: `Reminder`, `ReminderRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'`, `ReminderStatus = 'pending' | 'done' | 'dismissed'`
  - `nextDueDate(dueAtIso: string, recurrence: ReminderRecurrence): string | null` — next occurrence ISO string, `null` when recurrence is `'none'`
  - `notifyAtMs(dueAtIso: string, notifyOffsetMinutes: number | undefined): number | null` — epoch ms when the notification should fire, `null` when offset is undefined
  - `groupReminders(reminders: Reminder[], now: Date): { overdue: Reminder[]; today: Reminder[]; upcoming: Reminder[]; done: Reminder[] }`
  - `dueLabel(dueAtIso: string, now: Date): string` — human label like `"in 2 hrs"`, `"Tue 8:00 AM"`, `"3 days overdue"`

- [ ] **Step 1: Add types to lib/types.ts**

Append after the `PersonalNote` interface:

```ts
// ---------------------------------------------------------------------------
// Personal Reminders (migration 025)
// ---------------------------------------------------------------------------

export type ReminderRecurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type ReminderStatus = 'pending' | 'done' | 'dismissed';

export interface Reminder {
    id: string;
    organizationId: string;
    userId: string;
    title: string;
    notes?: string;
    dueAt: string;
    /** 0 = on due date, N = minutes before, undefined = don't notify */
    notifyOffsetMinutes?: number;
    recurrence: ReminderRecurrence;
    clientId?: string;
    status: ReminderStatus;
    notifiedAt?: string;
    completedAt?: string;
    createdAt: string;
    updatedAt: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `lib/reminders-logic.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDueDate, notifyAtMs, groupReminders, dueLabel } from './reminders-logic';
import { Reminder } from './types';

function mkReminder(overrides: Partial<Reminder>): Reminder {
    return {
        id: 'r1',
        organizationId: 'org1',
        userId: 'u1',
        title: 'Test',
        dueAt: '2026-07-22T15:00:00.000Z',
        recurrence: 'none',
        status: 'pending',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

test('nextDueDate: none returns null', () => {
    assert.equal(nextDueDate('2026-07-22T15:00:00.000Z', 'none'), null);
});

test('nextDueDate: daily adds one day', () => {
    assert.equal(nextDueDate('2026-07-22T15:00:00.000Z', 'daily'), '2026-07-23T15:00:00.000Z');
});

test('nextDueDate: weekly adds seven days', () => {
    assert.equal(nextDueDate('2026-07-22T15:00:00.000Z', 'weekly'), '2026-07-29T15:00:00.000Z');
});

test('nextDueDate: monthly clamps to end of shorter month', () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year)
    assert.equal(nextDueDate('2026-01-31T09:00:00.000Z', 'monthly'), '2026-02-28T09:00:00.000Z');
});

test('notifyAtMs: offset 0 fires at due time', () => {
    assert.equal(notifyAtMs('2026-07-22T15:00:00.000Z', 0), Date.parse('2026-07-22T15:00:00.000Z'));
});

test('notifyAtMs: offset 60 fires an hour before', () => {
    assert.equal(notifyAtMs('2026-07-22T15:00:00.000Z', 60), Date.parse('2026-07-22T14:00:00.000Z'));
});

test('notifyAtMs: undefined offset means no notification', () => {
    assert.equal(notifyAtMs('2026-07-22T15:00:00.000Z', undefined), null);
});

test('groupReminders: buckets overdue, today, upcoming, done', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const overdue = mkReminder({ id: 'a', dueAt: '2026-07-21T09:00:00.000Z' });
    const today = mkReminder({ id: 'b', dueAt: '2026-07-22T18:00:00.000Z' });
    const upcoming = mkReminder({ id: 'c', dueAt: '2026-07-25T09:00:00.000Z' });
    const done = mkReminder({ id: 'd', status: 'done', dueAt: '2026-07-20T09:00:00.000Z' });
    const groups = groupReminders([upcoming, done, overdue, today], now);
    assert.deepEqual(groups.overdue.map((r) => r.id), ['a']);
    assert.deepEqual(groups.today.map((r) => r.id), ['b']);
    assert.deepEqual(groups.upcoming.map((r) => r.id), ['c']);
    assert.deepEqual(groups.done.map((r) => r.id), ['d']);
});

test('groupReminders: earlier-today but past due counts as overdue', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const r = mkReminder({ dueAt: '2026-07-22T09:00:00.000Z' });
    const groups = groupReminders([r], now);
    assert.equal(groups.overdue.length, 1);
    assert.equal(groups.today.length, 0);
});

test('groupReminders: sections sorted by due date ascending, done by completion desc', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const late = mkReminder({ id: 'late', dueAt: '2026-07-24T09:00:00.000Z' });
    const soon = mkReminder({ id: 'soon', dueAt: '2026-07-23T09:00:00.000Z' });
    const groups = groupReminders([late, soon], now);
    assert.deepEqual(groups.upcoming.map((r) => r.id), ['soon', 'late']);
});

test('dueLabel: future same-day shows relative time', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    assert.equal(dueLabel('2026-07-22T14:00:00.000Z', now), 'in 2 hrs');
});

test('dueLabel: overdue shows how long ago', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    assert.equal(dueLabel('2026-07-19T12:00:00.000Z', now), '3 days overdue');
});

test('dueLabel: future beyond a week shows date', () => {
    const now = new Date('2026-07-22T12:00:00.000Z');
    const label = dueLabel('2026-08-10T15:30:00.000Z', now);
    assert.match(label, /Aug 10/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test lib/reminders-logic.test.ts`
Expected: FAIL — cannot find module `./reminders-logic`.

(If `node --test` cannot load `.ts` directly in this repo, check how `lib/seo-ops-logic.test.ts` is run and use the identical command — the project already runs `node --test lib/*.test.ts`, so whatever loader flags that uses apply here too.)

- [ ] **Step 4: Implement lib/reminders-logic.ts**

```ts
// ---------------------------------------------------------------------------
// Pure reminder logic — no Supabase, no React. Unit-tested with node:test.
// ---------------------------------------------------------------------------

import { addDays, addWeeks, addMonths, differenceInMinutes, isSameDay, format } from 'date-fns';
import { Reminder, ReminderRecurrence } from './types';

/** Next occurrence after completion; null when the reminder doesn't repeat. */
export function nextDueDate(dueAtIso: string, recurrence: ReminderRecurrence): string | null {
    const due = new Date(dueAtIso);
    if (recurrence === 'daily') return addDays(due, 1).toISOString();
    if (recurrence === 'weekly') return addWeeks(due, 1).toISOString();
    if (recurrence === 'monthly') return addMonths(due, 1).toISOString();
    return null;
}

/** Epoch ms when the bell notification should fire; null = don't notify. */
export function notifyAtMs(dueAtIso: string, notifyOffsetMinutes: number | undefined): number | null {
    if (notifyOffsetMinutes === undefined || notifyOffsetMinutes === null) return null;
    return Date.parse(dueAtIso) - notifyOffsetMinutes * 60_000;
}

export interface ReminderGroups {
    overdue: Reminder[];
    today: Reminder[];
    upcoming: Reminder[];
    done: Reminder[];
}

/** Bucket reminders for the panel. Pending sections sort by due asc; done by completion desc. */
export function groupReminders(reminders: Reminder[], now: Date): ReminderGroups {
    const groups: ReminderGroups = { overdue: [], today: [], upcoming: [], done: [] };
    for (const r of reminders) {
        if (r.status !== 'pending') {
            groups.done.push(r);
        } else if (new Date(r.dueAt) < now) {
            groups.overdue.push(r);
        } else if (isSameDay(new Date(r.dueAt), now)) {
            groups.today.push(r);
        } else {
            groups.upcoming.push(r);
        }
    }
    const byDue = (a: Reminder, b: Reminder) => Date.parse(a.dueAt) - Date.parse(b.dueAt);
    groups.overdue.sort(byDue);
    groups.today.sort(byDue);
    groups.upcoming.sort(byDue);
    groups.done.sort((a, b) =>
        Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt));
    return groups;
}

/** Human due label: "in 20 min", "in 2 hrs", "Tue 8:00 AM", "3 days overdue". */
export function dueLabel(dueAtIso: string, now: Date): string {
    const due = new Date(dueAtIso);
    const mins = differenceInMinutes(due, now);

    if (mins < 0) {
        const ago = -mins;
        if (ago < 60) return `${ago} min overdue`;
        if (ago < 60 * 24) return `${Math.floor(ago / 60)} hr${Math.floor(ago / 60) === 1 ? '' : 's'} overdue`;
        const days = Math.floor(ago / (60 * 24));
        return `${days} day${days === 1 ? '' : 's'} overdue`;
    }
    if (mins < 60) return `in ${mins} min`;
    if (isSameDay(due, now)) return `in ${Math.round(mins / 60)} hrs`;
    if (mins < 60 * 24 * 7) return format(due, 'EEE h:mm a');
    return format(due, 'MMM d, h:mm a');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test lib/reminders-logic.test.ts`
Expected: all tests PASS. If the `in 2 hrs` test fails on rounding or the `hrs` pluralization differs, fix the implementation (not the test) to match the test's expected strings exactly.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add lib/types.ts lib/reminders-logic.ts lib/reminders-logic.test.ts
git commit -m "Add Reminder types and pure reminder logic with tests"
```

---

### Task 3: Supabase CRUD layer

**Files:**
- Create: `lib/supabase/personal-reminders.ts`

**Interfaces:**
- Consumes: `Reminder`, `ReminderRecurrence` from `lib/types.ts`; `nextDueDate` from `lib/reminders-logic.ts`; `createClient` from `./client`.
- Produces (consumed by Tasks 5–7):
  - `listReminders(params: { organizationId: string; userId: string }): Promise<Reminder[]>` — pending + last 20 done
  - `createReminder(params: { organizationId: string; userId: string; title: string; dueAt: string; notifyOffsetMinutes?: number | null; recurrence?: ReminderRecurrence; clientId?: string | null; notes?: string }): Promise<Reminder | null>`
  - `updateReminder(id: string, patch: { title?: string; notes?: string | null; dueAt?: string; notifyOffsetMinutes?: number | null; recurrence?: ReminderRecurrence; clientId?: string | null }): Promise<Reminder | null>`
  - `completeReminder(reminder: Reminder): Promise<Reminder | null>` — advances recurring, marks done otherwise
  - `snoozeReminder(id: string, newDueAtIso: string): Promise<Reminder | null>` — resets `notified_at` so it fires again
  - `deleteReminder(id: string): Promise<boolean>`
  - `countOverdueReminders(params: { organizationId: string; userId: string }): Promise<number>`

- [ ] **Step 1: Write the CRUD module**

Create `lib/supabase/personal-reminders.ts` (4-space indent, mirrors `personal-notes.ts` style):

```ts
import { createClient } from './client';
import { Reminder, ReminderRecurrence } from '../types';
import { nextDueDate } from '../reminders-logic';

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToReminder(row: any): Reminder {
    return {
        id: row.id,
        organizationId: row.organization_id,
        userId: row.user_id,
        title: row.title,
        notes: row.notes ?? undefined,
        dueAt: row.due_at,
        notifyOffsetMinutes: row.notify_offset_minutes ?? undefined,
        recurrence: row.recurrence,
        clientId: row.client_id ?? undefined,
        status: row.status,
        notifiedAt: row.notified_at ?? undefined,
        completedAt: row.completed_at ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listReminders(params: {
    organizationId: string;
    userId: string;
}): Promise<Reminder[]> {
    const supabase = createClient();
    if (!supabase) return [];
    try {
        const base = supabase
            .from('personal_reminders')
            .select('*')
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId);
        const [pending, done] = await Promise.all([
            base.eq('status', 'pending').order('due_at', { ascending: true }),
            supabase
                .from('personal_reminders')
                .select('*')
                .eq('organization_id', params.organizationId)
                .eq('user_id', params.userId)
                .neq('status', 'pending')
                .order('completed_at', { ascending: false })
                .limit(20),
        ]);
        if (pending.error) throw pending.error;
        if (done.error) throw done.error;
        return [...(pending.data ?? []), ...(done.data ?? [])].map(rowToReminder);
    } catch (err) {
        console.error('[personal-reminders] list error:', err);
        return [];
    }
}

export async function createReminder(params: {
    organizationId: string;
    userId: string;
    title: string;
    dueAt: string;
    notifyOffsetMinutes?: number | null;
    recurrence?: ReminderRecurrence;
    clientId?: string | null;
    notes?: string;
}): Promise<Reminder | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('personal_reminders')
            .insert([{
                organization_id: params.organizationId,
                user_id: params.userId,
                title: params.title,
                notes: params.notes ?? null,
                due_at: params.dueAt,
                notify_offset_minutes: params.notifyOffsetMinutes === undefined ? 0 : params.notifyOffsetMinutes,
                recurrence: params.recurrence ?? 'none',
                client_id: params.clientId ?? null,
            }])
            .select('*')
            .single();
        if (error) throw error;
        return rowToReminder(data);
    } catch (err) {
        console.error('[personal-reminders] create error:', err);
        return null;
    }
}

export async function updateReminder(
    id: string,
    patch: {
        title?: string;
        notes?: string | null;
        dueAt?: string;
        notifyOffsetMinutes?: number | null;
        recurrence?: ReminderRecurrence;
        clientId?: string | null;
    },
): Promise<Reminder | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (patch.title !== undefined) row.title = patch.title;
        if (patch.notes !== undefined) row.notes = patch.notes;
        if (patch.dueAt !== undefined) {
            row.due_at = patch.dueAt;
            row.notified_at = null; // date changed → allow it to fire again
        }
        if (patch.notifyOffsetMinutes !== undefined) row.notify_offset_minutes = patch.notifyOffsetMinutes;
        if (patch.recurrence !== undefined) row.recurrence = patch.recurrence;
        if (patch.clientId !== undefined) row.client_id = patch.clientId;
        const { data, error } = await supabase
            .from('personal_reminders')
            .update(row)
            .eq('id', id)
            .select('*')
            .single();
        if (error) throw error;
        return rowToReminder(data);
    } catch (err) {
        console.error('[personal-reminders] update error:', err);
        return null;
    }
}

/**
 * Complete a reminder. Recurring reminders advance to the next occurrence
 * (still pending, eligible to notify again); one-time reminders become done.
 */
export async function completeReminder(reminder: Reminder): Promise<Reminder | null> {
    const supabase = createClient();
    if (!supabase) return null;
    try {
        const next = nextDueDate(reminder.dueAt, reminder.recurrence);
        const row: Record<string, unknown> = next
            ? { due_at: next, notified_at: null, updated_at: new Date().toISOString() }
            : { status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        const { data, error } = await supabase
            .from('personal_reminders')
            .update(row)
            .eq('id', reminder.id)
            .select('*')
            .single();
        if (error) throw error;
        return rowToReminder(data);
    } catch (err) {
        console.error('[personal-reminders] complete error:', err);
        return null;
    }
}

export async function snoozeReminder(id: string, newDueAtIso: string): Promise<Reminder | null> {
    return updateReminder(id, { dueAt: newDueAtIso });
}

export async function deleteReminder(id: string): Promise<boolean> {
    const supabase = createClient();
    if (!supabase) return false;
    try {
        const { error } = await supabase.from('personal_reminders').delete().eq('id', id);
        if (error) throw error;
        return true;
    } catch (err) {
        console.error('[personal-reminders] delete error:', err);
        return false;
    }
}

export async function countOverdueReminders(params: {
    organizationId: string;
    userId: string;
}): Promise<number> {
    const supabase = createClient();
    if (!supabase) return 0;
    try {
        const { count, error } = await supabase
            .from('personal_reminders')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', params.organizationId)
            .eq('user_id', params.userId)
            .eq('status', 'pending')
            .lt('due_at', new Date().toISOString());
        if (error) throw error;
        return count ?? 0;
    } catch (err) {
        console.error('[personal-reminders] overdue count error:', err);
        return 0;
    }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If the `base` query-builder reuse in `listReminders` trips Supabase's typing — builders are mutable — inline the pending query the same way the done query is written.)

- [ ] **Step 3: Commit**

```bash
git add lib/supabase/personal-reminders.ts
git commit -m "Add personal reminders CRUD layer"
```

---

### Task 4: Cron route, vercel.json schedule, notification type

**Files:**
- Modify: `lib/supabase/notifications.ts:7-15` (extend `NotificationType` and `EntityType` unions)
- Create: `app/api/cron/fire-reminders/route.ts`
- Modify: `vercel.json` (add cron entry)

**Interfaces:**
- Consumes: table `personal_reminders` (Task 1), `notifyAtMs` from `lib/reminders-logic.ts` (Task 2), `createAdminClient` from `@/lib/supabase/admin`.
- Produces: notification rows with `type: 'reminder_due'`, `entity_type: 'reminder'`, `entity_id: <reminder id>`, `client_id` when linked — consumed by Task 7's bell rendering. Route `GET|POST /api/cron/fire-reminders` guarded by `CRON_SECRET` bearer or session auth.

- [ ] **Step 1: Extend the notification unions**

In `lib/supabase/notifications.ts`, change:

```ts
export type NotificationType =
  | 'task_assigned'
  | 'task_mentioned'
  | 'note_mentioned'
  | 'deliverable_assigned'
  | 'deliverable_overdue'
  | 'deliverable_at_risk'
  | 'deliverable_status'
  | 'reminder_due';
export type EntityType = 'task' | 'task_comment' | 'client_note' | 'deliverable' | 'reminder';
```

- [ ] **Step 2: Write the cron route**

Create `app/api/cron/fire-reminders/route.ts` (auth pattern copied from `app/api/cron/recurring-tasks/route.ts`):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { notifyAtMs } from '@/lib/reminders-logic';

export const maxDuration = 60;

/**
 * GET|POST /api/cron/fire-reminders
 *
 * Every 5 minutes (Vercel Cron). Finds pending personal reminders whose
 * notify time (due_at minus notify_offset_minutes) has arrived and creates
 * a 'reminder_due' bell notification for the owner. Stamps notified_at so
 * a reminder never fires twice. Recurrence is handled at completion time
 * (completeReminder), not here.
 */

async function isAuthorized(req: NextRequest): Promise<boolean> {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.get('authorization') === `Bearer ${secret}`) return true;

    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }); },
                remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }); },
            },
        },
    );
    const { data: { user } } = await supabase.auth.getUser();
    return !!user;
}

export async function POST(req: NextRequest) {
    if (!(await isAuthorized(req))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const results = { checked: 0, fired: 0, errors: 0 };
    const now = Date.now();

    try {
        // Candidates: pending, never notified, notification enabled, and due
        // within the next 24h or already past. The precise offset check
        // happens in TS via notifyAtMs.
        const horizon = new Date(now + 24 * 60 * 60 * 1000).toISOString();
        const { data: reminders, error } = await admin
            .from('personal_reminders')
            .select('id, organization_id, user_id, title, notes, due_at, notify_offset_minutes, client_id')
            .eq('status', 'pending')
            .is('notified_at', null)
            .not('notify_offset_minutes', 'is', null)
            .lte('due_at', horizon);
        if (error) throw error;

        for (const r of reminders ?? []) {
            results.checked++;
            const fireAt = notifyAtMs(r.due_at, r.notify_offset_minutes);
            if (fireAt === null || fireAt > now) continue;

            const { error: notifErr } = await admin.from('notifications').insert({
                organization_id: r.organization_id,
                user_id: r.user_id,
                type: 'reminder_due',
                title: `Reminder: ${r.title}`,
                body: r.notes ?? null,
                entity_type: 'reminder',
                entity_id: r.id,
                client_id: r.client_id ?? null,
            });
            if (notifErr) {
                console.error(`[fire-reminders] notify error for ${r.id}:`, notifErr);
                results.errors++;
                continue;
            }

            const { error: stampErr } = await admin
                .from('personal_reminders')
                .update({ notified_at: new Date(now).toISOString() })
                .eq('id', r.id);
            if (stampErr) {
                console.error(`[fire-reminders] stamp error for ${r.id}:`, stampErr);
                results.errors++;
            } else {
                results.fired++;
            }
        }
    } catch (err) {
        console.error('[fire-reminders] cron error:', err);
        return NextResponse.json({ error: 'Internal error', results }, { status: 500 });
    }

    return NextResponse.json({ success: true, results });
}

export const GET = POST;
```

- [ ] **Step 3: Add the cron schedule**

In `vercel.json`, add to the `crons` array:

```json
{
    "path": "/api/cron/fire-reminders",
    "schedule": "*/5 * * * *"
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/notifications.ts app/api/cron/fire-reminders/route.ts vercel.json
git commit -m "Add fire-reminders cron and reminder_due notification type"
```

**Note:** Vercel Hobby plan limits cron frequency to once/day; Pro allows minute-level. This project is already running multiple crons on the same account, but if `*/5 * * * *` is rejected at deploy, fall back to hourly (`0 * * * *`) and flag it to Carlos.

---

### Task 5: chrono-node + ReminderDatePicker popover

**Files:**
- Modify: `package.json` (add `chrono-node`)
- Create: `components/reminders/ReminderDatePicker.tsx`

**Interfaces:**
- Consumes: `ReminderRecurrence` from `@/lib/types`; date-fns; chrono-node.
- Produces (consumed by Task 6):

```ts
export interface ReminderDateValue {
    dueAt: Date;
    recurrence: ReminderRecurrence;
}
export function ReminderDatePicker(props: {
    value: ReminderDateValue;
    onChange: (v: ReminderDateValue) => void;
    onClose: () => void;
}): React.ReactElement;
```

The picker is a popover *body only* — positioning and the trigger chip live in Task 6's capture bar. Selecting a preset or parsed date calls `onChange` then `onClose`; picking a calendar day calls `onChange` but stays open (so the user can set the time); recurrence changes call `onChange` and stay open.

- [ ] **Step 1: Install chrono-node**

Run: `npm install chrono-node`
Expected: added to `package.json` dependencies, no peer warnings.

- [ ] **Step 2: Write the component**

Create `components/reminders/ReminderDatePicker.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import * as chrono from 'chrono-node';
import {
    addDays, addHours, addMinutes, addMonths, format,
    isSameDay, isSameMonth, nextMonday, setHours, setMinutes, startOfDay, startOfMonth,
} from 'date-fns';
import { ChevronDown, ChevronUp, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReminderRecurrence } from '@/lib/types';

export interface ReminderDateValue {
    dueAt: Date;
    recurrence: ReminderRecurrence;
}

const RECURRENCE_OPTIONS: { value: ReminderRecurrence; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
];

function presets(now: Date): { label: string; date: Date }[] {
    const tomorrow8 = setMinutes(setHours(addDays(startOfDay(now), 1), 8), 0);
    return [
        { label: 'In 20 minutes', date: addMinutes(now, 20) },
        { label: 'In 2 hours', date: addHours(now, 2) },
        { label: 'Tomorrow', date: tomorrow8 },
        { label: 'In 2 days', date: setMinutes(setHours(addDays(startOfDay(now), 2), 8), 0) },
        { label: 'Next week', date: setMinutes(setHours(nextMonday(startOfDay(now)), 8), 0) },
    ];
}

export function ReminderDatePicker({
    value,
    onChange,
    onClose,
}: {
    value: ReminderDateValue;
    onChange: (v: ReminderDateValue) => void;
    onClose: () => void;
}) {
    const now = useMemo(() => new Date(), []);
    const [text, setText] = useState('');
    const [viewMonth, setViewMonth] = useState(startOfMonth(value.dueAt));

    const parsed = useMemo(() => {
        if (!text.trim()) return null;
        return chrono.parseDate(text, now, { forwardDate: true });
    }, [text, now]);

    function pick(date: Date, close: boolean) {
        onChange({ ...value, dueAt: date });
        if (close) onClose();
    }

    function pickCalendarDay(day: Date) {
        // Keep the currently selected time of day
        const withTime = setMinutes(setHours(day, value.dueAt.getHours()), value.dueAt.getMinutes());
        pick(withTime, false);
    }

    // Build a Sunday-first 6-row calendar grid for viewMonth
    const grid: Date[] = useMemo(() => {
        const first = startOfMonth(viewMonth);
        const offset = first.getDay(); // 0 = Sunday
        const start = addDays(first, -offset);
        return Array.from({ length: 42 }, (_, i) => addDays(start, i));
    }, [viewMonth]);

    return (
        <div className="w-72 rounded-xl border border-border bg-card p-2 shadow-xl shadow-black/10">
            {/* Natural-language input */}
            <input
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && parsed) pick(parsed, true);
                    if (e.key === 'Escape') onClose();
                }}
                placeholder='Try "Tomorrow at 2 PM"…'
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            {parsed && (
                <button
                    onClick={() => pick(parsed, true)}
                    className="mt-1 w-full rounded-lg bg-primary/10 px-3 py-1.5 text-left text-xs font-medium text-primary hover:bg-primary/20"
                >
                    {format(parsed, "EEE, MMM d 'at' h:mm a")} — press Enter
                </button>
            )}

            {/* Presets */}
            <div className="mt-2 space-y-0.5">
                {presets(now).map((p) => (
                    <button
                        key={p.label}
                        onClick={() => pick(p.date, true)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm text-foreground hover:bg-accent/20"
                    >
                        <span>{p.label}</span>
                        <span className="text-xs text-muted-foreground">{format(p.date, 'EEE h:mm a')}</span>
                    </button>
                ))}
            </div>

            {/* Recurrence */}
            <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
                <Repeat className="ml-2 h-3.5 w-3.5 text-muted-foreground" />
                {RECURRENCE_OPTIONS.map((opt) => (
                    <button
                        key={opt.value}
                        onClick={() => onChange({ ...value, recurrence: opt.value })}
                        className={cn(
                            'rounded-md px-2 py-1 text-xs transition-colors',
                            value.recurrence === opt.value
                                ? 'bg-primary/10 font-semibold text-primary'
                                : 'text-muted-foreground hover:bg-accent/20',
                        )}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {/* Mini calendar */}
            <div className="mt-2 border-t border-border pt-2">
                <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-sm font-semibold">{format(viewMonth, 'MMM yyyy')}</span>
                    <div className="flex items-center gap-1">
                        <button onClick={() => setViewMonth(startOfMonth(now))} className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent/20">Today</button>
                        <button onClick={() => setViewMonth((m) => addMonths(m, -1))} className="rounded p-1 text-muted-foreground hover:bg-accent/20"><ChevronUp className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setViewMonth((m) => addMonths(m, 1))} className="rounded p-1 text-muted-foreground hover:bg-accent/20"><ChevronDown className="h-3.5 w-3.5" /></button>
                    </div>
                </div>
                <div className="grid grid-cols-7 gap-y-0.5 text-center">
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                        <span key={d} className="text-[10px] font-semibold text-muted-foreground/60">{d}</span>
                    ))}
                    {grid.map((day) => (
                        <button
                            key={day.toISOString()}
                            onClick={() => pickCalendarDay(day)}
                            className={cn(
                                'mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors',
                                isSameDay(day, value.dueAt) && 'bg-primary text-primary-foreground font-bold',
                                !isSameDay(day, value.dueAt) && isSameDay(day, now) && 'bg-red-500/80 text-white',
                                !isSameMonth(day, viewMonth) && 'text-muted-foreground/40',
                                'hover:bg-accent/30',
                            )}
                        >
                            {day.getDate()}
                        </button>
                    ))}
                </div>
                {/* Time input for the selected day */}
                <div className="mt-1 flex items-center justify-between px-2 pb-1">
                    <span className="text-xs text-muted-foreground">Time</span>
                    <input
                        type="time"
                        value={format(value.dueAt, 'HH:mm')}
                        onChange={(e) => {
                            const [h, m] = e.target.value.split(':').map(Number);
                            if (Number.isNaN(h)) return;
                            pick(setMinutes(setHours(value.dueAt, h), m), false);
                        }}
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-primary"
                    />
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json components/reminders/ReminderDatePicker.tsx
git commit -m "Add chrono-node date picker popover for reminders"
```

---

### Task 6: RemindersPanel — capture bar + grouped list

**Files:**
- Create: `components/reminders/RemindersPanel.tsx`
- Create: `components/reminders/ReminderRow.tsx`

**Interfaces:**
- Consumes: `listReminders`, `createReminder`, `completeReminder`, `snoozeReminder`, `deleteReminder`, `updateReminder` (Task 3); `groupReminders`, `dueLabel` (Task 2); `ReminderDatePicker`, `ReminderDateValue` (Task 5); `useOrganization`, `useCurrentMember`, `useClients` hooks; `Reminder` type.
- Produces: `RemindersPanel` component (no props) that opens on the `reminders:open` window event and dispatches `reminders:changed` after any mutation — consumed by Task 7.

- [ ] **Step 1: Write ReminderRow**

Create `components/reminders/ReminderRow.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { AlarmClockPlus, Building2, Check, Repeat, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { addHours, setHours, setMinutes, startOfDay, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { Reminder } from '@/lib/types';
import { dueLabel } from '@/lib/reminders-logic';

export function ReminderRow({
    reminder,
    clientName,
    overdue,
    onComplete,
    onSnooze,
    onDelete,
}: {
    reminder: Reminder;
    clientName?: string;
    overdue: boolean;
    onComplete: (r: Reminder) => void;
    onSnooze: (r: Reminder, newDueAtIso: string) => void;
    onDelete: (r: Reminder) => void;
    onRename: (r: Reminder, title: string) => void;
}) {
    const router = useRouter();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [editTitle, setEditTitle] = useState<string | null>(null);
    const isDone = reminder.status !== 'pending';

    function commitRename() {
        const next = (editTitle ?? '').trim();
        if (next && next !== reminder.title) onRename(reminder, next);
        setEditTitle(null);
    }

    const snoozeHour = () => onSnooze(reminder, addHours(new Date(), 1).toISOString());
    const snoozeTomorrow = () =>
        onSnooze(reminder, setMinutes(setHours(addDays(startOfDay(new Date()), 1), 8), 0).toISOString());

    return (
        <div className="group flex items-start gap-2.5 rounded-lg px-3 py-2 hover:bg-accent/10">
            <button
                onClick={() => onComplete(reminder)}
                disabled={isDone}
                className={cn(
                    'mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition-colors',
                    isDone
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-muted-foreground/40 hover:border-primary',
                )}
                title={reminder.recurrence !== 'none' ? 'Complete (advances to next occurrence)' : 'Complete'}
            >
                {isDone && <Check className="h-3 w-3" />}
            </button>

            <div className="min-w-0 flex-1">
                {editTitle !== null ? (
                    <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setEditTitle(null);
                        }}
                        className="w-full rounded-md border border-border bg-background px-1.5 py-0.5 text-sm outline-none focus:border-primary"
                    />
                ) : (
                    <p
                        onClick={() => { if (!isDone) setEditTitle(reminder.title); }}
                        className={cn(
                            'text-sm leading-tight',
                            isDone ? 'text-muted-foreground line-through' : 'cursor-text',
                        )}
                        title={isDone ? undefined : 'Click to rename'}
                    >
                        {reminder.title}
                    </p>
                )}
                {reminder.notes && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{reminder.notes}</p>
                )}
                <div className="mt-0.5 flex items-center gap-2">
                    <span className={cn('text-[11px]', overdue ? 'font-medium text-red-400' : 'text-muted-foreground')}>
                        {dueLabel(reminder.dueAt, new Date())}
                    </span>
                    {reminder.recurrence !== 'none' && (
                        <Repeat className="h-3 w-3 text-muted-foreground/60" />
                    )}
                    {reminder.clientId && clientName && (
                        <button
                            onClick={() => router.push(`/workspace/${reminder.clientId}`)}
                            className="flex items-center gap-1 rounded-full bg-accent/20 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                            <Building2 className="h-2.5 w-2.5" />
                            {clientName}
                        </button>
                    )}
                </div>
            </div>

            {!isDone && (
                <div className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={snoozeHour} title="Snooze 1 hour" className="rounded-md p-1 text-muted-foreground hover:bg-accent/20 hover:text-foreground">
                        <AlarmClockPlus className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={snoozeTomorrow} title="Snooze until tomorrow 8 AM" className="rounded-md p-1 text-[10px] font-semibold text-muted-foreground hover:bg-accent/20 hover:text-foreground">
                        Tmrw
                    </button>
                    {confirmDelete ? (
                        <button onClick={() => onDelete(reminder)} className="rounded-md p-1 text-xs font-semibold text-destructive">
                            Sure?
                        </button>
                    ) : (
                        <button onClick={() => setConfirmDelete(true)} title="Delete" className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 2: Write RemindersPanel**

Create `components/reminders/RemindersPanel.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlarmClock, Bell, BellOff, Building2, CalendarClock, ChevronDown, X } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { Reminder } from '@/lib/types';
import {
    listReminders, createReminder, completeReminder, snoozeReminder, deleteReminder, updateReminder,
} from '@/lib/supabase/personal-reminders';
import { groupReminders } from '@/lib/reminders-logic';
import { useOrganization } from '@/components/providers/organization-provider';
import { useCurrentMember } from '@/lib/hooks/useCurrentMember';
import { useClients } from '@/lib/hooks/use-clients';
import { ReminderDatePicker, ReminderDateValue } from './ReminderDatePicker';
import { ReminderRow } from './ReminderRow';

const NOTIFY_OPTIONS: { value: number | null; label: string }[] = [
    { value: 0, label: 'On due date' },
    { value: 10, label: '10 minutes before' },
    { value: 60, label: '1 hour before' },
    { value: null, label: "Don't notify" },
];

function defaultDue(): Date {
    // Next round hour, at least 20 minutes out
    const d = new Date(Date.now() + 20 * 60_000);
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
}

export function RemindersPanel() {
    const { organization } = useOrganization();
    const { userId } = useCurrentMember();
    const { clients } = useClients({ statuses: ['Active'] });
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [reminders, setReminders] = useState<Reminder[]>([]);
    const [showDone, setShowDone] = useState(false);

    // Capture state
    const [title, setTitle] = useState('');
    const [dateValue, setDateValue] = useState<ReminderDateValue>({ dueAt: defaultDue(), recurrence: 'none' });
    const [notifyOffset, setNotifyOffset] = useState<number | null>(0);
    const [clientId, setClientId] = useState<string | null>(null);
    const [openPopover, setOpenPopover] = useState<'date' | 'notify' | 'client' | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const clientNameById = useMemo(
        () => new Map(clients.map((c) => [c.id, c.name])),
        [clients],
    );

    const refresh = useCallback(async () => {
        if (!organization || !userId) return;
        setIsLoading(true);
        const data = await listReminders({ organizationId: organization.id, userId });
        setReminders(data);
        setIsLoading(false);
    }, [organization, userId]);

    useEffect(() => {
        function handleOpen() { setIsOpen(true); }
        window.addEventListener('reminders:open', handleOpen);
        return () => window.removeEventListener('reminders:open', handleOpen);
    }, []);

    useEffect(() => {
        if (isOpen) {
            refresh();
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [isOpen, refresh]);

    // Close popovers on outside click
    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
                setOpenPopover(null);
            }
        }
        if (openPopover) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [openPopover]);

    function notifyChanged() {
        window.dispatchEvent(new CustomEvent('reminders:changed'));
    }

    async function handleCreate() {
        if (!organization || !userId || !title.trim()) return;
        const created = await createReminder({
            organizationId: organization.id,
            userId,
            title: title.trim(),
            dueAt: dateValue.dueAt.toISOString(),
            recurrence: dateValue.recurrence,
            notifyOffsetMinutes: notifyOffset,
            clientId,
        });
        if (created) {
            setReminders((prev) => [created, ...prev]);
            setTitle('');
            setDateValue({ dueAt: defaultDue(), recurrence: 'none' });
            setClientId(null);
            setNotifyOffset(0);
            notifyChanged();
            inputRef.current?.focus();
        }
    }

    async function handleComplete(r: Reminder) {
        const updated = await completeReminder(r);
        if (updated) {
            setReminders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            notifyChanged();
        }
    }

    async function handleSnooze(r: Reminder, newDueAtIso: string) {
        const updated = await snoozeReminder(r.id, newDueAtIso);
        if (updated) {
            setReminders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            notifyChanged();
        }
    }

    async function handleDelete(r: Reminder) {
        if (await deleteReminder(r.id)) {
            setReminders((prev) => prev.filter((x) => x.id !== r.id));
            notifyChanged();
        }
    }

    async function handleRename(r: Reminder, newTitle: string) {
        const updated = await updateReminder(r.id, { title: newTitle });
        if (updated) {
            setReminders((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
        }
    }

    const groups = useMemo(() => groupReminders(reminders, new Date()), [reminders]);
    const chipClass =
        'flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent/20 hover:text-foreground transition-colors';

    if (!isOpen) return null;

    const notifyLabel =
        NOTIFY_OPTIONS.find((o) => o.value === notifyOffset)?.label ?? `${notifyOffset} min before`;

    return (
        <div className="fixed right-4 top-16 z-[150] hidden h-[560px] w-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-black/20 md:flex">
            {/* Header */}
            <div className="relative flex items-center gap-2 border-b border-border bg-primary/5 px-3 py-2.5">
                <AlarmClock className="h-4 w-4 text-primary" />
                <p className="text-sm font-semibold text-foreground">Reminders</p>
                <button
                    onClick={() => setIsOpen(false)}
                    className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-accent/20"
                    title="Close"
                >
                    <X className="h-4 w-4" />
                </button>
            </div>

            {/* Capture bar */}
            <div className="border-b border-border p-3" ref={popoverRef}>
                <input
                    ref={inputRef}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                    placeholder="Remind me to…"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <div className="relative mt-2 flex items-center gap-1.5">
                    {/* Date chip */}
                    <button onClick={() => setOpenPopover(openPopover === 'date' ? null : 'date')} className={cn(chipClass, 'text-foreground')}>
                        <CalendarClock className="h-3.5 w-3.5" />
                        {format(dateValue.dueAt, 'EEE h:mm a')}
                        {dateValue.recurrence !== 'none' && <span className="text-primary">· {dateValue.recurrence}</span>}
                    </button>
                    {/* Client chip */}
                    <button onClick={() => setOpenPopover(openPopover === 'client' ? null : 'client')} className={chipClass}>
                        <Building2 className="h-3.5 w-3.5" />
                        {clientId ? clientNameById.get(clientId) ?? 'Client' : 'Client'}
                    </button>
                    {/* Notify chip */}
                    <button onClick={() => setOpenPopover(openPopover === 'notify' ? null : 'notify')} className={chipClass}>
                        {notifyOffset === null ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                        {notifyLabel}
                    </button>

                    {/* Popovers */}
                    {openPopover === 'date' && (
                        <div className="absolute left-0 top-full z-10 mt-1">
                            <ReminderDatePicker
                                value={dateValue}
                                onChange={setDateValue}
                                onClose={() => setOpenPopover(null)}
                            />
                        </div>
                    )}
                    {openPopover === 'client' && (
                        <div className="absolute left-0 top-full z-10 mt-1 max-h-56 w-64 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl shadow-black/10">
                            <button
                                onClick={() => { setClientId(null); setOpenPopover(null); }}
                                className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/20"
                            >
                                No client
                            </button>
                            {clients.map((c) => (
                                <button
                                    key={c.id}
                                    onClick={() => { setClientId(c.id); setOpenPopover(null); }}
                                    className={cn(
                                        'w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-accent/20',
                                        clientId === c.id ? 'font-semibold text-primary' : 'text-foreground',
                                    )}
                                >
                                    {c.name}
                                </button>
                            ))}
                        </div>
                    )}
                    {openPopover === 'notify' && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-xl border border-border bg-card p-1 shadow-xl shadow-black/10">
                            {NOTIFY_OPTIONS.map((opt) => (
                                <button
                                    key={String(opt.value)}
                                    onClick={() => { setNotifyOffset(opt.value); setOpenPopover(null); }}
                                    className={cn(
                                        'w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-accent/20',
                                        notifyOffset === opt.value ? 'font-semibold text-primary' : 'text-foreground',
                                    )}
                                >
                                    {opt.label}
                                </button>
                            ))}
                            {/* Custom minutes */}
                            <div className="flex items-center gap-2 rounded-lg px-3 py-1.5">
                                <span className="text-sm text-foreground">Custom:</span>
                                <input
                                    type="number"
                                    min={1}
                                    max={10080}
                                    placeholder="min"
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            const v = Number((e.target as HTMLInputElement).value);
                                            if (v > 0) { setNotifyOffset(v); setOpenPopover(null); }
                                        }
                                    }}
                                    className="w-16 rounded-md border border-border bg-background px-2 py-0.5 text-xs outline-none focus:border-primary"
                                />
                                <span className="text-xs text-muted-foreground">before</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {isLoading ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
                ) : reminders.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
                        <AlarmClock className="h-8 w-8 opacity-30" />
                        <p className="text-sm">No reminders yet</p>
                    </div>
                ) : (
                    <>
                        {([
                            ['Overdue', groups.overdue, true],
                            ['Today', groups.today, false],
                            ['Upcoming', groups.upcoming, false],
                        ] as const).map(([label, items, isOverdue]) =>
                            items.length === 0 ? null : (
                                <div key={label}>
                                    <p className={cn(
                                        'px-4 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider',
                                        isOverdue ? 'text-red-400' : 'text-muted-foreground/60',
                                    )}>
                                        {label}
                                    </p>
                                    {items.map((r) => (
                                        <ReminderRow
                                            key={r.id}
                                            reminder={r}
                                            clientName={r.clientId ? clientNameById.get(r.clientId) : undefined}
                                            overdue={isOverdue}
                                            onComplete={handleComplete}
                                            onSnooze={handleSnooze}
                                            onDelete={handleDelete}
                                            onRename={handleRename}
                                        />
                                    ))}
                                </div>
                            ),
                        )}
                        {groups.done.length > 0 && (
                            <div>
                                <button
                                    onClick={() => setShowDone((v) => !v)}
                                    className="flex w-full items-center gap-1 px-4 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground"
                                >
                                    Done ({groups.done.length})
                                    <ChevronDown className={cn('h-3 w-3 transition-transform', showDone && 'rotate-180')} />
                                </button>
                                {showDone && groups.done.map((r) => (
                                    <ReminderRow
                                        key={r.id}
                                        reminder={r}
                                        clientName={r.clientId ? clientNameById.get(r.clientId) : undefined}
                                        overdue={false}
                                        onComplete={handleComplete}
                                        onSnooze={handleSnooze}
                                        onDelete={handleDelete}
                                        onRename={handleRename}
                                    />
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Check the actual `Client` type field for the display name — if it is `businessName` or similar instead of `name`, adjust `clientNameById` and the picker rows accordingly.)

- [ ] **Step 4: Commit**

```bash
git add components/reminders/RemindersPanel.tsx components/reminders/ReminderRow.tsx
git commit -m "Add RemindersPanel with capture bar and grouped list"
```

---

### Task 7: Wiring — UserMenu, layout mount, bell integration

**Files:**
- Modify: `components/dashboard/UserMenu.tsx` (Personal Tools item + overdue dot)
- Modify: `app/(dashboard)/layout.tsx` (mount panel)
- Modify: `components/notifications/NotificationBell.tsx` (icon + click behavior for `reminder_due`)

**Interfaces:**
- Consumes: `RemindersPanel` and the `reminders:open` / `reminders:changed` events (Task 6); `countOverdueReminders` (Task 3).
- Produces: complete user-facing wiring; no new exports.

- [ ] **Step 1: UserMenu — add Reminders item and overdue dot**

In `components/dashboard/UserMenu.tsx`:

1. Add `AlarmClock` to the lucide-react import.
2. Add imports and state for the overdue count:

```tsx
import { useOrganization } from '@/components/providers/organization-provider';
import { countOverdueReminders } from '@/lib/supabase/personal-reminders';
```

Inside `UserMenu()`, after the existing hooks:

```tsx
  const { organization } = useOrganization();
  const { userId } = useCurrentMember();   // extend the existing destructure: { displayName, email, role, isLoading, userId }
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    if (!organization || !userId) return;
    const load = () => countOverdueReminders({ organizationId: organization.id, userId }).then(setOverdueCount);
    load();
    window.addEventListener('reminders:changed', load);
    return () => window.removeEventListener('reminders:changed', load);
  }, [organization, userId]);
```

(Check `useCurrentMember`'s return shape first — if it doesn't expose `userId`, look at how `NotepadPanel.tsx:15` gets it; it does `const { userId } = useCurrentMember();`, so the field exists.)

3. Add a red dot on the avatar button (inside the avatar `<button>`, after the initials span):

```tsx
        {overdueCount > 0 && (
          <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-red-500" />
        )}
```

Also add `relative` to the avatar button's className so the dot anchors correctly.

4. Add the menu item in Personal Tools, between Notepad and My Tasks:

```tsx
          <button onClick={() => fireEvent('reminders:open')} className={itemClass}>
            <AlarmClock className="h-4 w-4 text-muted-foreground" />
            Reminders
            {overdueCount > 0 && (
              <span className="ml-auto rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-400">
                {overdueCount}
              </span>
            )}
          </button>
```

- [ ] **Step 2: Layout — mount the panel**

In `app/(dashboard)/layout.tsx`:

```tsx
import { RemindersPanel } from '@/components/reminders/RemindersPanel';
```

and after the `NotepadPanel` mount:

```tsx
            {!isSetupPage && <RemindersPanel />}
```

- [ ] **Step 3: NotificationBell — render and route reminder_due**

In `components/notifications/NotificationBell.tsx` (2-space indent):

1. Add `AlarmClock` to the lucide-react import.
2. In `NotificationIcon`, before the fallback return:

```tsx
  if (type === 'reminder_due') return <AlarmClock className="h-4 w-4 text-primary" />;
```

3. In `NotificationRow`'s `handleClick`, handle reminders before the generic `router.push`:

```tsx
  const handleClick = () => {
    if (!notification.isRead) onRead(notification.id);
    if (notification.type === 'reminder_due') {
      if (notification.clientId) {
        router.push(`/workspace/${notification.clientId}`);
      } else {
        window.dispatchEvent(new CustomEvent('reminders:open'));
      }
      return;
    }
    router.push(buildUrl(notification));
  };
```

- [ ] **Step 4: Type-check and run all tests**

Run: `npx tsc --noEmit`
Expected: no errors.
Run: `node --test lib/*.test.ts`
Expected: all pass (existing seo-ops-logic tests + new reminders-logic tests).

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/UserMenu.tsx "app/(dashboard)/layout.tsx" components/notifications/NotificationBell.tsx
git commit -m "Wire Reminders into UserMenu, layout, and notification bell"
```

---

### Task 8: Browser verification

**Files:** none (verification only). Requires migration 025 applied to the database first — if it hasn't been pasted into the Supabase Dashboard yet, stop and flag that instead of debugging phantom errors.

- [ ] **Step 1: Start the dev server and sign in**

Start the dev server via the launch config / browser-pane preview. Carlos must sign in inside the browser pane at `localhost/login` (email + password form — do not use the address bar); confirm an `sb-*-auth-token` cookie exists before testing.

- [ ] **Step 2: Verify the flow**

1. UserMenu → Personal Tools → Reminders opens the panel; capture input is focused.
2. Type "Call Acme about Q3 report", open the date chip, type "tomorrow at 2pm" — parsed preview appears; Enter sets it. Chip shows the resolved time.
3. Pick a client from the client chip; set Notify to "10 minutes before"; press Enter in the title input — reminder appears under Upcoming.
4. Create a second reminder due "in 20 minutes" (preset). It appears under Today.
5. Complete a reminder → moves to Done (collapsed section shows count). Create a daily recurring reminder, complete it → it stays pending with tomorrow's date.
6. Snooze buttons update the due label. Delete asks "Sure?" then removes.
7. Manually hit the cron: open `localhost:3000/api/cron/fire-reminders` in the signed-in browser tab (GET is allowed for authenticated users). Response JSON shows `fired ≥ 1` for a reminder whose notify time has passed; the bell shows "Reminder: …" (realtime) and clicking it opens the client workspace (linked) or the panel (unlinked).
8. Check console/network for errors throughout.

- [ ] **Step 3: Final checks**

Run: `npx tsc --noEmit` and `node --test lib/*.test.ts`
Expected: clean. Then stop — merging to main and the Supabase SQL paste are Carlos-gated steps (Codex PR check first, per workflow).
