import assert from 'node:assert/strict';
import test from 'node:test';

import type { SiteIdentityReviewPayload } from '../types.ts';
import { claimDirectionForCandidate, historyNoteClassName, identityViewState } from './identity-view.ts';

const source = {
    pageId: 'page-source',
    primaryUrl: 'https://example.com/old-page',
    snapshotId: 'snapshot-source',
    observedAt: '2026-09-10T12:00:00Z',
    title: 'Old page',
    fetchStatus: 'success' as const,
    statusCode: 301,
    canonicalUrl: 'https://example.com/main-page',
    canonicalIssue: 'target_redirect' as const,
    redirectHops: ['https://example.com/main-page'],
    discoverySources: ['sitemap' as const],
    limitationFlags: ['redirected'],
};

const target = {
    pageId: 'page-target',
    primaryUrl: 'https://example.com/main-page',
    snapshotId: 'snapshot-target',
    observedAt: '2026-09-10T11:00:00Z',
    title: 'Main page',
    fetchStatus: 'success' as const,
    statusCode: 200,
    canonicalUrl: 'https://example.com/main-page',
    canonicalIssue: 'none' as const,
    redirectHops: [],
    discoverySources: ['redirect' as const],
    limitationFlags: [],
};

const candidatePayload: SiteIdentityReviewPayload = {
    source,
    candidates: [{
        page: target,
        signals: [{ kind: 'redirect', url: target.primaryUrl, matchedPageId: target.pageId }],
        resolution: {
            requestedPageId: target.pageId,
            resolvedPageId: target.pageId,
            path: [target.pageId],
            claimed: false,
        },
        resolvedPage: target,
    }],
    unmatchedSignals: [],
    resolution: {
        requestedPageId: source.pageId,
        resolvedPageId: source.pageId,
        path: [source.pageId],
        claimed: false,
    },
    decisions: [],
};

test('never describes an exact signal as proof of duplication', () => {
    const copy = identityViewState(candidatePayload);

    assert.equal(copy.evidenceState, 'exact_candidate');
    assert.match(copy.notice, /evidence, not proof/i);
    assert.doesNotMatch(JSON.stringify(copy), /ranking gain|cannibali[sz]ation|content gap/i);
});

test('unmatched targets allow research but not claiming', () => {
    const state = identityViewState({
        ...candidatePayload,
        candidates: [],
        unmatchedSignals: [{ kind: 'canonical', url: 'https://example.com/not-in-inventory' }],
    });

    assert.equal(state.evidenceState, 'unmatched_signal');
    assert.equal(state.canClaim, false);
    assert.equal(state.canKeepSeparate, false);
    assert.equal(state.canMarkNeedsResearch, true);
});

test('keeps asynchronous and evidence freshness states explicit', () => {
    assert.equal(identityViewState(undefined, { loading: true }).evidenceState, 'loading');
    assert.equal(identityViewState(undefined, { error: 'Read failed' }).evidenceState, 'read_failure');
    assert.equal(identityViewState({
        ...candidatePayload,
        candidates: [],
    }).evidenceState, 'no_signal');
    const stale = identityViewState(candidatePayload, { selectedSnapshotId: 'snapshot-newer' });
    assert.equal(stale.evidenceState, 'stale_evidence');
    assert.equal(stale.canClaim, false);
    assert.equal(stale.canMarkNeedsResearch, false);
});

test('allows claiming only when exact source and target snapshots are available', () => {
    const fresh = identityViewState(candidatePayload, { selectedSnapshotId: source.snapshotId });
    const unfetchedTarget = identityViewState({
        ...candidatePayload,
        candidates: [{
            ...candidatePayload.candidates[0],
            page: { ...target, snapshotId: undefined },
        }],
    });

    assert.equal(fresh.canClaim, true);
    assert.equal(fresh.canKeepSeparate, true);
    assert.equal(fresh.canMarkNeedsResearch, true);
    assert.equal(unfetchedTarget.canClaim, false);
});

test('names the immediate target and actual surviving root for a chained claim', () => {
    const root = {
        ...target,
        pageId: 'page-root',
        primaryUrl: 'https://example.com/surviving-page',
        snapshotId: 'snapshot-root',
        title: 'Surviving page',
    };
    const chainedCandidate = {
        ...candidatePayload.candidates[0],
        resolution: {
            requestedPageId: target.pageId,
            resolvedPageId: root.pageId,
            path: [target.pageId, root.pageId],
            claimed: true,
        },
        resolvedPage: root,
    };

    assert.deepEqual(claimDirectionForCandidate(chainedCandidate), {
        immediateTargetUrl: 'https://example.com/main-page',
        survivingPrimaryUrl: 'https://example.com/surviving-page',
        chained: true,
    });
});

test('fails claim actions closed when resolved root evidence is unavailable', () => {
    const state = identityViewState({
        ...candidatePayload,
        candidates: [{
            ...candidatePayload.candidates[0],
            resolvedPage: undefined,
        }],
    });

    assert.equal(state.canClaim, false);
});

test('withholds every reviewer write when the source snapshot is unavailable', () => {
    const withoutSourceSnapshot = {
        ...candidatePayload,
        source: { ...source, snapshotId: undefined },
    };
    const independent = identityViewState(withoutSourceSnapshot);
    const claimed = identityViewState({
        ...withoutSourceSnapshot,
        activeClaim: {
            sourcePageId: source.pageId,
            targetPageId: target.pageId,
            decisionId: 'decision-claim',
        },
    });

    assert.equal(independent.canClaim, false);
    assert.equal(independent.canKeepSeparate, false);
    assert.equal(independent.canMarkNeedsResearch, false);
    assert.equal(claimed.canReopen, false);
});

test('offers reopen only for an active source claim and names its observed target when available', () => {
    const state = identityViewState({
        ...candidatePayload,
        activeClaim: {
            sourcePageId: source.pageId,
            targetPageId: target.pageId,
            decisionId: 'decision-claim',
        },
        resolution: {
            requestedPageId: source.pageId,
            resolvedPageId: target.pageId,
            path: [source.pageId, target.pageId],
            claimed: true,
        },
    });

    assert.equal(state.reviewState, 'active_claim');
    assert.equal(state.activeTargetPrimaryUrl, target.primaryUrl);
    assert.equal(state.canReopen, true);
    assert.equal(state.canClaim, false);
    assert.equal(state.canKeepSeparate, false);
    assert.equal(state.canMarkNeedsResearch, false);
});

test('acknowledges reopen when an active claim has no current signal', () => {
    const state = identityViewState({
        ...candidatePayload,
        candidates: [],
        unmatchedSignals: [],
        activeClaim: {
            sourcePageId: source.pageId,
            targetPageId: target.pageId,
            decisionId: 'decision-claim',
        },
        resolution: {
            requestedPageId: source.pageId,
            resolvedPageId: target.pageId,
            path: [source.pageId, target.pageId],
            claimed: true,
        },
    });

    assert.equal(state.evidenceState, 'no_signal');
    assert.equal(state.canReopen, true);
    assert.match(state.notice, /active reviewer claim/i);
    assert.match(state.notice, /reopen/i);
    assert.doesNotMatch(state.notice, /no reviewer identity action is available/i);
});

test('uses a token-breaking class for unbroken reviewer history notes', () => {
    assert.match(historyNoteClassName, /\bbreak-all\b/);
});

test('distinguishes a reopened identity from a root page and orders reviewer history chronologically', () => {
    const root = identityViewState(candidatePayload);
    const reopened = identityViewState({
        ...candidatePayload,
        decisions: [
            {
                id: 'decision-reopen',
                sourcePageId: source.pageId,
                decisionKind: 'reopen',
                reasonCode: 'new_evidence',
                createdAt: '2026-09-11T10:00:00Z',
            },
            {
                id: 'decision-claim',
                sourcePageId: source.pageId,
                targetPageId: target.pageId,
                decisionKind: 'claim_into',
                reasonCode: 'redirect_alias',
                createdAt: '2026-09-10T10:00:00Z',
            },
        ],
    });

    assert.equal(root.reviewState, 'root_page');
    assert.equal(reopened.reviewState, 'reopened_identity');
    assert.deepEqual(reopened.history.map(item => item.id), ['decision-claim', 'decision-reopen']);
});
