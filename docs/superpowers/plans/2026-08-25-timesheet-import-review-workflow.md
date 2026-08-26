# Timesheet Import Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Abel add context to imported time in a few minutes, then let a manager approve it into the ledger.

**Architecture:** Imported rows sit at `needs_context` in `time_logs`. A member picks an activity (which also sets budget eligibility) and a client, then submits the batch to `pending_review`. A manager approves rows to `mapped` — the only state that counts toward budgets — or bounces them back with a reason. All state transitions are pure functions; routes only authorize and persist.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind v4, lucide-react, Supabase, `node:test` via `tsx`.

**Depends on:** `2026-08-25-timesheet-import-foundation.md` — do not start until migration 039 is applied and Abel's August is imported and quarantined.

## Global Constraints

- Tests use `node:test` + `node:assert/strict`, run with `npm test`. **Never vitest.**
- Test files import siblings with an explicit `.ts` extension (`from './x.ts'`).
- DB snake_case ↔ TS camelCase via `rowToX` mapper functions.
- Member-level privacy is enforced **server-side**. Org-scoped RLS cannot express "your own rows only", so never rely on it for that.
- Tailwind semantic tokens only (`bg-card`, `text-muted-foreground`, `border-border`, `text-primary`). Never hard-coded hex.
- `--primary` is already the magenta from the approved visual. Amber (`text-amber-500`) is reserved for items needing a human decision.
- Never add `Co-Authored-By:` or any Anthropic trailer to a commit message.
- Run `npx tsc --noEmit` before every commit.
- Work on branch `feat/timesheet-import-review`. Never commit to `main`.

## Reference facts (measured 2026-08-25, do not re-derive)

- Abel's August 2026: **14 entries, 24.3 hours, 13 projects, 1 with a description, 0 linked to a to-do.**
- Therefore: `no_activity` will fire on ~13 of 14 rows. `no_task_link` would fire on 14 of 14, which is why it is advisory and never blocks.
- Abel: `users.id = c8219b94-acfe-400a-881e-ab56b7266644`.
- Production org: `51f63cc5-4c52-45ed-bb20-2d5ce6320bf2`.

---

### Task 1: Issue derivation

**Files:**
- Create: `lib/timesheets/import-issues.ts`, `lib/timesheets/import-issues.test.ts`

**Interfaces:**
- Produces: `deriveIssues(row): ImportIssue[]`, `isReadyToSubmit(row): boolean`, types `ImportIssue`, `ReviewableRow`.

Issues are computed on read, never stored — the same compute-on-read rule as
`lib/seo-ops-logic.ts`. A stored flag would drift the moment anything changed.

- [ ] **Step 1: Write the failing test**

Create `lib/timesheets/import-issues.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveIssues, isReadyToSubmit, type ReviewableRow } from './import-issues.ts';

function row(overrides: Partial<ReviewableRow> = {}): ReviewableRow {
    return {
        id: 'log-1',
        clientId: 'client-a',
        isInternal: false,
        activityKey: 'technical_audit',
        taskId: 'task-1',
        importStatus: 'needs_context',
        ...overrides,
    };
}

test('a complete row has no issues and can be submitted', () => {
    assert.deepEqual(deriveIssues(row()), []);
    assert.equal(isReadyToSubmit(row()), true);
});

test('a missing client is an issue', () => {
    assert.deepEqual(deriveIssues(row({ clientId: null })), ['no_client']);
    assert.equal(isReadyToSubmit(row({ clientId: null })), false);
});

test('explicitly internal work needs no client', () => {
    const internal = row({ clientId: null, isInternal: true });

    assert.deepEqual(deriveIssues(internal), []);
    assert.equal(isReadyToSubmit(internal), true);
});

test('a missing activity is an issue — this is the common case', () => {
    assert.deepEqual(deriveIssues(row({ activityKey: null })), ['no_activity']);
    assert.equal(isReadyToSubmit(row({ activityKey: null })), false);
});

test('an empty-string activity counts as missing', () => {
    assert.deepEqual(deriveIssues(row({ activityKey: '' })), ['no_activity']);
});

test('a missing task link is advisory and never blocks', () => {
    const unlinked = row({ taskId: null });

    assert.deepEqual(deriveIssues(unlinked), ['no_task_link']);
    assert.equal(isReadyToSubmit(unlinked), true);
});

test('issues accumulate in a stable order', () => {
    assert.deepEqual(
        deriveIssues(row({ clientId: null, activityKey: null, taskId: null })),
        ['no_client', 'no_activity', 'no_task_link'],
    );
});

test('an already-mapped row reports no issues', () => {
    assert.deepEqual(deriveIssues(row({ importStatus: 'mapped', taskId: null })), []);
    assert.equal(isReadyToSubmit(row({ importStatus: 'mapped' })), false);
});

test('a voided row reports no issues and cannot be submitted', () => {
    assert.deepEqual(deriveIssues(row({ importStatus: 'voided', activityKey: null })), []);
    assert.equal(isReadyToSubmit(row({ importStatus: 'voided' })), false);
});

test('a row already awaiting review cannot be submitted again', () => {
    assert.equal(isReadyToSubmit(row({ importStatus: 'pending_review' })), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/timesheets/import-issues.test.ts`
Expected: FAIL — cannot find module `./import-issues.ts`.

- [ ] **Step 3: Implement it**

Create `lib/timesheets/import-issues.ts`:

```ts
import type { TimeLogImportStatus } from '../types.ts';

/**
 * What is still missing from an imported entry.
 *
 * Derived on read, never stored, so an issue list can never go stale against
 * the row it describes.
 *
 * `no_task_link` is deliberately advisory. Measured against real data, zero of
 * fourteen imported entries link to a to-do — making it a hard gate would mean
 * nothing ever imports.
 */

export type ImportIssue = 'no_client' | 'no_activity' | 'no_task_link';

/** Blocking issues, in the order they are surfaced. */
const BLOCKING: ImportIssue[] = ['no_client', 'no_activity'];

export interface ReviewableRow {
    id: string;
    clientId: string | null;
    /** Time on a project marked `internal` — legitimately has no client. */
    isInternal: boolean;
    activityKey: string | null;
    taskId: string | null;
    importStatus: TimeLogImportStatus;
}

/** States where a row is still being worked on and issues are meaningful. */
function isOpen(status: TimeLogImportStatus): boolean {
    return status === 'needs_context' || status === 'pending_review';
}

export function deriveIssues(row: ReviewableRow): ImportIssue[] {
    if (!isOpen(row.importStatus)) return [];

    const issues: ImportIssue[] = [];
    if (!row.clientId && !row.isInternal) issues.push('no_client');
    if (!row.activityKey) issues.push('no_activity');
    if (!row.taskId) issues.push('no_task_link');
    return issues;
}

/** True when a member may hand this row to a manager. */
export function isReadyToSubmit(row: ReviewableRow): boolean {
    if (row.importStatus !== 'needs_context') return false;
    return !deriveIssues(row).some(issue => BLOCKING.includes(issue));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/timesheets/import-issues.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/timesheets/import-issues.ts lib/timesheets/import-issues.test.ts
git commit -m "feat: derive import review issues"
```

---

### Task 2: State transitions

**Files:**
- Create: `lib/timesheets/import-transitions.ts`, `lib/timesheets/import-transitions.test.ts`

**Interfaces:**
- Consumes: `budgetDefaultFor`, `describeActivity` from `lib/timesheets/activities.ts`; `deriveIssues`, `isReadyToSubmit`, `ReviewableRow`.
- Produces: `buildEntryEdit(row, edit, actor)`, `buildSubmit(rows, actor, now)`, `buildApproval(rows, actor, now)`, `buildBounce(rows, actor, now, note)`, each returning `{ ok: true; updates } | { ok: false; status; error }`.

- [ ] **Step 1: Write the failing test**

Create `lib/timesheets/import-transitions.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildApproval,
    buildBounce,
    buildEntryEdit,
    buildSubmit,
} from './import-transitions.ts';
import type { ReviewableRow } from './import-issues.ts';

function row(overrides: Partial<ReviewableRow> = {}): ReviewableRow {
    return {
        id: 'log-1',
        clientId: 'client-a',
        isInternal: false,
        activityKey: 'technical_audit',
        taskId: null,
        importStatus: 'needs_context',
        ...overrides,
    };
}

const actor = { userId: 'user-abel', isManager: false };
const manager = { userId: 'user-carlos', isManager: true };
const NOW = '2026-08-25T12:00:00Z';

// --- editing ---------------------------------------------------------------

test('choosing an activity sets description and budget together', () => {
    const result = buildEntryEdit(row({ activityKey: null }), {
        activityKey: 'technical_audit', detail: 'Crawl budget', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.updates, {
        activity_key: 'technical_audit',
        description: 'Technical SEO Audit — Crawl budget',
        counts_toward_budget: true,
        client_id: 'client-a',
    });
});

test('a non-delivery activity does not consume client budget', () => {
    const result = buildEntryEdit(row(), {
        activityKey: 'client_meeting', detail: '', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok && result.updates.counts_toward_budget, false);
});

test('an explicit budget override beats the activity default', () => {
    const result = buildEntryEdit(row(), {
        activityKey: 'client_meeting', detail: '', clientId: 'client-a',
        countsTowardBudget: true,
    }, actor);

    assert.equal(result.ok && result.updates.counts_toward_budget, true);
});

test('an unknown activity key is rejected rather than stored', () => {
    const result = buildEntryEdit(row(), {
        activityKey: 'not_real', detail: '', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});

test('a row a manager already approved is not editable through this path', () => {
    const result = buildEntryEdit(row({ importStatus: 'mapped' }), {
        activityKey: 'blog_post', detail: '', clientId: 'client-a',
    }, manager);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 409);
});

test('a voided row cannot be edited back to life', () => {
    const result = buildEntryEdit(row({ importStatus: 'voided' }), {
        activityKey: 'blog_post', detail: '', clientId: 'client-a',
    }, manager);

    assert.equal(result.ok, false);
});

// --- submitting ------------------------------------------------------------

test('submitting a ready batch moves it to pending_review', () => {
    const result = buildSubmit([row(), row({ id: 'log-2' })], actor, NOW);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.updates, {
        import_status: 'pending_review',
        submitted_at: NOW,
        submitted_by: 'user-abel',
        review_note: null,
    });
    assert.deepEqual(result.ok && result.ids, ['log-1', 'log-2']);
});

test('submitting is refused when any row still has a blocking issue', () => {
    const result = buildSubmit([row(), row({ id: 'log-2', activityKey: null })], actor, NOW);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 409);
    assert.match(!result.ok ? result.error : '', /1 entry/);
});

test('submitting an empty batch is refused', () => {
    const result = buildSubmit([], actor, NOW);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});

test('submitting skips rows already awaiting review rather than erroring', () => {
    const result = buildSubmit([row(), row({ id: 'log-2', importStatus: 'pending_review' })], actor, NOW);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.ids, ['log-1']);
});

// --- approving -------------------------------------------------------------

test('a manager approving moves rows to mapped', () => {
    const result = buildApproval([row({ importStatus: 'pending_review' })], manager, NOW);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.updates, {
        import_status: 'mapped',
        reviewed_at: NOW,
        reviewed_by: 'user-carlos',
        review_note: null,
    });
});

test('a member cannot approve', () => {
    const result = buildApproval([row({ importStatus: 'pending_review' })], actor, NOW);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 403);
});

test('approving a row that was never submitted is refused', () => {
    const result = buildApproval([row({ importStatus: 'needs_context' })], manager, NOW);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 409);
});

test('approving is refused if a submitted row lost its activity', () => {
    const result = buildApproval(
        [row({ importStatus: 'pending_review', activityKey: null })],
        manager,
        NOW,
    );

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 409);
});

// --- bouncing --------------------------------------------------------------

test('bouncing returns rows to the member with a reason', () => {
    const result = buildBounce([row({ importStatus: 'pending_review' })], manager, NOW, 'Needs more detail');

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.updates, {
        import_status: 'needs_context',
        reviewed_at: NOW,
        reviewed_by: 'user-carlos',
        review_note: 'Needs more detail',
    });
});

test('a bounce requires a reason', () => {
    const result = buildBounce([row({ importStatus: 'pending_review' })], manager, NOW, '   ');

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});

test('a member cannot bounce', () => {
    const result = buildBounce([row({ importStatus: 'pending_review' })], actor, NOW, 'no');

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 403);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/timesheets/import-transitions.test.ts`
Expected: FAIL — cannot find module `./import-transitions.ts`.

- [ ] **Step 3: Implement it**

Create `lib/timesheets/import-transitions.ts`:

```ts
import { budgetDefaultFor, describeActivity, findActivity } from './activities.ts';
import { deriveIssues, isReadyToSubmit, type ReviewableRow } from './import-issues.ts';

/**
 * Every state change an imported entry can undergo.
 *
 * Pure: routes authorize and persist, this decides. Keeping the rules here
 * means the same guard runs whether a change arrives from the member's queue,
 * a manager's bulk approve, or a future automation.
 */

export interface Actor {
    userId: string;
    isManager: boolean;
}

export interface EntryEdit {
    activityKey: string;
    detail: string;
    clientId: string | null;
    /** Overrides the activity's budget default when present. */
    countsTowardBudget?: boolean;
}

export type TransitionResult<T> =
    | ({ ok: true } & T)
    | { ok: false; status: 400 | 403 | 409; error: string };

/** States a member may still change. */
function isEditable(row: ReviewableRow): boolean {
    return row.importStatus === 'needs_context' || row.importStatus === 'pending_review';
}

export function buildEntryEdit(
    row: ReviewableRow,
    edit: EntryEdit,
    _actor: Actor,
): TransitionResult<{ updates: Record<string, unknown> }> {
    if (!isEditable(row)) {
        return {
            ok: false,
            status: 409,
            error: 'Only entries in review can be edited here',
        };
    }
    if (!findActivity(edit.activityKey)) {
        return { ok: false, status: 400, error: 'Choose a valid activity' };
    }

    return {
        ok: true,
        updates: {
            activity_key: edit.activityKey,
            description: describeActivity(edit.activityKey, edit.detail),
            // The activity answers "does this bill?" unless explicitly overridden.
            counts_toward_budget: edit.countsTowardBudget ?? budgetDefaultFor(edit.activityKey),
            client_id: edit.clientId,
        },
    };
}

export function buildSubmit(
    rows: ReviewableRow[],
    actor: Actor,
    now: string,
): TransitionResult<{ updates: Record<string, unknown>; ids: string[] }> {
    const candidates = rows.filter(row => row.importStatus === 'needs_context');
    if (candidates.length === 0) {
        return { ok: false, status: 400, error: 'Nothing to submit' };
    }

    const blocked = candidates.filter(row => !isReadyToSubmit(row));
    if (blocked.length > 0) {
        return {
            ok: false,
            status: 409,
            error: `${blocked.length} ${blocked.length === 1 ? 'entry' : 'entries'} still need a client or an activity`,
        };
    }

    return {
        ok: true,
        ids: candidates.map(row => row.id),
        updates: {
            import_status: 'pending_review',
            submitted_at: now,
            submitted_by: actor.userId,
            // A fresh submission clears the previous bounce reason.
            review_note: null,
        },
    };
}

export function buildApproval(
    rows: ReviewableRow[],
    actor: Actor,
    now: string,
): TransitionResult<{ updates: Record<string, unknown>; ids: string[] }> {
    if (!actor.isManager) return { ok: false, status: 403, error: 'Forbidden' };

    const candidates = rows.filter(row => row.importStatus === 'pending_review');
    if (candidates.length !== rows.length || candidates.length === 0) {
        return {
            ok: false,
            status: 409,
            error: 'Only entries submitted for review can be approved',
        };
    }

    // Re-check at the gate: a row could have lost its activity after submit.
    const incomplete = candidates.filter(row =>
        deriveIssues(row).some(issue => issue !== 'no_task_link'));
    if (incomplete.length > 0) {
        return {
            ok: false,
            status: 409,
            error: `${incomplete.length} ${incomplete.length === 1 ? 'entry is' : 'entries are'} missing a client or activity`,
        };
    }

    return {
        ok: true,
        ids: candidates.map(row => row.id),
        updates: {
            import_status: 'mapped',
            reviewed_at: now,
            reviewed_by: actor.userId,
            review_note: null,
        },
    };
}

export function buildBounce(
    rows: ReviewableRow[],
    actor: Actor,
    now: string,
    note: string,
): TransitionResult<{ updates: Record<string, unknown>; ids: string[] }> {
    if (!actor.isManager) return { ok: false, status: 403, error: 'Forbidden' };

    const reason = note.trim();
    if (!reason) {
        return { ok: false, status: 400, error: 'Say why it is going back' };
    }

    const candidates = rows.filter(row => row.importStatus === 'pending_review');
    if (candidates.length === 0) {
        return { ok: false, status: 409, error: 'Nothing awaiting review' };
    }

    return {
        ok: true,
        ids: candidates.map(row => row.id),
        updates: {
            import_status: 'needs_context',
            reviewed_at: now,
            reviewed_by: actor.userId,
            review_note: reason,
        },
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/timesheets/import-transitions.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add lib/timesheets/import-transitions.ts lib/timesheets/import-transitions.test.ts
git commit -m "feat: add import review state transitions"
```

---

### Task 3: Queue read route

**Files:**
- Create: `lib/timesheets/import-queue-route.ts`, `lib/timesheets/import-queue-route.test.ts`
- Create: `app/api/timesheets/imports/route.ts`
- Modify: `lib/supabase/timesheet-imports.ts`

**Interfaces:**
- Consumes: `deriveIssues`, `isReadyToSubmit`.
- Produces: `createImportQueueGet(dependencies)`; response `{ rows: QueueRow[], summary: { total, ready, blocked, pendingReview } }`.

- [ ] **Step 1: Write the failing test**

Create `lib/timesheets/import-queue-route.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createImportQueueGet,
    type ImportQueueDependencies,
    type QueueSourceRow,
} from './import-queue-route.ts';

function sourceRow(overrides: Partial<QueueSourceRow> = {}): QueueSourceRow {
    return {
        id: 'log-1',
        userId: 'user-abel',
        clientId: 'client-a',
        clientName: 'Client A',
        isInternal: false,
        activityKey: 'technical_audit',
        taskId: null,
        taskTitle: null,
        importStatus: 'needs_context',
        date: '2026-08-06',
        hours: 4.5,
        description: '',
        countsTowardBudget: true,
        basecampProjectName: 'Scott Cole Plumbing',
        reviewNote: null,
        ...overrides,
    };
}

function harness(options: { isManager?: boolean; rows?: QueueSourceRow[] } = {}) {
    const queried: { organizationId: string; userId: string | null }[] = [];
    const dependencies: ImportQueueDependencies = {
        async authorize() {
            return {
                ok: true,
                userId: 'user-abel',
                organizationId: 'org-1',
                isManager: options.isManager ?? false,
            };
        },
        async listQueue(scope) {
            queried.push(scope);
            return options.rows ?? [sourceRow()];
        },
    };
    return { queried, get: createImportQueueGet(dependencies) };
}

function url(params: Record<string, string> = {}) {
    return new Request(
        `https://seo-pm.test/api/timesheets/imports?${new URLSearchParams({ organizationId: 'org-1', ...params })}`,
    );
}

test('a member sees only their own queue', async () => {
    const { get, queried } = harness();
    const response = await get(url());

    assert.equal(response.status, 200);
    assert.equal(queried[0].userId, 'user-abel');
});

test('a member cannot request another member’s queue', async () => {
    const { get, queried } = harness();
    const response = await get(url({ userId: 'user-carlos' }));

    assert.equal(response.status, 403);
    assert.deepEqual(queried, []);
});

test('a manager sees the whole organization by default', async () => {
    const { get, queried } = harness({ isManager: true });
    await get(url());

    assert.equal(queried[0].userId, null);
});

test('a manager can narrow to one member', async () => {
    const { get, queried } = harness({ isManager: true });
    await get(url({ userId: 'user-abel' }));

    assert.equal(queried[0].userId, 'user-abel');
});

test('rows carry derived issues and readiness', async () => {
    const { get } = harness({
        rows: [
            sourceRow({ id: 'ready' }),
            sourceRow({ id: 'blocked', activityKey: null }),
        ],
    });

    const payload = await (await get(url())).json();
    assert.deepEqual(payload.rows[0].issues, ['no_task_link']);
    assert.equal(payload.rows[0].isReady, true);
    assert.deepEqual(payload.rows[1].issues, ['no_activity', 'no_task_link']);
    assert.equal(payload.rows[1].isReady, false);
});

test('the summary counts what the footer needs', async () => {
    const { get } = harness({
        rows: [
            sourceRow({ id: 'a' }),
            sourceRow({ id: 'b', activityKey: null }),
            sourceRow({ id: 'c', importStatus: 'pending_review' }),
        ],
    });

    const payload = await (await get(url())).json();
    assert.deepEqual(payload.summary, { total: 3, ready: 1, blocked: 1, pendingReview: 1 });
});

test('minutes are precomputed so the UI does no arithmetic', async () => {
    const { get } = harness({ rows: [sourceRow({ hours: 4.5 })] });

    const payload = await (await get(url())).json();
    assert.equal(payload.rows[0].minutes, 270);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/timesheets/import-queue-route.test.ts`
Expected: FAIL — cannot find module `./import-queue-route.ts`.

- [ ] **Step 3: Implement it**

Create `lib/timesheets/import-queue-route.ts`:

```ts
import { deriveIssues, isReadyToSubmit, type ImportIssue } from './import-issues.ts';
import { minutesFromHours } from './ledger.ts';
import type { TimeLogImportStatus } from '../types.ts';

/**
 * The review queue read model.
 *
 * Members read their own rows; managers read anyone's. That boundary is here
 * rather than in RLS, which is organization-scoped and cannot express
 * "your own rows only".
 */

export interface QueueSourceRow {
    id: string;
    userId: string;
    clientId: string | null;
    clientName: string | null;
    isInternal: boolean;
    activityKey: string | null;
    taskId: string | null;
    taskTitle: string | null;
    importStatus: TimeLogImportStatus;
    date: string;
    hours: number;
    description: string;
    countsTowardBudget: boolean;
    basecampProjectName: string | null;
    reviewNote: string | null;
}

export interface QueueRow extends QueueSourceRow {
    minutes: number;
    issues: ImportIssue[];
    isReady: boolean;
}

export type QueueAuthorization =
    | { ok: true; userId: string; organizationId: string; isManager: boolean }
    | { ok: false; status: number; error: string };

export interface ImportQueueDependencies {
    authorize(organizationId: string): Promise<QueueAuthorization>;
    listQueue(scope: {
        organizationId: string;
        userId: string | null;
    }): Promise<QueueSourceRow[]>;
}

function json(body: unknown, status = 200): Response {
    return Response.json(body, { status });
}

export function createImportQueueGet(dependencies: ImportQueueDependencies) {
    return async function getImportQueue(request: Request): Promise<Response> {
        const params = new URL(request.url).searchParams;
        const organizationId = params.get('organizationId')?.trim() ?? '';
        const requestedUser = params.get('userId')?.trim() ?? '';

        const authorization = await dependencies.authorize(organizationId);
        if (!authorization.ok) {
            return json({ error: authorization.error }, authorization.status);
        }

        let targetUserId: string | null = authorization.userId;
        if (authorization.isManager) {
            targetUserId = requestedUser || null;
        } else if (requestedUser && requestedUser !== authorization.userId) {
            return json({ error: 'Forbidden' }, 403);
        }

        const source = await dependencies.listQueue({
            organizationId: authorization.organizationId,
            userId: targetUserId,
        });

        const rows: QueueRow[] = source.map(row => ({
            ...row,
            minutes: minutesFromHours(row.hours),
            issues: deriveIssues(row),
            isReady: isReadyToSubmit(row),
        }));

        return json({
            isManager: authorization.isManager,
            rows,
            summary: {
                total: rows.length,
                ready: rows.filter(row => row.isReady).length,
                blocked: rows.filter(row =>
                    row.importStatus === 'needs_context' && !row.isReady).length,
                pendingReview: rows.filter(row => row.importStatus === 'pending_review').length,
            },
        });
    };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/timesheets/import-queue-route.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the Supabase adapter**

Append to `lib/supabase/timesheet-imports.ts`:

```ts
import type { QueueSourceRow } from '@/lib/timesheets/import-queue-route';

const QUEUE_SELECT = `
    id, user_id, client_id, activity_key, task_id, import_status, date, hours,
    description, counts_toward_budget, review_note, basecamp_project_id,
    clients(name), tasks(title)
`;

/** Rows still moving through review. Approved and voided rows are excluded. */
export async function listImportQueue(scope: {
    organizationId: string;
    userId: string | null;
}): Promise<QueueSourceRow[]> {
    const admin = createAdminClient();

    let query = admin
        .from('time_logs')
        .select(QUEUE_SELECT)
        .eq('organization_id', scope.organizationId)
        .in('import_status', ['needs_context', 'pending_review'])
        .order('date', { ascending: true });
    if (scope.userId) query = query.eq('user_id', scope.userId);

    const { data, error } = await query;
    if (error) throw error;

    const roles = await listProjectRoles(scope.organizationId);
    const byProject = new Map(roles.map(role => [role.basecampProjectId, role]));

    return (data ?? []).map(raw => {
        const row = raw as unknown as Record<string, any>;
        const role = byProject.get(String(row.basecamp_project_id ?? ''));
        return {
            id: row.id,
            userId: row.user_id ?? '',
            clientId: row.client_id ?? null,
            clientName: row.clients?.name ?? null,
            // Internal is a property of the project, not of the entry.
            isInternal: role?.role === 'internal',
            activityKey: row.activity_key ?? null,
            taskId: row.task_id ?? null,
            taskTitle: row.tasks?.title ?? null,
            importStatus: row.import_status,
            date: row.date,
            hours: Number(row.hours) || 0,
            description: row.description ?? '',
            countsTowardBudget: row.counts_toward_budget !== false,
            basecampProjectName: role?.basecampProjectName ?? null,
            reviewNote: row.review_note ?? null,
        };
    });
}
```

- [ ] **Step 6: Wire the route**

Create `app/api/timesheets/imports/route.ts`:

```ts
import { createImportQueueGet } from '@/lib/timesheets/import-queue-route';
import { listImportQueue } from '@/lib/supabase/timesheet-imports';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timesheets/imports?organizationId=&userId=
 *
 * The review queue. Members see their own rows; managers see everyone's, or
 * one member when userId is supplied.
 */
export const GET = createImportQueueGet({
    async authorize(organizationId) {
        const member = await requireOrganizationMember(organizationId);
        return member.ok
            ? {
                ok: true,
                userId: member.userId,
                organizationId: member.organizationId,
                isManager: member.isManager,
            }
            : { ok: false, status: member.status, error: member.error };
    },
    listQueue: listImportQueue,
});
```

- [ ] **Step 7: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck silent, all tests pass.

```bash
git add lib/timesheets/import-queue-route.ts lib/timesheets/import-queue-route.test.ts lib/supabase/timesheet-imports.ts app/api/timesheets/imports
git commit -m "feat: add import review queue read model"
```

---

### Task 4: Mutation route

**Files:**
- Create: `app/api/timesheets/imports/entries/route.ts`
- Modify: `lib/supabase/timesheet-imports.ts`

**Interfaces:**
- Consumes: `buildEntryEdit`, `buildSubmit`, `buildApproval`, `buildBounce`, `listImportQueue`.
- Produces: `PATCH /api/timesheets/imports/entries` accepting `{ organizationId, action, ids[], edit? , note? }`.

One route for all four transitions, because they share the same authorization
and the same "load rows, decide, persist" shape.

- [ ] **Step 1: Add the persistence helpers**

Append to `lib/supabase/timesheet-imports.ts`:

```ts
/** Load the rows a transition is about, scoped to one organization. */
export async function loadQueueRowsByIds(
    organizationId: string,
    ids: string[],
): Promise<QueueSourceRow[]> {
    if (ids.length === 0) return [];
    const rows = await listImportQueue({ organizationId, userId: null });
    const wanted = new Set(ids);
    return rows.filter(row => wanted.has(row.id));
}

/** Apply one patch to a set of rows, guarded by their expected status. */
export async function applyQueueUpdate(
    organizationId: string,
    ids: string[],
    updates: Record<string, unknown>,
    expectedStatus: string,
): Promise<number> {
    if (ids.length === 0) return 0;
    const { data, error } = await createAdminClient()
        .from('time_logs')
        .update(updates)
        .eq('organization_id', organizationId)
        .in('id', ids)
        // Losing a race against a concurrent transition must not overwrite it.
        .eq('import_status', expectedStatus)
        .select('id');
    if (error) throw error;
    return data?.length ?? 0;
}
```

- [ ] **Step 2: Write the route**

Create `app/api/timesheets/imports/entries/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import {
    buildApproval,
    buildBounce,
    buildEntryEdit,
    buildSubmit,
} from '@/lib/timesheets/import-transitions';
import {
    applyQueueUpdate,
    loadQueueRowsByIds,
} from '@/lib/supabase/timesheet-imports';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/timesheets/imports/entries
 * Body: { organizationId, action: 'edit'|'submit'|'approve'|'bounce', ids, edit?, note? }
 *
 * A member may only touch their own rows. A manager may touch anyone's, but
 * only a manager may approve or bounce.
 */
export async function PATCH(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const input = (body ?? {}) as Record<string, any>;
    const organizationId = typeof input.organizationId === 'string' ? input.organizationId : '';
    const action = typeof input.action === 'string' ? input.action : '';
    const ids: string[] = Array.isArray(input.ids)
        ? input.ids.filter((id: unknown): id is string => typeof id === 'string')
        : [];

    if (!['edit', 'submit', 'approve', 'bounce'].includes(action)) {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    if (ids.length === 0) {
        return NextResponse.json({ error: 'No entries selected' }, { status: 400 });
    }

    const member = await requireOrganizationMember(organizationId);
    if (!member.ok) {
        return NextResponse.json({ error: member.error }, { status: member.status });
    }

    const rows = await loadQueueRowsByIds(member.organizationId, ids);
    if (rows.length !== ids.length) {
        return NextResponse.json({ error: 'Some entries are not in review' }, { status: 404 });
    }
    // Ownership check before any transition logic runs.
    if (!member.isManager && rows.some(row => row.userId !== member.userId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const actor = { userId: member.userId, isManager: member.isManager };
    const now = new Date().toISOString();

    if (action === 'edit') {
        if (rows.length !== 1) {
            return NextResponse.json({ error: 'Edit one entry at a time' }, { status: 400 });
        }
        const edit = (input.edit ?? {}) as Record<string, unknown>;
        const result = buildEntryEdit(rows[0], {
            activityKey: typeof edit.activityKey === 'string' ? edit.activityKey : '',
            detail: typeof edit.detail === 'string' ? edit.detail : '',
            clientId: typeof edit.clientId === 'string' && edit.clientId ? edit.clientId : null,
            countsTowardBudget: typeof edit.countsTowardBudget === 'boolean'
                ? edit.countsTowardBudget
                : undefined,
        }, actor);
        if (!result.ok) {
            return NextResponse.json({ error: result.error }, { status: result.status });
        }
        const changed = await applyQueueUpdate(
            member.organizationId, [rows[0].id], result.updates, rows[0].importStatus,
        );
        return NextResponse.json({ ok: true, changed });
    }

    const result = action === 'submit'
        ? buildSubmit(rows, actor, now)
        : action === 'approve'
            ? buildApproval(rows, actor, now)
            : buildBounce(rows, actor, now, typeof input.note === 'string' ? input.note : '');

    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const expected = action === 'submit' ? 'needs_context' : 'pending_review';
    const changed = await applyQueueUpdate(
        member.organizationId, result.ids, result.updates, expected,
    );

    return NextResponse.json({ ok: true, action, changed });
}
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm test && npx eslint app/api/timesheets lib/supabase/timesheet-imports.ts`
Expected: typecheck silent, all tests pass, no lint errors.

```bash
git add app/api/timesheets/imports/entries lib/supabase/timesheet-imports.ts
git commit -m "feat: add import review mutation route"
```

---

### Task 5: To-do suggestions

**Files:**
- Create: `lib/timesheets/suggestions.ts`, `lib/timesheets/suggestions.test.ts`
- Create: `app/api/timesheets/imports/suggestions/route.ts`
- Modify: `lib/basecamp/api.ts`

**Interfaces:**
- Produces: `suggestionsFor(todos, row): Suggestion[]`, type `Suggestion { title, taskId, activityKey }`.

- [ ] **Step 1: Write the failing test**

Create `lib/timesheets/suggestions.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestionsFor, type CandidateTodo } from './suggestions.ts';

const todos: CandidateTodo[] = [
    { title: 'Fix title tags on service pages', completedOn: '2026-08-06', taskId: 'task-1' },
    { title: 'Technical SEO audit for /products', completedOn: '2026-08-06', taskId: 'task-2' },
    { title: 'Write August blog post', completedOn: '2026-08-20', taskId: 'task-3' },
];

test('suggests to-dos completed on the entry date', () => {
    const result = suggestionsFor(todos, { date: '2026-08-06' });

    assert.deepEqual(result.map(s => s.title), [
        'Fix title tags on service pages',
        'Technical SEO audit for /products',
    ]);
});

test('a suggestion carries its task id so the row can link to it', () => {
    const result = suggestionsFor(todos, { date: '2026-08-06' });

    assert.equal(result[0].taskId, 'task-1');
});

test('suggestions guess an activity from the title when it is unambiguous', () => {
    const result = suggestionsFor(todos, { date: '2026-08-06' });

    assert.equal(result[0].activityKey, 'metadata_optimization');
    assert.equal(result[1].activityKey, 'technical_audit');
});

test('a title matching nothing suggests no activity rather than a wrong one', () => {
    const result = suggestionsFor(
        [{ title: 'Misc follow-up', completedOn: '2026-08-06', taskId: 'task-9' }],
        { date: '2026-08-06' },
    );

    assert.equal(result[0].activityKey, null);
});

test('a date with no completed to-dos suggests nothing', () => {
    assert.deepEqual(suggestionsFor(todos, { date: '2026-08-07' }), []);
});

test('suggestions are capped so the row stays readable', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
        title: `Task ${index}`, completedOn: '2026-08-06', taskId: `t${index}`,
    }));

    assert.equal(suggestionsFor(many, { date: '2026-08-06' }).length, 3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test lib/timesheets/suggestions.test.ts`
Expected: FAIL — cannot find module `./suggestions.ts`.

- [ ] **Step 3: Implement it**

Create `lib/timesheets/suggestions.ts`:

```ts
import { TIMESHEET_ACTIVITIES } from './activities.ts';

/**
 * One-tap context from work already recorded.
 *
 * When a to-do was completed in the same project on the same day, its title is
 * almost certainly what the time was spent on. Accepting a suggestion fills the
 * description, the activity, and the task link in a single tap — which is the
 * difference between a review queue that gets used and one that does not.
 *
 * Activity inference is conservative: an unmatched title suggests no activity
 * rather than the nearest guess, because a wrong activity silently changes
 * whether the time bills.
 */

const MAX_SUGGESTIONS = 3;

/** Distinctive words per activity. Deliberately narrow to avoid false hits. */
const ACTIVITY_HINTS: Record<string, string[]> = {
    metadata_optimization: ['title tag', 'meta description', 'meta tag'],
    technical_audit: ['technical audit', 'technical seo audit', 'site audit'],
    blog_post: ['blog post', 'blog'],
    internal_linking: ['internal link'],
    schema_markup: ['schema'],
    gbp_monthly: ['gbp post', 'google business'],
    link_building: ['link building', 'outreach', 'backlink'],
    keyword_research: ['keyword research'],
    content_refresh: ['content refresh', 'refresh content'],
    monthly_reporting: ['monthly report', 'reporting'],
};

const KNOWN_KEYS = new Set(TIMESHEET_ACTIVITIES.map(activity => activity.key));

export interface CandidateTodo {
    title: string;
    /** yyyy-MM-dd */
    completedOn: string;
    /** The SEO PM task id, when the to-do is one we pushed. */
    taskId: string | null;
}

export interface Suggestion {
    title: string;
    taskId: string | null;
    activityKey: string | null;
}

function inferActivity(title: string): string | null {
    const haystack = title.toLowerCase();
    for (const [key, hints] of Object.entries(ACTIVITY_HINTS)) {
        if (!KNOWN_KEYS.has(key)) continue;
        if (hints.some(hint => haystack.includes(hint))) return key;
    }
    return null;
}

export function suggestionsFor(
    todos: CandidateTodo[],
    row: { date: string },
): Suggestion[] {
    return todos
        .filter(todo => todo.completedOn === row.date)
        .slice(0, MAX_SUGGESTIONS)
        .map(todo => ({
            title: todo.title,
            taskId: todo.taskId,
            activityKey: inferActivity(todo.title),
        }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test lib/timesheets/suggestions.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the route**

Create `app/api/timesheets/imports/suggestions/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { suggestionsFor, type CandidateTodo } from '@/lib/timesheets/suggestions';
import { requireOrganizationMember } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/**
 * GET /api/timesheets/imports/suggestions?organizationId=&clientId=&date=
 *
 * Tasks completed for this client on this date, as one-tap context. Reads only
 * SEO PM tasks, so it needs no Basecamp round trip and cannot leak another
 * organization's work.
 */
export async function GET(req: NextRequest) {
    const params = new URL(req.url).searchParams;
    const organizationId = params.get('organizationId')?.trim() ?? '';
    const clientId = params.get('clientId')?.trim() ?? '';
    const date = params.get('date')?.trim() ?? '';

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return NextResponse.json({ error: 'date must be yyyy-MM-dd' }, { status: 400 });
    }

    const member = await requireOrganizationMember(organizationId);
    if (!member.ok) {
        return NextResponse.json({ error: member.error }, { status: member.status });
    }

    let query = createAdminClient()
        .from('tasks')
        .select('id, title, completed_at')
        .eq('organization_id', member.organizationId)
        .not('completed_at', 'is', null)
        .gte('completed_at', `${date}T00:00:00Z`)
        .lte('completed_at', `${date}T23:59:59Z`)
        .limit(20);
    if (clientId) query = query.eq('client_id', clientId);

    const { data, error } = await query;
    if (error) {
        return NextResponse.json({ error: 'Unable to load suggestions' }, { status: 500 });
    }

    const todos: CandidateTodo[] = (data ?? []).map(task => ({
        title: task.title,
        completedOn: String(task.completed_at).slice(0, 10),
        taskId: task.id,
    }));

    return NextResponse.json({ suggestions: suggestionsFor(todos, { date }) });
}
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck silent, all tests pass.

```bash
git add lib/timesheets/suggestions.ts lib/timesheets/suggestions.test.ts app/api/timesheets/imports/suggestions
git commit -m "feat: suggest context from completed tasks"
```

---

### Task 6: Imports tab UI

**Files:**
- Create: `components/timesheets/ImportReviewView.tsx`, `components/timesheets/ImportRow.tsx`, `components/timesheets/ActivityPicker.tsx`
- Modify: `components/timesheets/TimesheetsShell.tsx`

**Interfaces:**
- Consumes: `/api/timesheets/imports`, `/api/timesheets/imports/entries`, `TIMESHEET_ACTIVITIES`, `formatDuration`, `formatDayHeading`.

- [ ] **Step 1: Build the activity picker**

Create `components/timesheets/ActivityPicker.tsx`:

```tsx
'use client';

import { TIMESHEET_ACTIVITIES } from '@/lib/timesheets/activities';

interface ActivityPickerProps {
    value: string | null;
    onChange: (activityKey: string) => void;
    id: string;
}

/**
 * The single biggest friction reducer in this screen.
 *
 * Measured against real data, 13 of 14 imported entries arrive with an empty
 * description. Typing 13 descriptions is a task nobody repeats; choosing from a
 * grouped list is one click, and it sets budget eligibility at the same time.
 */
export function ActivityPicker({ value, onChange, id }: ActivityPickerProps) {
    const groups = new Map<string, typeof TIMESHEET_ACTIVITIES>();
    for (const activity of TIMESHEET_ACTIVITIES) {
        const list = groups.get(activity.category) ?? [];
        list.push(activity);
        groups.set(activity.category, list);
    }

    return (
        <select
            id={id}
            value={value ?? ''}
            onChange={event => onChange(event.target.value)}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
            <option value="">What was this?</option>
            {[...groups.entries()].map(([category, activities]) => (
                <optgroup key={category} label={category}>
                    {activities.map(activity => (
                        <option key={activity.key} value={activity.key}>
                            {activity.label}
                        </option>
                    ))}
                </optgroup>
            ))}
        </select>
    );
}
```

- [ ] **Step 2: Build the review view**

Create `components/timesheets/ImportReviewView.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getClients } from '@/lib/supabase/clients';
import { formatDayHeading, formatDuration } from '@/lib/timesheets/format';
import type { QueueRow } from '@/lib/timesheets/import-queue-route';
import type { ClientProject } from '@/lib/types';
import { ImportRow } from './ImportRow';

interface ImportReviewViewProps {
    organizationId: string;
}

interface QueuePayload {
    isManager: boolean;
    rows: QueueRow[];
    summary: { total: number; ready: number; blocked: number; pendingReview: number };
}

/**
 * The context-capture queue.
 *
 * Members fill in what their imported time was, then submit the batch. Managers
 * see the same table plus approve and bounce. Nothing here counts toward a
 * client budget until a manager approves it.
 */
export function ImportReviewView({ organizationId }: ImportReviewViewProps) {
    const [payload, setPayload] = useState<QueuePayload | null>(null);
    const [clients, setClients] = useState<ClientProject[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [isBusy, setIsBusy] = useState(false);

    const load = useCallback(async () => {
        if (!organizationId) return;
        setError(null);
        try {
            const response = await fetch(
                `/api/timesheets/imports?${new URLSearchParams({ organizationId })}`,
            );
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? 'Unable to load the import queue');
            setPayload(body as QueuePayload);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load the import queue');
        }
    }, [organizationId]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        let active = true;
        void getClients(organizationId).then(rows => { if (active) setClients(rows); });
        return () => { active = false; };
    }, [organizationId]);

    const mutate = async (action: string, ids: string[], extra: Record<string, unknown> = {}) => {
        setIsBusy(true);
        setError(null);
        try {
            const response = await fetch('/api/timesheets/imports/entries', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, action, ids, ...extra }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? 'Unable to save');
            setSelected(new Set());
            await load();
        } catch (saveError) {
            setError(saveError instanceof Error ? saveError.message : 'Unable to save');
        } finally {
            setIsBusy(false);
        }
    };

    const rows = payload?.rows ?? [];
    const needsContext = useMemo(
        () => rows.filter(row => row.importStatus === 'needs_context'),
        [rows],
    );
    const pending = useMemo(
        () => rows.filter(row => row.importStatus === 'pending_review'),
        [rows],
    );

    const toggle = (id: string) => {
        setSelected(previous => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    if (!payload) {
        return <p className="p-6 text-sm text-muted-foreground">Loading import queue…</p>;
    }

    if (rows.length === 0) {
        return (
            <div className="flex flex-1 items-center justify-center p-10">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />
                    Nothing waiting for review.
                </p>
            </div>
        );
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {error && (
                <p role="alert" className="mx-6 mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {error}
                </p>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                {selected.size > 0 && (
                    <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-card p-3">
                        <span className="text-sm text-foreground">{selected.size} selected</span>
                        <select
                            aria-label="Set client for selected entries"
                            defaultValue=""
                            onChange={event => {
                                if (!event.target.value) return;
                                for (const id of selected) {
                                    const row = rows.find(candidate => candidate.id === id);
                                    if (!row?.activityKey) continue;
                                    void mutate('edit', [id], {
                                        edit: {
                                            activityKey: row.activityKey,
                                            detail: '',
                                            clientId: event.target.value,
                                        },
                                    });
                                }
                            }}
                            className="rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                        >
                            <option value="">Set client…</option>
                            {clients.map(client => (
                                <option key={client.id} value={client.id}>{client.clientName}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            onClick={() => setSelected(new Set())}
                            className="text-sm text-muted-foreground hover:text-foreground"
                        >
                            Clear
                        </button>
                    </div>
                )}

                <ul className="space-y-2">
                    {rows.map(row => (
                        <ImportRow
                            key={row.id}
                            row={row}
                            clients={clients}
                            organizationId={organizationId}
                            isSelected={selected.has(row.id)}
                            isManager={payload.isManager}
                            isBusy={isBusy}
                            onToggleSelect={() => toggle(row.id)}
                            onEdit={edit => mutate('edit', [row.id], { edit })}
                            onApprove={() => mutate('approve', [row.id])}
                            onBounce={note => mutate('bounce', [row.id], { note })}
                        />
                    ))}
                </ul>
            </div>

            <footer className="flex flex-wrap items-center gap-4 border-t border-border px-6 py-4">
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" aria-hidden />
                    {payload.summary.ready} of {needsContext.length} ready
                    {payload.summary.blocked > 0 && (
                        <span className="flex items-center gap-1 text-amber-500">
                            <AlertTriangle className="h-4 w-4" aria-hidden />
                            {payload.summary.blocked} need attention
                        </span>
                    )}
                </span>

                <div className="ml-auto flex gap-3">
                    {payload.isManager && pending.length > 0 && (
                        <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => mutate('approve', pending.map(row => row.id))}
                            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40"
                        >
                            Approve all {pending.length} submitted
                        </button>
                    )}
                    <button
                        type="button"
                        disabled={isBusy || payload.summary.ready === 0}
                        onClick={() => mutate('submit', needsContext.filter(row => row.isReady).map(row => row.id))}
                        className={cn(
                            'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40',
                        )}
                    >
                        Submit {payload.summary.ready} for review
                    </button>
                </div>
            </footer>
        </div>
    );
}
```

- [ ] **Step 3: Build the row**

Create `components/timesheets/ImportRow.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Link2Off } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDayHeading, formatDuration } from '@/lib/timesheets/format';
import { budgetDefaultFor } from '@/lib/timesheets/activities';
import type { QueueRow } from '@/lib/timesheets/import-queue-route';
import type { Suggestion } from '@/lib/timesheets/suggestions';
import type { ClientProject } from '@/lib/types';
import { ActivityPicker } from './ActivityPicker';

interface ImportRowProps {
    row: QueueRow;
    clients: ClientProject[];
    organizationId: string;
    isSelected: boolean;
    isManager: boolean;
    isBusy: boolean;
    onToggleSelect: () => void;
    onEdit: (edit: Record<string, unknown>) => void;
    onApprove: () => void;
    onBounce: (note: string) => void;
}

export function ImportRow({
    row, clients, organizationId, isSelected, isManager, isBusy,
    onToggleSelect, onEdit, onApprove, onBounce,
}: ImportRowProps) {
    const [detail, setDetail] = useState('');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

    const heading = formatDayHeading(row.date);
    const isPending = row.importStatus === 'pending_review';

    // One-tap context from work already recorded that day.
    useEffect(() => {
        let active = true;
        const params = new URLSearchParams({ organizationId, date: row.date });
        if (row.clientId) params.set('clientId', row.clientId);
        void fetch(`/api/timesheets/imports/suggestions?${params}`)
            .then(response => response.ok ? response.json() : { suggestions: [] })
            .then(body => { if (active) setSuggestions(body.suggestions ?? []); })
            .catch(() => { /* suggestions are a convenience, never a blocker */ });
        return () => { active = false; };
    }, [organizationId, row.date, row.clientId]);

    const save = (patch: Record<string, unknown>) => {
        onEdit({
            activityKey: row.activityKey ?? '',
            detail,
            clientId: row.clientId,
            ...patch,
        });
    };

    return (
        <li
            className={cn(
                'rounded-xl border bg-card p-4',
                isSelected ? 'border-primary' : 'border-border',
                isPending && 'opacity-90',
            )}
        >
            <div className="flex flex-wrap items-center gap-3">
                <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={onToggleSelect}
                    aria-label={`Select ${heading.weekday} ${heading.date} entry`}
                    className="h-4 w-4 accent-[var(--primary)]"
                />

                <span className="w-24 text-sm text-muted-foreground">
                    {heading.weekday} {heading.date}
                </span>

                <span className="w-16 text-sm font-medium tabular-nums text-foreground">
                    {formatDuration(row.minutes, { zero: '0m' })}
                </span>

                <span className="w-40 truncate text-sm text-muted-foreground" title={row.basecampProjectName ?? ''}>
                    {row.basecampProjectName ?? 'Unknown project'}
                </span>

                <select
                    aria-label="Client"
                    value={row.clientId ?? ''}
                    disabled={isBusy}
                    onChange={event => save({ clientId: event.target.value || null })}
                    className="w-44 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                >
                    <option value="">{row.isInternal ? 'Internal' : 'Choose client…'}</option>
                    {clients.map(client => (
                        <option key={client.id} value={client.id}>{client.clientName}</option>
                    ))}
                </select>

                <div className="w-56">
                    <ActivityPicker
                        id={`activity-${row.id}`}
                        value={row.activityKey}
                        onChange={activityKey => save({ activityKey })}
                    />
                </div>

                <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={row.countsTowardBudget}
                        disabled={isBusy || !row.activityKey}
                        onChange={event => save({ countsTowardBudget: event.target.checked })}
                        className="h-4 w-4 accent-[var(--primary)]"
                    />
                    Budget
                </label>

                {row.issues.includes('no_task_link') && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground" title="Not linked to a task">
                        <Link2Off className="h-3.5 w-3.5" aria-hidden />
                    </span>
                )}

                {isPending && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                        Awaiting review
                    </span>
                )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 pl-7">
                <input
                    type="text"
                    value={detail}
                    disabled={isBusy}
                    placeholder={row.description || 'Add detail (optional)'}
                    onChange={event => setDetail(event.target.value)}
                    onBlur={() => { if (detail.trim() && row.activityKey) save({}); }}
                    className="min-w-[240px] flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                />

                {suggestions.map(suggestion => (
                    <button
                        key={suggestion.title}
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                            setDetail(suggestion.title);
                            save({
                                detail: suggestion.title,
                                activityKey: suggestion.activityKey ?? row.activityKey ?? '',
                            });
                        }}
                        className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                    >
                        {suggestion.title}
                    </button>
                ))}
            </div>

            {row.reviewNote && (
                <p className="mt-2 flex items-start gap-2 pl-7 text-xs text-amber-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Sent back: {row.reviewNote}
                </p>
            )}

            {isManager && isPending && (
                <div className="mt-3 flex gap-3 pl-7">
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={onApprove}
                        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
                    >
                        Approve
                    </button>
                    <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => {
                            const note = window.prompt('Why is this going back?');
                            if (note?.trim()) onBounce(note);
                        }}
                        className="rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-40"
                    >
                        Send back
                    </button>
                </div>
            )}
        </li>
    );
}
```

- [ ] **Step 4: Add the tab**

In `components/timesheets/TimesheetsShell.tsx`:

Add the import:

```tsx
import { ImportReviewView } from './ImportReviewView';
```

Change the `Tab` type and `TABS` constant:

```tsx
type Tab = 'mine' | 'imports' | 'team' | 'review';

const TABS: { id: Tab; label: string; managerOnly: boolean }[] = [
    { id: 'mine', label: 'My timesheet', managerOnly: false },
    // Every member has an import queue, so this tab is not manager-gated.
    { id: 'imports', label: 'Imports', managerOnly: false },
    { id: 'team', label: 'Team', managerOnly: true },
    { id: 'review', label: 'Client review', managerOnly: true },
];
```

Add the panel beside the other tab panels:

```tsx
            {tab === 'imports' && (
                <ImportReviewView organizationId={organizationId} />
            )}
```

- [ ] **Step 5: Add the manager backfill control**

The foundation plan's backfill runs from the browser console. Managers need it
on the page. Create `components/timesheets/BackfillControl.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { getOrganizationMembers } from '@/lib/supabase/organizations';

interface BackfillControlProps {
    organizationId: string;
    onImported: () => void;
}

/**
 * Pull a member's existing Basecamp time for a date range.
 *
 * Imports land as `needs_context`, so running this is safe at any time — it can
 * never move a client's budget on its own. Re-running is free: identity is the
 * row fingerprint, so a second run updates rather than duplicates.
 */
export function BackfillControl({ organizationId, onImported }: BackfillControlProps) {
    const [members, setMembers] = useState<{ userId: string; label: string }[]>([]);
    const [userId, setUserId] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [status, setStatus] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);

    useEffect(() => {
        let active = true;
        void getOrganizationMembers(organizationId).then(rows => {
            if (!active) return;
            setMembers(rows
                .filter(row => row.basecampPersonId)
                .map(row => ({
                    userId: row.userId,
                    label: row.user.fullName || row.user.email,
                })));
        });
        return () => { active = false; };
    }, [organizationId]);

    const run = async () => {
        setIsRunning(true);
        setStatus(null);
        try {
            const response = await fetch('/api/timesheets/import/backfill', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ organizationId, userId, from, to }),
            });
            const body = await response.json();
            if (!response.ok) throw new Error(body.error ?? 'Import failed');
            setStatus(`Scanned ${body.scanned}, imported ${body.imported}, skipped ${body.skipped}.`);
            onImported();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Import failed');
        } finally {
            setIsRunning(false);
        }
    };

    return (
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-6 py-4">
            <label className="text-sm">
                <span className="block text-xs text-muted-foreground">Member</span>
                <select
                    value={userId}
                    onChange={event => setUserId(event.target.value)}
                    className="mt-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                >
                    <option value="">Choose…</option>
                    {members.map(member => (
                        <option key={member.userId} value={member.userId}>{member.label}</option>
                    ))}
                </select>
            </label>

            <label className="text-sm">
                <span className="block text-xs text-muted-foreground">From</span>
                <input
                    type="date"
                    value={from}
                    onChange={event => setFrom(event.target.value)}
                    className="mt-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                />
            </label>

            <label className="text-sm">
                <span className="block text-xs text-muted-foreground">To</span>
                <input
                    type="date"
                    value={to}
                    onChange={event => setTo(event.target.value)}
                    className="mt-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
                />
            </label>

            <button
                type="button"
                disabled={isRunning || !userId || !from || !to}
                onClick={run}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-40"
            >
                <Download className="h-4 w-4" aria-hidden />
                {isRunning ? 'Importing…' : 'Import from Basecamp'}
            </button>

            {status && <span className="text-sm text-muted-foreground">{status}</span>}
        </div>
    );
}
```

Mount it at the top of `ImportReviewView`, above the error banner, for managers
only. Add the import and render:

```tsx
import { BackfillControl } from './BackfillControl';
```

```tsx
            {payload.isManager && (
                <BackfillControl organizationId={organizationId} onImported={() => { void load(); }} />
            )}
```

Move the two early returns (`!payload` and `rows.length === 0`) so they render
*inside* the wrapper rather than replacing it — otherwise a manager with an
empty queue has no way to start an import.

- [ ] **Step 6: Verify the build**

Run: `npx tsc --noEmit && npm run build && npx eslint components/timesheets`
Expected: typecheck silent, build succeeds, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add components/timesheets
git commit -m "feat: add import review queue UI"
```

---

### Task 7: Retire the mapping sheet

**Files:**
- Delete: `components/timesheets/MappingReviewSheet.tsx`
- Modify: `components/timesheets/TeamTimesheetView.tsx`, `lib/timesheets/mapping.ts`, `lib/timesheets/mapping.test.ts`, `app/api/timesheets/mapping/route.ts`

The mapping sheet resolved identity only, was manager-only, and could not
capture an activity. The Imports tab supersedes it. Leaving both would give two
different answers to "how do I fix this row".

- [ ] **Step 1: Point the Team attention rail at the Imports tab**

In `components/timesheets/TeamTimesheetView.tsx`, remove the `MappingReviewSheet`
import, the `mapping` state, and the `{mapping && ...}` block. Change the
exception button so it navigates instead of opening the sheet — replace the
`onClick={() => setMapping(exception)}` handler with:

```tsx
                                            onClick={() => {
                                                window.dispatchEvent(
                                                    new CustomEvent('timesheets:open-imports'),
                                                );
                                            }}
```

- [ ] **Step 2: Listen for that event in the shell**

In `components/timesheets/TimesheetsShell.tsx`, add inside the component:

```tsx
    // The Team attention rail hands off to the import queue.
    useEffect(() => {
        const open = () => setTab('imports');
        window.addEventListener('timesheets:open-imports', open);
        return () => window.removeEventListener('timesheets:open-imports', open);
    }, []);
```

- [ ] **Step 3: Delete the superseded files**

```bash
git rm components/timesheets/MappingReviewSheet.tsx
git rm lib/timesheets/mapping.ts lib/timesheets/mapping.test.ts
git rm -r app/api/timesheets/mapping
```

- [ ] **Step 4: Verify nothing still references them**

Run: `grep -rn "MappingReviewSheet\|timesheets/mapping\|api/timesheets/mapping" --include="*.ts" --include="*.tsx" lib components app`
Expected: no output.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: typecheck silent, all tests pass, build succeeds.

```bash
git add -A
git commit -m "refactor: replace mapping sheet with the import review queue"
```

---

### Task 8: Verify the whole workflow on real data

**Files:** none — this task is operational.

- [ ] **Step 1: Confirm the starting state**

Paste into the Supabase SQL editor:

```sql
select import_status, count(*), sum(hours)
from public.time_logs
where user_id = 'c8219b94-acfe-400a-881e-ab56b7266644'
  and date between '2026-08-01' and '2026-08-31'
group by import_status;
```

Expected: all rows `needs_context` (from the foundation plan).

- [ ] **Step 2: Check the member's view is private**

Sign in as Abel. Open `/timesheets` → Imports.

Expected: his ~14 entries, each showing the Basecamp project, an empty activity
picker, and an amber "needs attention" count in the footer. The Team and Client
review tabs must **not** appear.

- [ ] **Step 3: Fill one row and confirm budget derivation**

Pick an entry on a client project. Choose activity **Technical SEO Audit**.

Expected: the Budget checkbox becomes checked automatically, and the footer's
"ready" count increases by one.

Then choose **Client Meeting** on another row.

Expected: Budget is unchecked automatically.

- [ ] **Step 4: Confirm blocking works**

Leave at least one row without an activity and press Submit.

Expected: only the ready rows submit; the blocked row stays, and the footer
still shows it under "need attention".

- [ ] **Step 5: Confirm ownership is enforced server-side**

Still signed in as Abel, from the browser console:

```js
await fetch('/api/timesheets/imports?organizationId=51f63cc5-4c52-45ed-bb20-2d5ce6320bf2&userId=360c97ac-54fc-41fb-b660-0566d63c2e1b')
  .then(r => r.status);
```

Expected: `403`.

- [ ] **Step 6: Approve as the manager**

Sign in as Carlos. Open `/timesheets` → Imports.

Expected: Abel's submitted rows show "Awaiting review" with Approve and Send
back. Approve one; send one back with a reason.

- [ ] **Step 7: Confirm approved time reaches the ledger**

Paste into the Supabase SQL editor:

```sql
select import_status, activity_key, counts_toward_budget, hours
from public.time_logs
where user_id = 'c8219b94-acfe-400a-881e-ab56b7266644'
  and date between '2026-08-01' and '2026-08-31'
  and import_status = 'mapped';
```

Then open `/timesheets` → My timesheet, switch the member filter to Abel, and
navigate to that week.

Expected: the approved row now appears in the grid and its minutes are included
in the SEO budget tile. Rows still in review are still excluded.

- [ ] **Step 8: Confirm the bounce round-trips**

Sign back in as Abel.

Expected: the sent-back row is editable again and shows the amber "Sent back:"
reason.

- [ ] **Step 9: Confirm client review picks up the approved time**

As Carlos, open Client review, select the client from Step 7 and month
`2026-08`.

Expected: the approved minutes appear in "SEO budget used". Rows still in review
do not.

- [ ] **Step 10: Commit any fixes**

```bash
git add -A
git commit -m "fix: corrections from import review verification"
```

---

## Done means

Abel can turn a month of contextless Basecamp time into reviewed, attributed,
budget-correct ledger entries in a few minutes, and nothing reaches a client's
budget without a manager approving it.
