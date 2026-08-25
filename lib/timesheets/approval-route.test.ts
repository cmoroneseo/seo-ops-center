import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createClientReviewGet,
    createApprovalPost,
    type ApprovalRouteDependencies,
    type ReviewRouteDependencies,
} from './approval-route.ts';
import type { LedgerLog } from './ledger.ts';

function log(overrides: Partial<LedgerLog> & { id: string; date: string }): LedgerLog {
    return {
        organizationId: 'org-1',
        clientId: 'client-a',
        clientName: 'Client A',
        taskId: 'task-1',
        taskTitle: 'On-page fixes',
        userId: 'user-carlos',
        hours: 1,
        description: '',
        countsTowardBudget: true,
        status: 'logged',
        source: 'seo_pm',
        importStatus: 'mapped',
        ...overrides,
    };
}

interface Recorded {
    approvals: unknown[];
    reopens: unknown[];
    activity: unknown[];
}

function deps(options: {
    role?: 'owner' | 'admin' | 'member' | 'viewer';
    logs?: LedgerLog[];
    budgetMinutes?: number;
    existing?: unknown;
} = {}) {
    const recorded: Recorded = { approvals: [], reopens: [], activity: [] };
    const role = options.role ?? 'owner';

    const shared = {
        now: () => '2026-09-01T12:00:00Z',
        async authorize() {
            return {
                ok: true as const,
                userId: 'user-carlos',
                actorName: 'Carlos Morones',
                organizationId: 'org-1',
                clientId: 'client-a',
                clientName: 'Client A',
                role,
                isManager: role === 'owner' || role === 'admin',
                budgetMinutes: options.budgetMinutes ?? 600,
            };
        },
        async listClientMonthLogs() {
            return options.logs ?? [log({ id: 'a', date: '2026-08-10', hours: 2 })];
        },
        async getApproval() {
            return (options.existing ?? null) as never;
        },
    };

    const review: ReviewRouteDependencies = shared;
    const approval: ApprovalRouteDependencies = {
        ...shared,
        async saveApproval(input) {
            recorded.approvals.push(input);
            return { id: 'approval-1' };
        },
        async reopenApproval(input) {
            recorded.reopens.push(input);
            return { id: 'approval-1' };
        },
        async logActivity(input) {
            recorded.activity.push(input);
        },
    };

    return { recorded, review, approval };
}

function reviewUrl(params: Record<string, string> = {}) {
    const search = new URLSearchParams({
        organizationId: 'org-1', clientId: 'client-a', month: '2026-08', ...params,
    });
    return new Request(`https://seo-pm.test/api/timesheets/client-review?${search}`);
}

function approvalRequest(body: Record<string, unknown>) {
    return new Request('https://seo-pm.test/api/timesheets/approvals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

const approve = { action: 'approve', organizationId: 'org-1', clientId: 'client-a', month: '2026-08' };

// --- read model -------------------------------------------------------------

test('a manager gets the client month with budget and totals', async () => {
    const { review } = deps();
    const response = await createClientReviewGet(review)(reviewUrl());

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.snapshot.eligibleMinutes, 120);
    assert.equal(payload.snapshot.budgetMinutes, 600);
    assert.equal(payload.snapshot.canApprove, true);
});

test('a member is forbidden from the client review', async () => {
    const { review } = deps({ role: 'member' });

    assert.equal((await createClientReviewGet(review)(reviewUrl())).status, 403);
});

test('a malformed month is rejected', async () => {
    const { review } = deps();

    assert.equal((await createClientReviewGet(review)(reviewUrl({ month: 'August' }))).status, 400);
    assert.equal((await createClientReviewGet(review)(reviewUrl({ month: '2026-8' }))).status, 400);
});

test('post-approval drift is reported against the stored snapshot', async () => {
    const { review } = deps({
        logs: [log({ id: 'a', date: '2026-08-10', hours: 3 })],
        existing: {
            id: 'approval-1',
            status: 'approved',
            approvedAt: '2026-09-01T00:00:00Z',
            budgetMinutes: 600,
            eligibleMinutes: 120,
            nonBudgetMinutes: 0,
            entries: [{ timeLogId: 'a', includedMinutes: 120 }],
        },
    });

    const payload = await (await createClientReviewGet(review)(reviewUrl())).json();
    assert.equal(payload.approval.eligibleMinutes, 120);
    assert.deepEqual(payload.changes, [
        { kind: 'minutes_changed', timeLogId: 'a', approvedMinutes: 120, currentMinutes: 180 },
    ]);
});

// --- approval ---------------------------------------------------------------

test('a manager can approve a clean month and it writes an activity event', async () => {
    const { approval, recorded } = deps();
    const response = await createApprovalPost(approval)(approvalRequest(approve));

    assert.equal(response.status, 200);
    assert.equal(recorded.approvals.length, 1);
    assert.deepEqual(recorded.activity, [{
        organizationId: 'org-1',
        clientId: 'client-a',
        eventType: 'timesheet.client_month_approved',
        actorName: 'Carlos Morones',
        actorId: 'user-carlos',
        metadata: {
            month: '2026-08',
            approvalId: 'approval-1',
            budgetMinutes: 600,
            eligibleMinutes: 120,
            nonBudgetMinutes: 0,
            entryCount: 1,
            note: '',
        },
    }]);
});

test('a member cannot approve', async () => {
    const { approval, recorded } = deps({ role: 'member' });
    const response = await createApprovalPost(approval)(approvalRequest(approve));

    assert.equal(response.status, 403);
    assert.deepEqual(recorded.approvals, []);
});

test('unmapped entries block approval', async () => {
    const { approval, recorded } = deps({
        logs: [
            log({ id: 'a', date: '2026-08-10' }),
            log({ id: 'orphan', date: '2026-08-11', source: 'basecamp', importStatus: 'needs_review' }),
        ],
    });
    const response = await createApprovalPost(approval)(approvalRequest(approve));

    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /unmapped/i);
    assert.deepEqual(recorded.approvals, []);
});

test('an over-budget month requires a manager note', async () => {
    const { approval, recorded } = deps({
        logs: [log({ id: 'a', date: '2026-08-10', hours: 12 })],
    });
    const response = await createApprovalPost(approval)(approvalRequest(approve));

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /note/i);
    assert.deepEqual(recorded.approvals, []);
});

test('an over-budget month approves once a note explains it', async () => {
    const { approval, recorded } = deps({
        logs: [log({ id: 'a', date: '2026-08-10', hours: 12 })],
    });
    const response = await createApprovalPost(approval)(
        approvalRequest({ ...approve, note: 'Migration overrun, agreed with client' }),
    );

    assert.equal(response.status, 200);
    assert.equal(recorded.approvals.length, 1);
});

test('the approval records the exact included entries, not a recomputed total', async () => {
    const { approval, recorded } = deps({
        logs: [
            log({ id: 'a', date: '2026-08-10', hours: 2 }),
            log({ id: 'b', date: '2026-08-11', hours: 0.5, countsTowardBudget: false }),
        ],
    });
    await createApprovalPost(approval)(approvalRequest(approve));

    const saved = recorded.approvals[0] as { entries: unknown[]; eligibleMinutes: number };
    assert.deepEqual(saved.entries, [
        { timeLogId: 'a', includedMinutes: 120 },
        { timeLogId: 'b', includedMinutes: 30 },
    ]);
    assert.equal(saved.eligibleMinutes, 120);
});

test('approving an already-approved month is refused rather than overwriting it', async () => {
    const { approval, recorded } = deps({
        existing: { id: 'approval-1', status: 'approved', entries: [] },
    });
    const response = await createApprovalPost(approval)(approvalRequest(approve));

    assert.equal(response.status, 409);
    assert.deepEqual(recorded.approvals, []);
});

test('reopening writes an event and never edits the prior snapshot', async () => {
    const { approval, recorded } = deps({
        existing: {
            id: 'approval-1',
            status: 'approved',
            entries: [{ timeLogId: 'a', includedMinutes: 120 }],
            eligibleMinutes: 120,
        },
    });
    const response = await createApprovalPost(approval)(
        approvalRequest({ ...approve, action: 'reopen', note: 'Late Basecamp entry' }),
    );

    assert.equal(response.status, 200);
    assert.deepEqual(recorded.approvals, []);
    assert.equal(recorded.reopens.length, 1);
    assert.equal(
        (recorded.activity[0] as { eventType: string }).eventType,
        'timesheet.client_month_reopened',
    );
});

test('reopening a month that was never approved is a no-op error', async () => {
    const { approval, recorded } = deps();
    const response = await createApprovalPost(approval)(
        approvalRequest({ ...approve, action: 'reopen' }),
    );

    assert.equal(response.status, 404);
    assert.deepEqual(recorded.reopens, []);
});

test('an unknown action is rejected', async () => {
    const { approval } = deps();
    const response = await createApprovalPost(approval)(
        approvalRequest({ ...approve, action: 'delete' }),
    );

    assert.equal(response.status, 400);
});
