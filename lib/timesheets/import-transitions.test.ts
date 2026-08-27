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
        userId: 'user-abel',
        clientId: 'client-a',
        isInternal: false,
        activityKeys: ['technical_audit'],
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
    const result = buildEntryEdit(row({ activityKeys: [] }), {
        activityKeys: ['technical_audit'], detail: 'Crawl budget', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.updates, {
        activity_keys: ['technical_audit'],
        description: 'Technical SEO Audit — Crawl budget',
        counts_toward_budget: true,
        client_id: 'client-a',
    });
});

test('a non-delivery activity does not consume client budget', () => {
    const result = buildEntryEdit(row(), {
        activityKeys: ['client_meeting'], detail: '', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok && result.updates.counts_toward_budget, false);
});

test('an explicit budget override beats the activity default', () => {
    const result = buildEntryEdit(row(), {
        activityKeys: ['client_meeting'], detail: '', clientId: 'client-a',
        countsTowardBudget: true,
    }, actor);

    assert.equal(result.ok && result.updates.counts_toward_budget, true);
});

test('internal work clears a supplied client and never consumes its budget', () => {
    const result = buildEntryEdit(row({ isInternal: true, clientId: null }), {
        activityKeys: ['technical_audit'], detail: '', clientId: 'stale-client',
        countsTowardBudget: true,
    }, actor);

    assert.deepEqual(result.ok && result.updates, {
        activity_keys: ['technical_audit'],
        description: 'Technical SEO Audit',
        counts_toward_budget: false,
        client_id: null,
    });
});

test('a block tagged with three activities round-trips as one entry', () => {
    // Reviewed data: a 2h block that was GBP Optimization + Keyword Research &
    // Strategy + Content Strategy. The hours are never split.
    const result = buildEntryEdit(row({ activityKeys: [] }), {
        activityKeys: ['content_strategy', 'gbp_optimization', 'keyword_research'],
        detail: 'Aug refresh',
        clientId: 'client-a',
    }, actor);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.updates.activity_keys, [
        'content_strategy', 'gbp_optimization', 'keyword_research',
    ]);
    // Catalog order, so the stored text does not depend on click order.
    assert.equal(
        result.ok && result.updates.description,
        'Keyword Research & Strategy, Content Strategy & Calendar, GBP Optimization — Aug refresh',
    );
    assert.equal(result.ok && result.updates.counts_toward_budget, true);
    // Nothing about hours is touched — this is tagging, not splitting.
    assert.deepEqual(Object.keys((result.ok && result.updates) || {}).sort(), [
        'activity_keys', 'client_id', 'counts_toward_budget', 'description',
    ]);
});

test('any one billable activity is enough for the budget default', () => {
    const result = buildEntryEdit(row(), {
        activityKeys: ['internal_admin', 'technical_audit'], detail: '', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok && result.updates.counts_toward_budget, true);
});

test('an entry with no activity at all is rejected', () => {
    const result = buildEntryEdit(row(), {
        activityKeys: [], detail: 'Something', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});

test('one bad key poisons an otherwise valid selection', () => {
    const result = buildEntryEdit(row(), {
        activityKeys: ['technical_audit', 'not_real'], detail: '', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});

test('an unknown activity key is rejected rather than stored', () => {
    const result = buildEntryEdit(row(), {
        activityKeys: ['not_real'], detail: '', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});

test('a row a manager already approved is not editable through this path', () => {
    const result = buildEntryEdit(row({ importStatus: 'mapped' }), {
        activityKeys: ['blog_post'], detail: '', clientId: 'client-a',
    }, manager);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 409);
});

test('a voided row cannot be edited back to life', () => {
    const result = buildEntryEdit(row({ importStatus: 'voided' }), {
        activityKeys: ['blog_post'], detail: '', clientId: 'client-a',
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
    const result = buildSubmit([row(), row({ id: 'log-2', activityKeys: [] })], actor, NOW);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 409);
    assert.match(!result.ok ? result.error : '', /1 entry/);
});

test('submitting a batch with a memberless row is refused', () => {
    const result = buildSubmit([row(), row({ id: 'log-2', userId: null })], actor, NOW);

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
        [row({ importStatus: 'pending_review', activityKeys: [] })],
        manager,
        NOW,
    );

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 409);
});

test('a manager cannot approve a row with no mapped member', () => {
    const result = buildApproval(
        [row({ importStatus: 'pending_review', userId: null })],
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

// --- reference links -------------------------------------------------------

test('an edit that says nothing about links leaves the stored ones alone', () => {
    const result = buildEntryEdit(row(), {
        activityKeys: ['technical_audit'], detail: '', clientId: 'client-a',
    }, actor);

    assert.equal(result.ok, true);
    assert.equal(result.ok && 'reference_links' in result.updates, false);
});

test('valid reference links reach the patch, trimmed and normalized', () => {
    const result = buildEntryEdit(row(), {
        activityKeys: ['technical_audit'],
        detail: 'roadmap draft',
        clientId: 'client-a',
        referenceLinks: [{
            label: '  All In One Construction - 6-Month SEO Roadmap  ',
            url: '  https://docs.google.com/document/d/roadmap  ',
        }],
    }, actor);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.updates.reference_links, [{
        label: 'All In One Construction - 6-Month SEO Roadmap',
        url: 'https://docs.google.com/document/d/roadmap',
    }]);
});

test('an empty list is a real value — it clears the row', () => {
    const result = buildEntryEdit(row(), {
        activityKeys: ['technical_audit'], detail: '', clientId: 'client-a',
        referenceLinks: [],
    }, actor);

    assert.equal(result.ok, true);
    assert.deepEqual(result.ok && result.updates.reference_links, []);
});

test('a dangerous or malformed link is a 400, never a silent drop', () => {
    for (const referenceLinks of [
        [{ label: 'click', url: 'javascript:alert(document.cookie)' }],
        [{ label: 'click', url: 'JaVaScRiPt:alert(1)' }],
        [{ label: 'click', url: 'java\nscript:alert(1)' }],
        [{ label: 'payload', url: 'data:text/html,<script>alert(1)</script>' }],
        [{ label: 'away', url: '//evil.com' }],
        [{ label: '', url: 'https://example.com' }],
        [{ label: 'good', url: 'https://example.com' }, { label: 'bad', url: 'file:///etc/passwd' }],
    ]) {
        const result = buildEntryEdit(row(), {
            activityKeys: ['technical_audit'],
            detail: '',
            clientId: 'client-a',
            referenceLinks,
        }, actor);

        assert.equal(result.ok, false, `expected 400: ${JSON.stringify(referenceLinks)}`);
        assert.equal(!result.ok && result.status, 400);
        // The good link in the mixed case must NOT have been kept.
        assert.equal('updates' in result, false);
    }
});

test('more links than a row may carry is a 400', () => {
    const referenceLinks = Array.from({ length: 11 }, (_, index) => ({
        label: `Doc ${index}`,
        url: `https://example.com/${index}`,
    }));
    const result = buildEntryEdit(row(), {
        activityKeys: ['technical_audit'], detail: '', clientId: 'client-a', referenceLinks,
    }, actor);

    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.status, 400);
});
