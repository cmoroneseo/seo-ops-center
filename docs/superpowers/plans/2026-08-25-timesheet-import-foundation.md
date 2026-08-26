# Timesheet Import Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get Abel's existing Basecamp time into the SEO PM ledger, quarantined and awaiting context, without ever creating a duplicate row.

**Architecture:** A server-side CSV fetch from Basecamp's timesheet report is the backfill transport; the existing webhook stays the ongoing path. CSV rows have no Basecamp entry id, so they carry an `import_fingerprint` instead, and a later webhook for the same entry *adopts* the fingerprinted row rather than inserting beside it. Project→client resolution moves out of the wrong `basecamp_timesheet_enabled` flag into an explicit `basecamp_project_roles` table.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase/Postgres/RLS, `node:test` via `tsx`.

## Global Constraints

- Tests use `node:test` + `node:assert/strict`, run with `npm test`. **Never vitest.**
- Test files import siblings with an explicit `.ts` extension (`from './x.ts'`).
- Migrations are numbered `migrations/0XX_name.sql` and **mirrored into `schema.sql`**.
- DB snake_case ↔ TS camelCase via `rowToX` mapper functions.
- Enums are Postgres text CHECK constraints, typed as TS string unions.
- Provider-controlled columns are service-role only, guarded by a trigger, per migrations 031/032/038.
- Never add `Co-Authored-By:` or any Anthropic trailer to a commit message.
- Run `npx tsc --noEmit` before every commit.
- Work on branch `feat/timesheet-import-review`. Never commit to `main`.

## Reference facts (measured 2026-08-25, do not re-derive)

- Abel Miranda: `users.id = c8219b94-acfe-400a-881e-ab56b7266644`, `basecamp_person_id = 39146116`.
- Production org: `51f63cc5-4c52-45ed-bb20-2d5ce6320bf2`.
- Abel's August 2026: **14 entries, 24.3 hours, 13 projects, 1 with a description, 0 linked to a to-do.**
- CSV endpoint (OAuth bearer, works on the **api** host):
  `https://3.basecampapi.com/{accountId}/reports/timesheet.csv?people_ids[]={personId}&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`
- CSV header: `Date,Person,Hours,Project,Item,Notes,Created`
- **Basecamp pagination trap:** `GET /projects/{id}/timesheet.json` returns the *same* entries on every page of its `Link` header. Any loop that follows `rel="next"` must stop when it revisits a URL.

---

### Task 1: Schema for import provenance and project roles

**Files:**
- Create: `migrations/039_timesheet_import_review.sql`
- Create: `lib/timesheets/import-migration.test.ts`
- Modify: `schema.sql` (append mirror), `lib/types.ts`

**Interfaces:**
- Consumes: migration 038's `time_logs.import_status`, `protect_time_log_import_provenance`.
- Produces: `import_status` values `'needs_context' | 'pending_review' | 'mapped' | 'voided'`; columns `activity_key`, `import_fingerprint`, `submitted_at/by`, `reviewed_at/by`, `review_note`; tables `basecamp_project_roles`, `timesheet_import_runs`; TS types `TimeLogImportStatus`, `BasecampProjectRole`, `TimesheetImportRun`.

- [ ] **Step 1: Write the failing migration test**

Create `lib/timesheets/import-migration.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const migrationUrl = new URL('../../migrations/039_timesheet_import_review.sql', import.meta.url);
const schemaUrl = new URL('../../schema.sql', import.meta.url);

function sources() {
    assert.ok(existsSync(migrationUrl), 'missing migration 039');
    return {
        migration: readFileSync(migrationUrl, 'utf8'),
        schema: readFileSync(schemaUrl, 'utf8'),
    };
}

test('migration 039 is additive only', () => {
    const { migration } = sources();
    assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
});

test('import_status gains the review states and drops needs_review', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /import_status in \('needs_context', 'pending_review', 'mapped', 'voided'\)/i,
        );
    }
    // Existing rows must be migrated, not stranded on a now-invalid value.
    assert.match(migration, /update public\.time_logs\s+set import_status = 'needs_context'\s+where import_status = 'needs_review'/i);
});

test('time_logs gains activity, fingerprint, and review columns', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /activity_key text/i);
        assert.match(sql, /import_fingerprint text/i);
        assert.match(sql, /submitted_at timestamp with time zone/i);
        assert.match(sql, /submitted_by uuid/i);
        assert.match(sql, /reviewed_at timestamp with time zone/i);
        assert.match(sql, /reviewed_by uuid/i);
        assert.match(sql, /review_note text/i);
    }
});

test('import_fingerprint has a partial unique index', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /create unique index if not exists time_logs_import_fingerprint_unique\s+on public\.time_logs \(import_fingerprint\)\s+where import_fingerprint is not null/i,
        );
    }
});

test('the provenance trigger covers the new provider columns', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(
            sql,
            /before insert or update of source, import_status, imported_at, provider_updated_at, voided_at, import_fingerprint/i,
        );
    }
});

test('basecamp_project_roles exists, is RLS scoped, and constrains role', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /create table if not exists public\.basecamp_project_roles/i);
        assert.match(sql, /role text not null check \(role in \('client', 'internal', 'ignored'\)\)/i);
        assert.match(sql, /basecamp_project_name text/i);
        assert.match(sql, /alter table public\.basecamp_project_roles\s+enable row level security/i);
        assert.match(
            sql,
            /create unique index if not exists basecamp_project_roles_unique\s+on public\.basecamp_project_roles \(organization_id, basecamp_project_id\)/i,
        );
    }
});

test('a client role must name a client', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /check \(role <> 'client' or client_id is not null\)/i);
    }
});

test('timesheet_import_runs records each backfill', () => {
    const { migration, schema } = sources();
    for (const sql of [migration, schema]) {
        assert.match(sql, /create table if not exists public\.timesheet_import_runs/i);
        assert.match(sql, /source text not null check \(source in \('csv', 'upload', 'webhook'\)\)/i);
        assert.match(sql, /scanned integer not null default 0/i);
        assert.match(sql, /imported integer not null default 0/i);
        assert.match(sql, /skipped integer not null default 0/i);
    }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/timesheets/import-migration.test.ts`
Expected: FAIL — `missing migration 039`.

- [ ] **Step 3: Write the migration**

Create `migrations/039_timesheet_import_review.sql`:

```sql
-- Migration 039: import context capture + review workflow
--
-- Adds the member-enrichment stage between "imported" and "counts". Also adds
-- CSV identity (import_fingerprint), because Basecamp's timesheet CSV export
-- carries no entry id, and an explicit project->client role table, replacing
-- the misused basecamp_timesheet_enabled push flag as the import gate.

-- ---------------------------------------------------------------------------
-- Review state machine
-- ---------------------------------------------------------------------------

-- Migrate existing rows before the constraint changes under them.
update public.time_logs
   set import_status = 'needs_context'
 where import_status = 'needs_review';

alter table public.time_logs
  drop constraint if exists time_logs_import_status_check;
alter table public.time_logs
  add constraint time_logs_import_status_check
  check (import_status in ('needs_context', 'pending_review', 'mapped', 'voided'));

alter table public.time_logs
  add column if not exists activity_key text;
alter table public.time_logs
  add column if not exists import_fingerprint text;
alter table public.time_logs
  add column if not exists submitted_at timestamp with time zone;
alter table public.time_logs
  add column if not exists submitted_by uuid references public.users(id) on delete set null;
alter table public.time_logs
  add column if not exists reviewed_at timestamp with time zone;
alter table public.time_logs
  add column if not exists reviewed_by uuid references public.users(id) on delete set null;
alter table public.time_logs
  add column if not exists review_note text;

-- CSV identity. Same role as time_logs_basecamp_entry_unique, for rows whose
-- provider id is not knowable at import time.
create unique index if not exists time_logs_import_fingerprint_unique
  on public.time_logs (import_fingerprint)
  where import_fingerprint is not null;

create index if not exists time_logs_import_queue_idx
  on public.time_logs (organization_id, user_id, import_status)
  where import_status in ('needs_context', 'pending_review');

-- Fingerprint is provider-derived, so it joins the service-only column set.
drop trigger if exists protect_time_log_import_provenance on public.time_logs;
create trigger protect_time_log_import_provenance
  before insert or update of source, import_status, imported_at, provider_updated_at, voided_at, import_fingerprint
  on public.time_logs
  for each row execute function public.protect_time_log_import_provenance();

-- ---------------------------------------------------------------------------
-- Project roles — the import gate
-- ---------------------------------------------------------------------------

create table if not exists public.basecamp_project_roles (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  basecamp_project_id bigint not null,
  basecamp_project_name text,
  role text not null check (role in ('client', 'internal', 'ignored')),
  client_id uuid references public.clients(id) on delete cascade,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint basecamp_project_roles_client_required
    check (role <> 'client' or client_id is not null)
);

create unique index if not exists basecamp_project_roles_unique
  on public.basecamp_project_roles (organization_id, basecamp_project_id);

-- CSV rows name their project rather than identifying it, so name lookup is a
-- first-class access path, not a convenience.
create index if not exists basecamp_project_roles_name_idx
  on public.basecamp_project_roles (organization_id, lower(basecamp_project_name));

alter table public.basecamp_project_roles enable row level security;

create policy "Org members can read basecamp project roles"
  on public.basecamp_project_roles for select
  using ( organization_id in (select get_user_org_ids()) );

revoke all on table public.basecamp_project_roles from public, anon;
grant select on table public.basecamp_project_roles to authenticated;
grant select, insert, update, delete on table public.basecamp_project_roles
  to service_role;

-- ---------------------------------------------------------------------------
-- Import run receipts
-- ---------------------------------------------------------------------------

create table if not exists public.timesheet_import_runs (
  id uuid default uuid_generate_v4() primary key,
  organization_id uuid references public.organizations(id) on delete cascade not null,
  requested_by uuid references public.users(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  range_start date not null,
  range_end date not null,
  source text not null check (source in ('csv', 'upload', 'webhook')),
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  scanned integer not null default 0,
  imported integer not null default 0,
  skipped integer not null default 0,
  error text,
  started_at timestamp with time zone default timezone('utc'::text, now()) not null,
  finished_at timestamp with time zone
);

create index if not exists timesheet_import_runs_org_idx
  on public.timesheet_import_runs (organization_id, started_at desc);

alter table public.timesheet_import_runs enable row level security;

create policy "Org members can read timesheet import runs"
  on public.timesheet_import_runs for select
  using ( organization_id in (select get_user_org_ids()) );

revoke all on table public.timesheet_import_runs from public, anon;
grant select on table public.timesheet_import_runs to authenticated;
grant select, insert, update, delete on table public.timesheet_import_runs
  to service_role;
```

- [ ] **Step 4: Mirror into schema.sql**

Run:

```bash
{ echo ""; echo "-- Migration 039: import context capture + review workflow"; sed -n '7,$p' migrations/039_timesheet_import_review.sql; } >> schema.sql
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test lib/timesheets/import-migration.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Update TypeScript types**

In `lib/types.ts`, replace the `TimeLogImportStatus` union:

```ts
/**
 * How far an imported row got.
 *   needs_context  — imported; the owning member must add an activity/client
 *   pending_review — member submitted; awaiting manager approval
 *   mapped         — approved; counts toward budgets and approvals
 *   voided         — gone at the provider, kept for financial history
 */
export type TimeLogImportStatus =
    | 'needs_context'
    | 'pending_review'
    | 'mapped'
    | 'voided';
```

Add to the `TimeLog` interface, after `voidedAt?: string;`:

```ts
    /** migration 039 — context capture and review */
    activityKey?: string;
    /** CSV identity, when the provider entry id is not knowable at import. */
    importFingerprint?: string;
    submittedAt?: string;
    submittedBy?: string;
    reviewedAt?: string;
    reviewedBy?: string;
    reviewNote?: string;
```

Add near the other Basecamp types:

```ts
export type BasecampProjectRoleKind = 'client' | 'internal' | 'ignored';

export interface BasecampProjectRole {
    id: string;
    organizationId: string;
    basecampProjectId: number;
    basecampProjectName?: string;
    role: BasecampProjectRoleKind;
    /** Required when role is 'client'. */
    clientId?: string;
    createdBy?: string;
    createdAt: string;
    updatedAt: string;
}

export type TimesheetImportSource = 'csv' | 'upload' | 'webhook';

export interface TimesheetImportRun {
    id: string;
    organizationId: string;
    requestedBy?: string;
    userId?: string;
    rangeStart: string;
    rangeEnd: string;
    source: TimesheetImportSource;
    status: 'running' | 'complete' | 'failed';
    scanned: number;
    imported: number;
    skipped: number;
    error?: string;
    startedAt: string;
    finishedAt?: string;
}
```

- [ ] **Step 7: Fix the now-stale `'needs_review'` references**

Run: `grep -rn "needs_review" --include="*.ts" --include="*.tsx" lib components app | grep -v "\.test\."`

For each hit in `lib/timesheets/`, `lib/basecamp/`, and `components/timesheets/`, replace the string `'needs_review'` with `'needs_context'`. Do **not** touch `TimeLogStatus` (`time_logs.status`), which independently has a `'needs_review'` value — only `import_status` comparisons change.

Then update the same string in these test files so they keep passing:
`lib/timesheets/ledger.test.ts`, `lib/timesheets/review.test.ts`,
`lib/basecamp/timesheet-webhook-route.test.ts`, `lib/basecamp/timesheet-import-merge.test.ts`,
`lib/timesheets/mapping.test.ts`, `lib/timesheets/team.test.ts`.

- [ ] **Step 8: Verify the whole suite and typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck silent, all tests pass.

- [ ] **Step 9: Commit**

```bash
git add migrations/039_timesheet_import_review.sql schema.sql lib/types.ts lib/timesheets lib/basecamp components/timesheets
git commit -m "feat: add timesheet import review schema"
```

---

### Task 2: Activity catalog with budget defaults

**Files:**
- Modify: `lib/scope-estimates.ts`
- Create: `lib/timesheets/activities.ts`, `lib/timesheets/activities.test.ts`

**Interfaces:**
- Consumes: `SEO_ACTIVITIES`, `ScopeActivity` from `lib/scope-estimates.ts`.
- Produces: `TIMESHEET_ACTIVITIES: TimesheetActivity[]`, `findActivity(key): TimesheetActivity | null`, `budgetDefaultFor(key): boolean`, `describeActivity(key, detail): string`.

The existing catalog is all client-facing delivery work. Meetings and internal
admin have to exist as choices, or every non-delivery hour gets mis-attributed
to a delivery activity just to clear the gate.

- [ ] **Step 1: Write the failing test**

Create `lib/timesheets/activities.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    TIMESHEET_ACTIVITIES,
    budgetDefaultFor,
    describeActivity,
    findActivity,
} from './activities.ts';

test('every SEO delivery activity is offered', () => {
    assert.ok(TIMESHEET_ACTIVITIES.length >= 28);
    assert.ok(findActivity('technical_audit'));
    assert.ok(findActivity('blog_post'));
});

test('delivery activities count toward the SEO budget', () => {
    assert.equal(budgetDefaultFor('technical_audit'), true);
    assert.equal(budgetDefaultFor('blog_post'), true);
    assert.equal(budgetDefaultFor('gbp_monthly'), true);
});

test('non-delivery activities exist and do not consume budget', () => {
    for (const key of ['client_meeting', 'internal_admin', 'account_management', 'training']) {
        const activity = findActivity(key);
        assert.ok(activity, `missing non-delivery activity ${key}`);
        assert.equal(activity.countsTowardBudget, false, key);
        assert.equal(budgetDefaultFor(key), false, key);
    }
});

test('an unknown activity key never silently bills a client', () => {
    assert.equal(findActivity('not_a_real_key'), null);
    assert.equal(budgetDefaultFor('not_a_real_key'), false);
    assert.equal(budgetDefaultFor(''), false);
});

test('activity keys are unique', () => {
    const keys = TIMESHEET_ACTIVITIES.map(activity => activity.key);
    assert.equal(new Set(keys).size, keys.length);
});

test('a description is the activity label, optionally refined by detail', () => {
    assert.equal(describeActivity('technical_audit', ''), 'Technical SEO Audit');
    assert.equal(
        describeActivity('technical_audit', 'Crawl budget on /products'),
        'Technical SEO Audit — Crawl budget on /products',
    );
    assert.equal(describeActivity('technical_audit', '   '), 'Technical SEO Audit');
});

test('detail alone is used when the key is unknown', () => {
    assert.equal(describeActivity('', 'Ad hoc fix'), 'Ad hoc fix');
    assert.equal(describeActivity('', ''), '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/timesheets/activities.test.ts`
Expected: FAIL — cannot find module `./activities.ts`.

- [ ] **Step 3: Implement the catalog wrapper**

Create `lib/timesheets/activities.ts`:

```ts
import { SEO_ACTIVITIES, type ScopeActivity } from '../scope-estimates.ts';

/**
 * The activity vocabulary a timesheet entry can be tagged with.
 *
 * Wraps the scope-estimates catalog rather than duplicating it, so capacity
 * planning and time tracking always name the same work the same way. The one
 * thing added here is budget semantics: choosing an activity answers both
 * "what was this?" and "does it consume the client's SEO hours?".
 */

export interface TimesheetActivity extends ScopeActivity {
    /** Default for time_logs.counts_toward_budget. Overridable per entry. */
    countsTowardBudget: boolean;
}

/**
 * Work that is tracked and often billable but must never eat deliverable
 * budget. The scope-estimates catalog has no equivalent because it models
 * contracted deliverables, not the whole working day.
 */
const NON_DELIVERY: TimesheetActivity[] = [
    {
        key: 'client_meeting', label: 'Client Meeting', category: 'Non-billable to budget',
        minHours: 0.5, maxHours: 1.5, frequency: 'monthly', countsTowardBudget: false,
    },
    {
        key: 'account_management', label: 'Account Management & Comms', category: 'Non-billable to budget',
        minHours: 0.25, maxHours: 1, frequency: 'monthly', countsTowardBudget: false,
    },
    {
        key: 'internal_admin', label: 'Internal Admin', category: 'Non-billable to budget',
        minHours: 0.25, maxHours: 2, frequency: 'monthly', countsTowardBudget: false,
    },
    {
        key: 'training', label: 'Training & Learning', category: 'Non-billable to budget',
        minHours: 0.5, maxHours: 4, frequency: 'monthly', countsTowardBudget: false,
    },
];

export const TIMESHEET_ACTIVITIES: TimesheetActivity[] = [
    ...SEO_ACTIVITIES.map(activity => ({ ...activity, countsTowardBudget: true })),
    ...NON_DELIVERY,
];

const BY_KEY = new Map(TIMESHEET_ACTIVITIES.map(activity => [activity.key, activity]));

export function findActivity(key: string): TimesheetActivity | null {
    return BY_KEY.get(key) ?? null;
}

/**
 * Budget default for an activity. An unrecognized key resolves to false —
 * failing closed, so a bad key can never silently bill a client.
 */
export function budgetDefaultFor(key: string): boolean {
    return findActivity(key)?.countsTowardBudget ?? false;
}

/** The human description stored on the ledger row. */
export function describeActivity(key: string, detail: string): string {
    const label = findActivity(key)?.label ?? '';
    const trimmed = detail.trim();
    if (!label) return trimmed;
    return trimmed ? `${label} — ${trimmed}` : label;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/timesheets/activities.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/timesheets/activities.ts lib/timesheets/activities.test.ts
git commit -m "feat: add timesheet activity vocabulary with budget defaults"
```

---

### Task 3: CSV parser and fingerprint identity

**Files:**
- Create: `lib/basecamp/timesheet-csv.ts`, `lib/basecamp/timesheet-csv.test.ts`

**Interfaces:**
- Produces: `parseTimesheetCsv(text): CsvTimesheetRow[]`, `fingerprintFor(row): string`, type `CsvTimesheetRow { date, person, hours, projectName, item, notes, created }`.

- [ ] **Step 1: Write the failing test**

Create `lib/basecamp/timesheet-csv.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimesheetCsv, fingerprintFor } from './timesheet-csv.ts';

const HEADER = 'Date,Person,Hours,Project,Item,Notes,Created';

test('parses a real Basecamp export row', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        '2026-08-16,Abel Miranda,2.0,The HR Innovator Group,,"Prepare notes for meeting, content pruning plan",2026-08-17T01:47:31Z',
    ].join('\n'));

    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
        date: '2026-08-16',
        person: 'Abel Miranda',
        hours: 2,
        projectName: 'The HR Innovator Group',
        item: '',
        notes: 'Prepare notes for meeting, content pruning plan',
        created: '2026-08-17T01:47:31Z',
    });
});

test('a quoted field may contain commas', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        '2026-08-01,Abel Miranda,1.0,"Acme, Inc.",,"a, b, c",2026-08-01T10:00:00Z',
    ].join('\n'));

    assert.equal(rows[0].projectName, 'Acme, Inc.');
    assert.equal(rows[0].notes, 'a, b, c');
});

test('a quoted field may contain escaped quotes', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        '2026-08-01,Abel Miranda,1.0,Acme,,"He said ""hi""",2026-08-01T10:00:00Z',
    ].join('\n'));

    assert.equal(rows[0].notes, 'He said "hi"');
});

test('empty notes and item are empty strings, never undefined', () => {
    const rows = parseTimesheetCsv([HEADER, '2026-08-03,Abel Miranda,0.5,SEO HQ,,"",2026-08-03T12:00:00Z'].join('\n'));

    assert.equal(rows[0].notes, '');
    assert.equal(rows[0].item, '');
});

test('project names containing the em dash and trademark survive', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        '2026-08-04,Abel Miranda,6.5,DH Construction Growth OS – Powered by the Empire Method™,,"",2026-08-04T09:00:00Z',
    ].join('\n'));

    assert.equal(rows[0].projectName, 'DH Construction Growth OS – Powered by the Empire Method™');
});

test('a header-only export yields no rows', () => {
    assert.deepEqual(parseTimesheetCsv(HEADER), []);
    assert.deepEqual(parseTimesheetCsv(''), []);
    assert.deepEqual(parseTimesheetCsv('   \n  '), []);
});

test('malformed rows are skipped rather than importing garbage', () => {
    const rows = parseTimesheetCsv([
        HEADER,
        'not,enough',
        '2026-08-01,Abel Miranda,notanumber,Acme,,"",2026-08-01T10:00:00Z',
        '2026-08-01,Abel Miranda,1.0,Acme,,"",2026-08-01T10:00:00Z',
    ].join('\n'));

    assert.equal(rows.length, 1);
    assert.equal(rows[0].hours, 1);
});

test('a trailing newline does not produce a phantom row', () => {
    const rows = parseTimesheetCsv([HEADER, '2026-08-01,Abel,1.0,Acme,,"",2026-08-01T10:00:00Z', ''].join('\n'));
    assert.equal(rows.length, 1);
});

test('fingerprint is stable and distinguishes every real August row', () => {
    const row = {
        date: '2026-08-06', person: 'Abel Miranda', hours: 4.5,
        projectName: 'Scott Cole Plumbing', item: '', notes: '',
        created: '2026-08-07T19:51:38Z',
    };
    assert.equal(fingerprintFor(row), fingerprintFor({ ...row }));
    assert.notEqual(fingerprintFor(row), fingerprintFor({ ...row, hours: 4.6 }));
    assert.notEqual(fingerprintFor(row), fingerprintFor({ ...row, created: '2026-08-07T19:51:39Z' }));
    assert.notEqual(fingerprintFor(row), fingerprintFor({ ...row, projectName: 'Other' }));
    assert.notEqual(fingerprintFor(row), fingerprintFor({ ...row, date: '2026-08-07' }));
});

test('fingerprint ignores fields a person can edit after the fact', () => {
    const row = {
        date: '2026-08-06', person: 'Abel Miranda', hours: 4.5,
        projectName: 'Scott Cole Plumbing', item: '', notes: '',
        created: '2026-08-07T19:51:38Z',
    };
    // Notes get edited in Basecamp; identity must survive that.
    assert.equal(fingerprintFor(row), fingerprintFor({ ...row, notes: 'added later' }));
});

test('fingerprint is a short hex digest', () => {
    const row = {
        date: '2026-08-06', person: 'Abel', hours: 1,
        projectName: 'P', item: '', notes: '', created: '2026-08-06T10:00:00Z',
    };
    assert.match(fingerprintFor(row), /^[0-9a-f]{32}$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/basecamp/timesheet-csv.test.ts`
Expected: FAIL — cannot find module `./timesheet-csv.ts`.

- [ ] **Step 3: Implement the parser**

Create `lib/basecamp/timesheet-csv.ts`:

```ts
import { createHash } from 'node:crypto';

/**
 * Basecamp timesheet CSV export.
 *
 * This is the accurate source for a backfill. The JSON endpoint
 * `/projects/{id}/timesheet.json` repeats its entries on every page of its
 * Link-header pagination, so a naive sweep multiplies hours; the CSV report
 * does not, and it filters by person and date range server-side.
 *
 * Its cost is identity: the export carries no entry id and names the project
 * rather than identifying it. `fingerprintFor` supplies a stand-in key.
 */

export interface CsvTimesheetRow {
    /** yyyy-MM-dd */
    date: string;
    person: string;
    hours: number;
    /** Display name only — Basecamp does not export the project id. */
    projectName: string;
    /** To-do title when the entry hangs off one; empty for project-level time. */
    item: string;
    notes: string;
    /** ISO instant the entry was created. Second-precision, effectively unique. */
    created: string;
}

const EXPECTED_FIELDS = 7;

/** Split one CSV line, honoring quoted fields and doubled escaped quotes. */
function splitLine(line: string): string[] {
    const fields: string[] = [];
    let current = '';
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
            if (quoted && line[index + 1] === '"') {
                current += '"';
                index += 1;
            } else {
                quoted = !quoted;
            }
        } else if (char === ',' && !quoted) {
            fields.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current);
    return fields;
}

export function parseTimesheetCsv(text: string): CsvTimesheetRow[] {
    const lines = text.split('\n').map(line => line.replace(/\r$/, ''));
    const rows: CsvTimesheetRow[] = [];

    for (const line of lines.slice(1)) {
        if (!line.trim()) continue;

        const fields = splitLine(line);
        if (fields.length < EXPECTED_FIELDS) continue;

        const hours = Number(fields[2]);
        // A row we cannot read is skipped, never imported as zero hours.
        if (!Number.isFinite(hours)) continue;

        rows.push({
            date: fields[0].trim(),
            person: fields[1].trim(),
            hours,
            projectName: fields[3].trim(),
            item: fields[4].trim(),
            notes: fields[5].trim(),
            created: fields[6].trim(),
        });
    }

    return rows;
}

/**
 * Stand-in identity for a CSV row.
 *
 * Deliberately excludes `notes` and `item`: both can be edited in Basecamp
 * after the fact, and an identity that changes when someone fixes a typo would
 * import a duplicate. Date + hours + project + created is unique across every
 * row measured, and `created` alone is near-unique.
 */
export function fingerprintFor(row: CsvTimesheetRow): string {
    const key = [row.person, row.projectName, row.date, row.hours, row.created].join('|');
    return createHash('sha256').update(key).digest('hex').slice(0, 32);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/basecamp/timesheet-csv.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/basecamp/timesheet-csv.ts lib/basecamp/timesheet-csv.test.ts
git commit -m "feat: parse Basecamp timesheet CSV exports"
```

---

### Task 4: Fingerprint adoption in the merge rule

**Files:**
- Modify: `lib/basecamp/timesheet-import-merge.ts`, `lib/basecamp/timesheet-import-merge.test.ts`

**Interfaces:**
- Consumes: `mergeImportedEntry(existing, incoming)`, `ExistingLedgerRow`, `MergedLedgerRow`.
- Produces: `ImportedEntryInput` gains optional `importFingerprint`; `MergedLedgerRow` gains `import_fingerprint` and `activity_key`; `ExistingLedgerRow` gains `activityKey` and `importFingerprint`.

A CSV backfill creates a row with a fingerprint and no entry id. When the
webhook later fires for that same entry, it must adopt the row and stamp the
entry id on — otherwise the ledger gets the entry twice under two identities.

- [ ] **Step 1: Write the failing tests**

Append to `lib/basecamp/timesheet-import-merge.test.ts`:

```ts
test('a CSV import carries its fingerprint and no entry id', () => {
    const merged = mergeImportedEntry(null, incoming({
        basecampEntryId: '', importFingerprint: 'abc123',
    }));

    assert.equal(merged.import_fingerprint, 'abc123');
    assert.equal(merged.basecamp_entry_id, null);
    assert.equal(merged.import_status, 'needs_context');
});

test('a webhook adopts a fingerprinted row and stamps the entry id', () => {
    const merged = mergeImportedEntry(
        existing({
            source: 'basecamp', importStatus: 'needs_context',
            importFingerprint: 'abc123', userId: 'user-abel', clientId: null,
        }),
        incoming({ basecampEntryId: '9001', importFingerprint: 'abc123' }),
    );

    assert.equal(merged.basecamp_entry_id, 9001);
    assert.equal(merged.import_fingerprint, 'abc123');
});

test('adoption never clears context a member already supplied', () => {
    const merged = mergeImportedEntry(
        existing({
            importStatus: 'pending_review', activityKey: 'technical_audit',
            clientId: 'client-a', userId: 'user-abel',
        }),
        incoming({ basecampEntryId: '9001' }),
    );

    assert.equal(merged.activity_key, 'technical_audit');
    assert.equal(merged.import_status, 'pending_review');
});

test('a provider edit does not drag an approved row back into review', () => {
    const merged = mergeImportedEntry(
        existing({ importStatus: 'mapped', activityKey: 'blog_post', clientId: 'client-a', userId: 'user-abel' }),
        incoming({ importStatus: 'needs_context', userId: null, clientId: null }),
    );

    assert.equal(merged.import_status, 'mapped');
});

test('a brand new webhook row with no fingerprint is unchanged', () => {
    const merged = mergeImportedEntry(null, incoming());

    assert.equal(merged.import_fingerprint, null);
    assert.equal(merged.basecamp_entry_id, 9001);
});
```

Update the two helpers at the top of that file so the new fields exist:

```ts
function incoming(overrides: Partial<ImportedEntryInput> = {}): ImportedEntryInput {
    return {
        basecampEntryId: '9001',
        basecampProjectId: '48599958',
        basecampRecordingId: '777',
        organizationId: 'org-1',
        clientId: 'client-a',
        taskId: null,
        userId: 'user-abel',
        date: '2026-08-24',
        hours: 1.5,
        description: 'Keyword mapping',
        importStatus: 'mapped',
        providerUpdatedAt: '2026-08-24T18:00:00Z',
        importedAt: '2026-08-24T18:05:00Z',
        importFingerprint: null,
        ...overrides,
    };
}

function existing(overrides: Partial<ExistingLedgerRow> = {}): ExistingLedgerRow {
    return {
        source: 'basecamp',
        importStatus: 'mapped',
        clientId: 'client-a',
        taskId: null,
        userId: 'user-abel',
        activityKey: null,
        importFingerprint: null,
        ...overrides,
    };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --import tsx --test lib/basecamp/timesheet-import-merge.test.ts`
Expected: FAIL — `importFingerprint` is not a known property.

- [ ] **Step 3: Extend the input type**

In `lib/basecamp/timesheet-webhook-route.ts`, add to `ImportedEntryInput`:

```ts
    /**
     * CSV identity, when the provider entry id is unknown. Null for webhook
     * imports, which always carry a real entry id.
     */
    importFingerprint: string | null;
```

And set it in `createTimesheetEntryImporter`'s call to `upsertImportedEntry`,
alongside `importedAt`:

```ts
            importFingerprint: null,
```

- [ ] **Step 4: Extend the merge rule**

Rewrite `lib/basecamp/timesheet-import-merge.ts`'s types and function body:

```ts
export interface ExistingLedgerRow {
    source: TimeLogSource;
    importStatus: TimeLogImportStatus;
    clientId: string | null;
    taskId: string | null;
    userId: string | null;
    activityKey: string | null;
    importFingerprint: string | null;
}

export interface MergedLedgerRow {
    organization_id: string;
    client_id: string | null;
    task_id: string | null;
    user_id: string | null;
    date: string;
    hours: number;
    description: string;
    status: 'logged';
    source: TimeLogSource;
    import_status: TimeLogImportStatus;
    activity_key: string | null;
    import_fingerprint: string | null;
    basecamp_entry_id: number | null;
    basecamp_project_id: number | null;
    basecamp_recording_id: number | null;
    basecamp_synced_at: string;
    basecamp_sync_error: null;
    imported_at: string;
    provider_updated_at: string | null;
    voided_at: null;
}

/** Statuses a provider update must never move a row away from. */
const MEMBER_OWNED: TimeLogImportStatus[] = ['pending_review', 'mapped'];

function numberOrNull(value: string): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function mergeImportedEntry(
    existing: ExistingLedgerRow | null,
    incoming: ImportedEntryInput,
): MergedLedgerRow {
    const clientId = existing?.clientId ?? incoming.clientId;
    const taskId = existing?.taskId ?? incoming.taskId;
    const userId = existing?.userId ?? incoming.userId;
    const activityKey = existing?.activityKey ?? null;

    const source: TimeLogSource = existing?.source ?? 'basecamp';

    // A member has already acted on these; a provider edit is not allowed to
    // undo that and send the row back to the queue.
    const importStatus: TimeLogImportStatus =
        existing && MEMBER_OWNED.includes(existing.importStatus)
            ? existing.importStatus
            : source === 'seo_pm'
                ? 'mapped'
                : (userId && clientId && activityKey) ? 'mapped' : 'needs_context';

    return {
        organization_id: incoming.organizationId,
        client_id: clientId,
        task_id: taskId,
        user_id: userId,
        date: incoming.date,
        hours: incoming.hours,
        description: incoming.description,
        status: 'logged',
        source,
        import_status: importStatus,
        activity_key: activityKey,
        // Adoption: keep whichever identity we already had, add the new one.
        import_fingerprint: existing?.importFingerprint ?? incoming.importFingerprint,
        basecamp_entry_id: numberOrNull(incoming.basecampEntryId),
        basecamp_project_id: numberOrNull(incoming.basecampProjectId),
        basecamp_recording_id: numberOrNull(incoming.basecampRecordingId),
        basecamp_synced_at: incoming.importedAt,
        basecamp_sync_error: null,
        imported_at: incoming.importedAt,
        provider_updated_at: incoming.providerUpdatedAt || null,
        voided_at: null,
    };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --import tsx --test lib/basecamp/timesheet-import-merge.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 6: Teach the store to look up by fingerprint**

In `lib/basecamp/timesheet-import-store.ts`, replace the lookup inside
`writeImportedEntry` so a fingerprint match is found when the entry id misses:

```ts
    const entryId = incomingEntryId(input);

    // Entry id first; fall back to the CSV fingerprint so a webhook adopts the
    // row a backfill already created instead of inserting beside it.
    let existing = entryId === null
        ? { data: null, error: null }
        : await admin
            .from('time_logs')
            .select('id, source, import_status, client_id, task_id, user_id, activity_key, import_fingerprint')
            .eq('basecamp_entry_id', entryId)
            .maybeSingle();
    if (existing.error) throw existing.error;

    if (!existing.data && input.importFingerprint) {
        existing = await admin
            .from('time_logs')
            .select('id, source, import_status, client_id, task_id, user_id, activity_key, import_fingerprint')
            .eq('import_fingerprint', input.importFingerprint)
            .maybeSingle();
        if (existing.error) throw existing.error;
    }
```

Add above `writeImportedEntry`:

```ts
function incomingEntryId(input: ImportedEntryInput): number | null {
    if (!input.basecampEntryId) return null;
    const parsed = Number(input.basecampEntryId);
    return Number.isFinite(parsed) ? parsed : null;
}
```

Then update the `mergeImportedEntry` call's existing-row mapping to carry the
two new fields:

```ts
            ? {
                source: existing.data.source ?? 'seo_pm',
                importStatus: existing.data.import_status ?? 'mapped',
                clientId: existing.data.client_id ?? null,
                taskId: existing.data.task_id ?? null,
                userId: existing.data.user_id ?? null,
                activityKey: existing.data.activity_key ?? null,
                importFingerprint: existing.data.import_fingerprint ?? null,
            }
```

And change the race-recovery update at the bottom, which currently keys on
`basecamp_entry_id`, to key on whichever identity exists:

```ts
    const recovery = admin.from('time_logs').update(row);
    const { error: updateError } = entryId !== null
        ? await recovery.eq('basecamp_entry_id', entryId)
        : await recovery.eq('import_fingerprint', input.importFingerprint ?? '');
    if (updateError) throw updateError;
    return 'updated';
```

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck silent, all tests pass.

```bash
git add lib/basecamp/timesheet-import-merge.ts lib/basecamp/timesheet-import-merge.test.ts lib/basecamp/timesheet-webhook-route.ts lib/basecamp/timesheet-import-store.ts
git commit -m "feat: adopt CSV-imported rows when the webhook arrives"
```

---

### Task 5: Project role resolution

**Files:**
- Create: `lib/basecamp/project-roles.ts`, `lib/basecamp/project-roles.test.ts`

**Interfaces:**
- Produces: `resolveProjectRole(roles, { projectId, projectName }): ProjectResolution`, types `ProjectRoleRecord`, `ProjectResolution`.

- [ ] **Step 1: Write the failing test**

Create `lib/basecamp/project-roles.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectRole, type ProjectRoleRecord } from './project-roles.ts';

const roles: ProjectRoleRecord[] = [
    { basecampProjectId: '46422132', basecampProjectName: '12 Volt Power', role: 'client', clientId: 'client-12v' },
    { basecampProjectId: '27062278', basecampProjectName: 'Marketing Empire Group HQ', role: 'internal', clientId: null },
    { basecampProjectId: '99999999', basecampProjectName: 'Dead Project', role: 'ignored', clientId: null },
];

test('a client project resolves to its client', () => {
    const result = resolveProjectRole(roles, { projectId: '46422132', projectName: '12 Volt Power' });

    assert.deepEqual(result, { kind: 'client', clientId: 'client-12v' });
});

test('an internal project resolves with no client', () => {
    const result = resolveProjectRole(roles, { projectId: '27062278', projectName: 'Marketing Empire Group HQ' });

    assert.deepEqual(result, { kind: 'internal', clientId: null });
});

test('an ignored project is skipped entirely', () => {
    const result = resolveProjectRole(roles, { projectId: '99999999', projectName: 'Dead Project' });

    assert.deepEqual(result, { kind: 'ignored', clientId: null });
});

test('an unknown project surfaces for a decision rather than being dropped', () => {
    const result = resolveProjectRole(roles, { projectId: '11111111', projectName: 'Superior Patios' });

    assert.deepEqual(result, { kind: 'unknown', clientId: null });
});

test('a CSV row with no project id resolves by name', () => {
    const result = resolveProjectRole(roles, { projectId: null, projectName: '12 Volt Power' });

    assert.deepEqual(result, { kind: 'client', clientId: 'client-12v' });
});

test('name matching ignores case and surrounding whitespace', () => {
    const result = resolveProjectRole(roles, { projectId: null, projectName: '  12 VOLT POWER ' });

    assert.deepEqual(result, { kind: 'client', clientId: 'client-12v' });
});

test('a project id wins over a conflicting name', () => {
    const result = resolveProjectRole(roles, { projectId: '27062278', projectName: '12 Volt Power' });

    assert.equal(result.kind, 'internal');
});

test('a name that matches nothing is unknown, never guessed to the nearest', () => {
    // "Pipe It Right" in the CSV vs client "Pipe It Right Plumbing" — close is
    // not good enough; a wrong client is worse than a review item.
    const result = resolveProjectRole(
        [{ basecampProjectId: '40889279', basecampProjectName: 'Pipe It Right Plumbing', role: 'client', clientId: 'client-pipe' }],
        { projectId: null, projectName: 'Pipe It Right' },
    );

    assert.equal(result.kind, 'unknown');
});

test('an empty roster resolves everything to unknown', () => {
    assert.equal(resolveProjectRole([], { projectId: '1', projectName: 'X' }).kind, 'unknown');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/basecamp/project-roles.test.ts`
Expected: FAIL — cannot find module `./project-roles.ts`.

- [ ] **Step 3: Implement resolution**

Create `lib/basecamp/project-roles.ts`:

```ts
import type { BasecampProjectRoleKind } from '../types.ts';

/**
 * Which Basecamp projects we import, and what their time means.
 *
 * Replaces `clients.custom_fields.basecamp_timesheet_enabled` as the import
 * gate. That flag is the *outbound push* opt-in; reusing it for import meant
 * every project a teammate actually logged to was silently skipped.
 *
 * Matching is exact. A CSV export names its project rather than identifying
 * it, and near-matches are dangerous — "Pipe It Right" and "Pipe It Right
 * Plumbing" may or may not be the same engagement. Unknown is a review item;
 * a wrong client is a billing error.
 */

export interface ProjectRoleRecord {
    basecampProjectId: string;
    basecampProjectName: string | null;
    role: BasecampProjectRoleKind;
    clientId: string | null;
}

export interface ProjectResolution {
    kind: BasecampProjectRoleKind | 'unknown';
    clientId: string | null;
}

const UNKNOWN: ProjectResolution = { kind: 'unknown', clientId: null };

function normalize(name: string | null): string {
    return (name ?? '').trim().toLowerCase();
}

export function resolveProjectRole(
    roles: ProjectRoleRecord[],
    lookup: { projectId: string | null; projectName: string },
): ProjectResolution {
    // The id is authoritative when we have one; the name is a CSV fallback.
    const match = (lookup.projectId
        && roles.find(role => role.basecampProjectId === lookup.projectId))
        || roles.find(role => normalize(role.basecampProjectName) === normalize(lookup.projectName));

    if (!match) return UNKNOWN;

    return {
        kind: match.role,
        clientId: match.role === 'client' ? match.clientId : null,
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/basecamp/project-roles.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/basecamp/project-roles.ts lib/basecamp/project-roles.test.ts
git commit -m "feat: resolve Basecamp projects to client or internal roles"
```

---

### Task 6: Fix the pagination trap

**Files:**
- Modify: `lib/basecamp/api.ts`
- Create: `lib/basecamp/pagination.ts`, `lib/basecamp/pagination.test.ts`

**Interfaces:**
- Produces: `nextPageUrl(linkHeader, seen): string | null`.

`GET /projects/{id}/timesheet.json` returns the same entries on every page of
its `Link` header, so following `rel="next"` multiplies every entry by its page
count. Every existing loop in `api.ts` has this bug.

- [ ] **Step 1: Write the failing test**

Create `lib/basecamp/pagination.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPageUrl } from './pagination.ts';

test('a normal next link advances', () => {
    const seen = new Set<string>(['https://x/page1']);
    assert.equal(
        nextPageUrl('<https://x/page2>; rel="next"', seen),
        'https://x/page2',
    );
});

test('a repeated URL terminates instead of looping', () => {
    // Basecamp's project timesheet endpoint does exactly this, and following
    // it multiplies every entry by the page count.
    const seen = new Set<string>(['https://x/page2']);
    assert.equal(nextPageUrl('<https://x/page2>; rel="next"', seen), null);
});

test('a missing or empty header ends pagination', () => {
    assert.equal(nextPageUrl(null, new Set()), null);
    assert.equal(nextPageUrl('', new Set()), null);
});

test('a header without a next relation ends pagination', () => {
    assert.equal(nextPageUrl('<https://x/page1>; rel="prev"', new Set()), null);
});

test('the next relation is found among several relations', () => {
    assert.equal(
        nextPageUrl('<https://x/p1>; rel="prev", <https://x/p3>; rel="next"', new Set()),
        'https://x/p3',
    );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/basecamp/pagination.test.ts`
Expected: FAIL — cannot find module `./pagination.ts`.

- [ ] **Step 3: Implement it**

Create `lib/basecamp/pagination.ts`:

```ts
/**
 * Basecamp Link-header pagination, with a cycle guard.
 *
 * Measured 2026-08-25: `GET /projects/{id}/timesheet.json` returns the *same*
 * entries on every page and keeps advertising a `rel="next"` that points back
 * at a URL already fetched. A loop that trusts the header multiplies every
 * entry by its page count — one 4.5h entry read as three.
 *
 * Callers pass the set of URLs already fetched; revisiting one ends paging.
 */
export function nextPageUrl(
    linkHeader: string | null,
    seen: ReadonlySet<string>,
): string | null {
    if (!linkHeader) return null;

    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    if (!match) return null;

    const url = match[1];
    return seen.has(url) ? null : url;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/basecamp/pagination.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Adopt it in every paginating call**

In `lib/basecamp/api.ts`, add the import:

```ts
import { nextPageUrl } from './pagination';
```

Then in each of `findProjectTimesheetRecordingId`,
`getBasecampProjectTimesheetEntry`, `listBasecampProjectTimesheetEntries`, and
`listBasecampTimesheetEntryStubs`, track visited URLs and use the guard. For
example, `listBasecampTimesheetEntryStubs` becomes:

```ts
export async function listBasecampTimesheetEntryStubs(
    projectId: number | string,
    maxPages = 20,
): Promise<{ id: string; date: string }[] | 'unavailable'> {
    try {
        const pid = safeId(projectId, 'projectId');
        const stubs: { id: string; date: string }[] = [];
        const seen = new Set<string>();
        let url: string | null = `${BASE_URL()}/projects/${pid}/timesheet.json`;

        for (let page = 0; url && page < maxPages; page += 1) {
            seen.add(url);
            const res: Response = await basecampFetch(url);
            if (!res.ok) return 'unavailable';
            const entries = await res.json() as BasecampTimesheetEntry[];
            stubs.push(...entries.map(entry => ({ id: String(entry.id), date: entry.date })));
            url = nextPageUrl(res.headers.get('Link'), seen);
        }
        return stubs;
    } catch (err) {
        console.error('[Basecamp] listTimesheetEntryStubs error:', err);
        return 'unavailable';
    }
}
```

Apply the same `seen` set + `nextPageUrl` pattern to the other three functions,
replacing their `parseNextLink(...)` calls. Leave `parseNextLink` in place for
any non-timesheet caller.

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck silent, all tests pass.

```bash
git add lib/basecamp/pagination.ts lib/basecamp/pagination.test.ts lib/basecamp/api.ts
git commit -m "fix: stop Basecamp timesheet pagination from repeating entries"
```

---

### Task 7: CSV backfill route

**Files:**
- Create: `lib/timesheets/backfill.ts`, `lib/timesheets/backfill.test.ts`
- Create: `app/api/timesheets/import/backfill/route.ts`
- Create: `lib/supabase/timesheet-imports.ts`
- Modify: `lib/basecamp/api.ts` (add `fetchTimesheetCsv`)

**Interfaces:**
- Consumes: `parseTimesheetCsv`, `fingerprintFor`, `resolveProjectRole`, `createTimesheetEntryImporter`'s store shape.
- Produces: `createCsvBackfill(dependencies)` returning `(request: BackfillRequest) => Promise<BackfillOutcome>`.

- [ ] **Step 1: Write the failing test**

Create `lib/timesheets/backfill.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCsvBackfill, type BackfillDependencies } from './backfill.ts';
import type { ImportedEntryInput } from '../basecamp/timesheet-webhook-route.ts';

const HEADER = 'Date,Person,Hours,Project,Item,Notes,Created';
const CSV = [
    HEADER,
    '2026-08-06,Abel Miranda,4.5,Scott Cole Plumbing,,"",2026-08-07T19:51:38Z',
    '2026-08-07,Abel Miranda,1.0,Marketing Empire Group HQ,,"",2026-08-07T19:51:46Z',
    '2026-08-06,Abel Miranda,0.4,Superior Patios,,"",2026-08-07T19:51:28Z',
    '2026-08-01,Abel Miranda,2.0,Dead Project,,"",2026-08-01T10:00:00Z',
].join('\n');

function harness(options: { csv?: string | 'unavailable'; manager?: boolean } = {}) {
    const written: ImportedEntryInput[] = [];
    const runs: { id: string; patch: Record<string, unknown> }[] = [];

    const dependencies: BackfillDependencies = {
        now: () => '2026-08-25T12:00:00Z',
        async authorize() {
            return options.manager === false
                ? { ok: false, status: 403, error: 'Forbidden' }
                : {
                    ok: true,
                    organizationId: 'org-1',
                    actorUserId: 'user-carlos',
                    targetUserId: 'user-abel',
                    basecampPersonId: '39146116',
                };
        },
        async listProjectRoles() {
            return [
                { basecampProjectId: '38327950', basecampProjectName: 'Scott Cole Plumbing', role: 'client', clientId: 'client-scott' },
                { basecampProjectId: '27062278', basecampProjectName: 'Marketing Empire Group HQ', role: 'internal', clientId: null },
                { basecampProjectId: '99999999', basecampProjectName: 'Dead Project', role: 'ignored', clientId: null },
            ];
        },
        async fetchCsv() {
            return options.csv ?? CSV;
        },
        async startRun() { return { id: 'run-1' }; },
        async finishRun(id, patch) { runs.push({ id, patch }); },
        async upsertImportedEntry(input) {
            written.push(input);
            return 'created';
        },
    };

    return { written, runs, backfill: createCsvBackfill(dependencies) };
}

const request = { userId: 'user-abel', from: '2026-08-01', to: '2026-08-31' };

test('a client project imports against its client', async () => {
    const { backfill, written } = harness();
    const outcome = await backfill(request);

    assert.equal(outcome.status, 200);
    const scott = written.find(entry => entry.hours === 4.5);
    assert.equal(scott?.clientId, 'client-scott');
    assert.equal(scott?.importStatus, 'needs_context');
    assert.equal(scott?.userId, 'user-abel');
});

test('an internal project imports with no client', async () => {
    const { backfill, written } = harness();
    await backfill(request);

    const hq = written.find(entry => entry.hours === 1);
    assert.equal(hq?.clientId, null);
    assert.equal(hq?.importStatus, 'needs_context');
});

test('an unknown project still imports, for a human decision', async () => {
    const { backfill, written } = harness();
    await backfill(request);

    const patios = written.find(entry => entry.hours === 0.4);
    assert.ok(patios, 'unknown project must not be silently dropped');
    assert.equal(patios.clientId, null);
});

test('an ignored project is skipped', async () => {
    const { backfill, written } = harness();
    await backfill(request);

    assert.equal(written.find(entry => entry.hours === 2), undefined);
});

test('every imported row carries a fingerprint and no entry id', async () => {
    const { backfill, written } = harness();
    await backfill(request);

    for (const entry of written) {
        assert.match(entry.importFingerprint ?? '', /^[0-9a-f]{32}$/);
        assert.equal(entry.basecampEntryId, '');
    }
});

test('the run receipt records scanned, imported, and skipped', async () => {
    const { backfill, runs } = harness();
    await backfill(request);

    assert.deepEqual(runs[0].patch, {
        status: 'complete', scanned: 4, imported: 3, skipped: 1, error: null,
    });
});

test('a non-manager never reaches Basecamp', async () => {
    const { backfill, written } = harness({ manager: false });
    const outcome = await backfill(request);

    assert.equal(outcome.status, 403);
    assert.deepEqual(written, []);
});

test('a malformed range is rejected before any work', async () => {
    const { backfill, written } = harness();

    assert.equal((await backfill({ ...request, from: 'August' })).status, 400);
    assert.equal((await backfill({ ...request, to: '2026-07-01' })).status, 400);
    assert.deepEqual(written, []);
});

test('a provider outage fails the run rather than reporting success', async () => {
    const { backfill, runs } = harness({ csv: 'unavailable' });
    const outcome = await backfill(request);

    assert.equal(outcome.status, 503);
    assert.equal(runs[0].patch.status, 'failed');
});

test('re-running is safe because identity comes from the fingerprint', async () => {
    const { backfill, written } = harness();
    await backfill(request);
    await backfill(request);

    const fingerprints = written.map(entry => entry.importFingerprint);
    assert.equal(new Set(fingerprints).size, 3);
    assert.equal(written.length, 6);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/timesheets/backfill.test.ts`
Expected: FAIL — cannot find module `./backfill.ts`.

- [ ] **Step 3: Implement the backfill**

Create `lib/timesheets/backfill.ts`:

```ts
import { fingerprintFor, parseTimesheetCsv } from '../basecamp/timesheet-csv.ts';
import { resolveProjectRole, type ProjectRoleRecord } from '../basecamp/project-roles.ts';
import type { ImportedEntryInput } from '../basecamp/timesheet-webhook-route.ts';

/**
 * Historical import from Basecamp's timesheet CSV report.
 *
 * One request per person and date range, rather than sweeping every project —
 * the report filters server-side, and the JSON alternative repeats its entries
 * across pages (see lib/basecamp/pagination.ts).
 *
 * Every row lands as `needs_context`. Nothing imported here counts toward a
 * client's budget until a member supplies an activity and a manager approves.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface BackfillRequest {
    userId: string;
    from: string;
    to: string;
}

export type BackfillAuthorization =
    | {
        ok: true;
        organizationId: string;
        actorUserId: string;
        targetUserId: string;
        basecampPersonId: string;
    }
    | { ok: false; status: number; error: string };

export interface BackfillDependencies {
    now(): string;
    authorize(userId: string): Promise<BackfillAuthorization>;
    listProjectRoles(organizationId: string): Promise<ProjectRoleRecord[]>;
    fetchCsv(input: {
        personId: string;
        from: string;
        to: string;
    }): Promise<string | 'unavailable'>;
    startRun(input: {
        organizationId: string;
        requestedBy: string;
        userId: string;
        from: string;
        to: string;
    }): Promise<{ id: string }>;
    finishRun(id: string, patch: Record<string, unknown>): Promise<void>;
    upsertImportedEntry(input: ImportedEntryInput): Promise<'created' | 'updated'>;
}

export interface BackfillOutcome {
    status: number;
    body: unknown;
}

export function createCsvBackfill(dependencies: BackfillDependencies) {
    return async function backfill(request: BackfillRequest): Promise<BackfillOutcome> {
        if (!DATE_ONLY.test(request.from) || !DATE_ONLY.test(request.to)) {
            return { status: 400, body: { error: 'from and to must be yyyy-MM-dd dates' } };
        }
        if (request.from > request.to) {
            return { status: 400, body: { error: 'from must not be after to' } };
        }

        const authorization = await dependencies.authorize(request.userId);
        if (!authorization.ok) {
            return { status: authorization.status, body: { error: authorization.error } };
        }

        const run = await dependencies.startRun({
            organizationId: authorization.organizationId,
            requestedBy: authorization.actorUserId,
            userId: authorization.targetUserId,
            from: request.from,
            to: request.to,
        });

        const csv = await dependencies.fetchCsv({
            personId: authorization.basecampPersonId,
            from: request.from,
            to: request.to,
        });
        if (csv === 'unavailable') {
            await dependencies.finishRun(run.id, {
                status: 'failed', scanned: 0, imported: 0, skipped: 0,
                error: 'Basecamp timesheet report unavailable',
            });
            return { status: 503, body: { error: 'Basecamp timesheet report unavailable' } };
        }

        const roles = await dependencies.listProjectRoles(authorization.organizationId);
        const rows = parseTimesheetCsv(csv);
        const importedAt = dependencies.now();

        let imported = 0;
        let skipped = 0;

        for (const row of rows) {
            const resolution = resolveProjectRole(roles, {
                projectId: null,
                projectName: row.projectName,
            });
            if (resolution.kind === 'ignored') {
                skipped += 1;
                continue;
            }

            await dependencies.upsertImportedEntry({
                // The CSV carries no ids at all; fingerprint is the identity.
                basecampEntryId: '',
                basecampProjectId: '',
                basecampRecordingId: '',
                organizationId: authorization.organizationId,
                clientId: resolution.clientId,
                taskId: null,
                userId: authorization.targetUserId,
                date: row.date,
                hours: row.hours,
                // Basecamp's own notes, kept verbatim. 13 of 14 are empty —
                // that is exactly what the review queue exists to fix.
                description: row.notes,
                importStatus: 'needs_context',
                providerUpdatedAt: row.created,
                importedAt,
                importFingerprint: fingerprintFor(row),
            });
            imported += 1;
        }

        await dependencies.finishRun(run.id, {
            status: 'complete', scanned: rows.length, imported, skipped, error: null,
        });

        return {
            status: 200,
            body: { ok: true, runId: run.id, scanned: rows.length, imported, skipped },
        };
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/timesheets/backfill.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Add the CSV fetch to the Basecamp client**

In `lib/basecamp/api.ts`, add:

```ts
/**
 * Fetch the timesheet report as CSV for one person and date range.
 *
 * The CSV lives on the API host and accepts the OAuth bearer, so no manual
 * download is needed. It is also more accurate than the JSON project endpoint,
 * which repeats entries across pages.
 */
export async function fetchTimesheetCsv(input: {
    personId: string;
    from: string;
    to: string;
}): Promise<string | 'unavailable'> {
    try {
        const person = safeId(input.personId, 'personId');
        const query = new URLSearchParams({
            start_date: input.from,
            end_date: input.to,
        });
        query.append('people_ids[]', person);

        const res = await basecampFetch(`${BASE_URL()}/reports/timesheet.csv?${query}`);
        if (!res.ok) return 'unavailable';
        return await res.text();
    } catch (err) {
        console.error('[Basecamp] fetchTimesheetCsv error:', err);
        return 'unavailable';
    }
}
```

- [ ] **Step 6: Add the Supabase adapters**

Create `lib/supabase/timesheet-imports.ts`:

```ts
import { createAdminClient } from './admin';
import type { ProjectRoleRecord } from '@/lib/basecamp/project-roles';

/** Service-role adapters for the import pipeline. */

export async function listProjectRoles(
    organizationId: string,
): Promise<ProjectRoleRecord[]> {
    const { data, error } = await createAdminClient()
        .from('basecamp_project_roles')
        .select('basecamp_project_id, basecamp_project_name, role, client_id')
        .eq('organization_id', organizationId);
    if (error) throw error;

    return (data ?? []).map(row => ({
        basecampProjectId: String(row.basecamp_project_id),
        basecampProjectName: row.basecamp_project_name ?? null,
        role: row.role,
        clientId: row.client_id ?? null,
    }));
}

export async function startImportRun(input: {
    organizationId: string;
    requestedBy: string;
    userId: string;
    from: string;
    to: string;
}): Promise<{ id: string }> {
    const { data, error } = await createAdminClient()
        .from('timesheet_import_runs')
        .insert({
            organization_id: input.organizationId,
            requested_by: input.requestedBy,
            user_id: input.userId,
            range_start: input.from,
            range_end: input.to,
            source: 'csv',
            status: 'running',
        })
        .select('id')
        .single();
    if (error) throw error;
    return { id: data.id };
}

export async function finishImportRun(
    id: string,
    patch: Record<string, unknown>,
): Promise<void> {
    const { error } = await createAdminClient()
        .from('timesheet_import_runs')
        .update({ ...patch, finished_at: new Date().toISOString() })
        .eq('id', id);
    if (error) throw error;
}
```

- [ ] **Step 7: Wire the route**

Create `app/api/timesheets/import/backfill/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchTimesheetCsv } from '@/lib/basecamp/api';
import { createCsvBackfill } from '@/lib/timesheets/backfill';
import { createTimesheetImportStore } from '@/lib/basecamp/timesheet-import-store';
import {
    finishImportRun,
    listProjectRoles,
    startImportRun,
} from '@/lib/supabase/timesheet-imports';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const store = createTimesheetImportStore();

/**
 * POST /api/timesheets/import/backfill
 * Body: { organizationId, userId, from, to }
 *
 * Manager-only historical import from Basecamp's timesheet CSV report.
 * Idempotent: identity is the row fingerprint, so re-running never duplicates.
 */
export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const input = (body ?? {}) as Record<string, unknown>;
    const organizationId = typeof input.organizationId === 'string' ? input.organizationId : '';

    const backfill = createCsvBackfill({
        now: () => new Date().toISOString(),

        async authorize(userId) {
            const member = await requireOrganizationMember(organizationId);
            if (!member.ok) return { ok: false, status: member.status, error: member.error };
            if (!member.isManager) return { ok: false, status: 403, error: 'Forbidden' };

            const { data, error } = await createAdminClient()
                .from('organization_members')
                .select('basecamp_person_id')
                .eq('organization_id', member.organizationId)
                .eq('user_id', userId)
                .maybeSingle();
            if (error) return { ok: false, status: 500, error: 'Unable to read member' };
            if (!data?.basecamp_person_id) {
                return { ok: false, status: 400, error: 'That member has no Basecamp person linked' };
            }

            return {
                ok: true,
                organizationId: member.organizationId,
                actorUserId: member.userId,
                targetUserId: userId,
                basecampPersonId: String(data.basecamp_person_id),
            };
        },

        listProjectRoles,
        fetchCsv: fetchTimesheetCsv,
        startRun: startImportRun,
        finishRun: finishImportRun,
        upsertImportedEntry: store.upsertImportedEntry,
    });

    const outcome = await backfill({
        userId: typeof input.userId === 'string' ? input.userId : '',
        from: typeof input.from === 'string' ? input.from : '',
        to: typeof input.to === 'string' ? input.to : '',
    });

    return NextResponse.json(outcome.body, { status: outcome.status });
}
```

- [ ] **Step 8: Verify and commit**

Run: `npx tsc --noEmit && npm test && npx eslint lib/timesheets lib/basecamp app/api/timesheets`
Expected: typecheck silent, all tests pass, no lint errors.

```bash
git add lib/timesheets/backfill.ts lib/timesheets/backfill.test.ts lib/supabase/timesheet-imports.ts app/api/timesheets/import/backfill lib/basecamp/api.ts
git commit -m "feat: backfill Basecamp time from the timesheet CSV report"
```

---

### Task 8: Apply the migration and verify against real data

**Files:** none — this task is operational.

- [ ] **Step 1: Apply migration 039**

Copy the migration to the clipboard:

```bash
cat migrations/039_timesheet_import_review.sql | pbcopy
```

Paste into the Supabase SQL editor and run. It needs superuser for the trigger.

- [ ] **Step 2: Verify the migration landed**

Paste into the Supabase SQL editor:

```sql
select 'column' as kind, column_name as name
from information_schema.columns
where table_name = 'time_logs'
  and column_name in ('activity_key','import_fingerprint','submitted_at','submitted_by','reviewed_at','reviewed_by','review_note')
union all
select 'table', table_name from information_schema.tables
where table_name in ('basecamp_project_roles','timesheet_import_runs')
union all
select 'index', indexname from pg_indexes
where indexname = 'time_logs_import_fingerprint_unique'
order by kind, name;
```

Expected: 10 rows — 7 columns, 2 tables, 1 index.

- [ ] **Step 3: Seed the project roles**

Abel's August spans 13 projects. Paste into the Supabase SQL editor, replacing
each `<client-uuid>` with the real id from the `clients` table:

```sql
insert into public.basecamp_project_roles
  (organization_id, basecamp_project_id, basecamp_project_name, role, client_id)
values
  ('51f63cc5-4c52-45ed-bb20-2d5ce6320bf2', 27062278, 'Marketing Empire Group HQ', 'internal', null),
  ('51f63cc5-4c52-45ed-bb20-2d5ce6320bf2', 33406469, 'SEO HQ', 'internal', null)
on conflict (organization_id, basecamp_project_id) do nothing;
```

Client projects are added the same way with `role = 'client'` and a
`client_id`. Any project left out imports as unknown and surfaces in the review
queue — which is the intended fallback, so this seed does not need to be
exhaustive.

- [ ] **Step 4: Run the backfill for Abel's August**

With the app running (`npm run dev`) and signed in as an owner, from the browser
console:

```js
await fetch('/api/timesheets/import/backfill', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    organizationId: '51f63cc5-4c52-45ed-bb20-2d5ce6320bf2',
    userId: 'c8219b94-acfe-400a-881e-ab56b7266644',
    from: '2026-08-01',
    to: '2026-08-31',
  }),
}).then(r => r.json());
```

Expected: `{ ok: true, scanned: 14, imported: <14 minus ignored>, skipped: <ignored> }`.

- [ ] **Step 5: Verify no duplicates and correct quarantine**

Paste into the Supabase SQL editor:

```sql
select import_status, count(*), sum(hours)
from public.time_logs
where user_id = 'c8219b94-acfe-400a-881e-ab56b7266644'
  and date between '2026-08-01' and '2026-08-31'
group by import_status;

-- Must return zero rows: fingerprints are unique by construction.
select import_fingerprint, count(*)
from public.time_logs
where import_fingerprint is not null
group by import_fingerprint having count(*) > 1;
```

Expected: all rows `needs_context`, total hours ≈ 24.3 minus ignored projects,
and no duplicate fingerprints.

- [ ] **Step 6: Re-run the backfill and confirm idempotency**

Repeat Step 4 verbatim, then re-run the first query from Step 5. Row count and
total hours must be **unchanged**.

- [ ] **Step 7: Confirm the ledger still excludes quarantined time**

Open `/timesheets`, switch the member filter to Abel, and navigate to the week
of 2026-08-03. The imported rows appear grouped under review, and the SEO budget
tile does **not** include them.

- [ ] **Step 8: Commit any fixes surfaced by verification**

```bash
git add -A
git commit -m "fix: corrections from backfill verification"
```

---

## What this plan does not do

Members cannot yet add context, and nothing can move out of `needs_context`.
That is Plan 2 (`2026-08-25-timesheet-import-review-workflow.md`). After this
plan, the data is in the ledger, correctly quarantined, and provably free of
duplicates — which is exactly the state Plan 2 builds the review UI on.
