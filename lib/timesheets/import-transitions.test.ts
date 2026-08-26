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

test('internal work never consumes client budget despite an explicit override', () => {
    const result = buildEntryEdit(row({ isInternal: true, clientId: null }), {
        activityKey: 'technical_audit', detail: '', clientId: null,
        countsTowardBudget: true,
    }, actor);

    assert.equal(result.ok && result.updates.counts_toward_budget, false);
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
