import type {
    SiteIdentityDecision,
    SiteIdentityReviewCandidate,
    SiteIdentityReviewPayload,
} from '../types.ts';

export type IdentityEvidenceViewState =
    | 'loading'
    | 'read_failure'
    | 'no_signal'
    | 'unmatched_signal'
    | 'exact_candidate'
    | 'stale_evidence';

export type IdentityReviewViewState = 'active_claim' | 'root_page' | 'reopened_identity';

export interface IdentityViewState {
    evidenceState: IdentityEvidenceViewState;
    reviewState: IdentityReviewViewState;
    statusLabel: string;
    title: string;
    summary: string;
    notice: string;
    canClaim: boolean;
    canKeepSeparate: boolean;
    canMarkNeedsResearch: boolean;
    canReopen: boolean;
    activeTargetPrimaryUrl?: string;
    history: SiteIdentityDecision[];
}

interface IdentityViewContext {
    loading?: boolean;
    error?: string;
    selectedSnapshotId?: string;
}

export interface IdentityClaimDirection {
    immediateTargetUrl: string;
    survivingPrimaryUrl: string;
    chained: boolean;
}

export const historyNoteClassName = 'mt-1 whitespace-pre-wrap break-all text-[11px] text-muted-foreground';

export function claimDirectionForCandidate(
    candidate: SiteIdentityReviewCandidate,
): IdentityClaimDirection | undefined {
    const { page, resolution, resolvedPage } = candidate;
    if (!resolvedPage
        || resolution.requestedPageId !== page.pageId
        || resolution.resolvedPageId !== resolvedPage.pageId
        || resolution.path[0] !== page.pageId
        || resolution.path.at(-1) !== resolvedPage.pageId) {
        return undefined;
    }
    return {
        immediateTargetUrl: page.primaryUrl,
        survivingPrimaryUrl: resolvedPage.primaryUrl,
        chained: page.pageId !== resolvedPage.pageId,
    };
}

function evidenceCopy(state: IdentityEvidenceViewState) {
    switch (state) {
        case 'loading':
            return {
                title: 'Loading identity evidence',
                summary: 'Checking stored redirect and canonical signals for this page.',
                notice: 'The selected page crawl evidence remains available above.',
            };
        case 'read_failure':
            return {
                title: 'Identity review unavailable',
                summary: 'The identity evidence could not be loaded.',
                notice: 'The selected page crawl evidence remains available above.',
            };
        case 'stale_evidence':
            return {
                title: 'Crawl evidence changed',
                summary: 'This identity review does not match the selected crawl snapshot.',
                notice: 'Refresh the selected page evidence before recording a reviewer decision.',
            };
        case 'exact_candidate':
            return {
                title: 'Exact target observed',
                summary: 'A stored page matches an observed redirect or canonical URL exactly.',
                notice: 'An exact URL match is crawl evidence, not proof that the pages share one identity.',
            };
        case 'unmatched_signal':
            return {
                title: 'Target not in this inventory',
                summary: 'A redirect or canonical URL was observed without an exact stored-page match.',
                notice: 'The observed target can be recorded for further research; no page claim is available.',
            };
        case 'no_signal':
            return {
                title: 'No identity target observed',
                summary: 'This snapshot has no exact redirect or canonical target match.',
                notice: 'No reviewer identity action is available from the current crawl evidence.',
            };
    }
}

export function identityViewState(
    payload?: SiteIdentityReviewPayload,
    context: IdentityViewContext = {},
): IdentityViewState {
    const history = [...(payload?.decisions ?? [])].sort((left, right) => {
        const createdComparison = left.createdAt.localeCompare(right.createdAt);
        return createdComparison || left.id.localeCompare(right.id);
    });
    const activeClaim = payload && payload.activeClaim?.sourcePageId === payload.source.pageId
        ? payload.activeClaim
        : undefined;
    const latestDecision = history.at(-1);
    const reviewState: IdentityReviewViewState = activeClaim
        ? 'active_claim'
        : latestDecision?.decisionKind === 'reopen'
            ? 'reopened_identity'
            : 'root_page';

    let evidenceState: IdentityEvidenceViewState;
    if (context.error) {
        evidenceState = 'read_failure';
    } else if (context.loading || !payload) {
        evidenceState = 'loading';
    } else if (
        context.selectedSnapshotId
        && payload.source.snapshotId !== context.selectedSnapshotId
    ) {
        evidenceState = 'stale_evidence';
    } else if (payload.candidates.length > 0) {
        evidenceState = 'exact_candidate';
    } else if (payload.unmatchedSignals.length > 0) {
        evidenceState = 'unmatched_signal';
    } else {
        evidenceState = 'no_signal';
    }

    const actionable = Boolean(payload)
        && !activeClaim
        && evidenceState !== 'loading'
        && evidenceState !== 'read_failure'
        && evidenceState !== 'stale_evidence';
    const exactCandidate = evidenceState === 'exact_candidate';
    const sourceSnapshotAvailable = Boolean(payload?.source.snapshotId);
    const targetSnapshotAvailable = Boolean(payload?.candidates.some(candidate => (
        candidate.page.snapshotId && claimDirectionForCandidate(candidate)
    )));
    const copy = evidenceCopy(evidenceState);
    const notice = activeClaim && evidenceState === 'no_signal'
        ? 'No current redirect or canonical target is observed. An active reviewer claim remains recorded and can be reopened if it no longer reflects the page identity.'
        : copy.notice;
    const activeTargetPrimaryUrl = activeClaim
        ? payload?.candidates.find(candidate => candidate.page.pageId === activeClaim.targetPageId)?.page.primaryUrl
        : undefined;

    return {
        evidenceState,
        reviewState,
        statusLabel: reviewState === 'active_claim'
            ? 'Reviewer claim active'
            : reviewState === 'reopened_identity'
                ? 'Reviewer claim reopened'
                : 'Current primary page',
        ...copy,
        notice,
        canClaim: actionable && exactCandidate && sourceSnapshotAvailable && targetSnapshotAvailable,
        canKeepSeparate: actionable && sourceSnapshotAvailable && exactCandidate,
        canMarkNeedsResearch: actionable && sourceSnapshotAvailable
            && (exactCandidate || evidenceState === 'unmatched_signal'),
        canReopen: Boolean(activeClaim) && sourceSnapshotAvailable
            && evidenceState !== 'loading'
            && evidenceState !== 'read_failure'
            && evidenceState !== 'stale_evidence',
        ...(activeTargetPrimaryUrl ? { activeTargetPrimaryUrl } : {}),
        history,
    };
}
