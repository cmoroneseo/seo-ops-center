import type {
    SiteIdentityCandidate,
    SiteIdentityDecisionKind,
    SiteIdentityPageEvidence,
    SiteIdentityReasonCode,
    SiteIdentityResolution,
    SiteIdentitySignal,
    SitePageClaim,
} from '@/lib/types';
import { normalizeSiteUrl } from './url.ts';

const REASON_CODES: Record<SiteIdentityDecisionKind, readonly SiteIdentityReasonCode[]> = {
    claim_into: [
        'redirect_alias',
        'canonical_alias',
        'protocol_or_host_variant',
        'duplicate_page',
        'historical_url',
        'other',
    ],
    keep_separate: [
        'distinct_intent',
        'distinct_location',
        'distinct_language',
        'intentional_variant',
        'different_content',
        'other',
    ],
    needs_research: [
        'content_purpose_unknown',
        'conflicting_signals',
        'target_unfetched',
        'ownership_unknown',
        'other',
    ],
    reopen: [
        'incorrect_decision',
        'new_evidence',
        'site_changed',
        'other',
    ],
};

export function reasonCodesFor(kind: SiteIdentityDecisionKind) {
    return REASON_CODES[kind];
}

export function validateIdentityReason(
    kind: SiteIdentityDecisionKind,
    code: SiteIdentityReasonCode,
    note?: string,
) {
    if (!reasonCodesFor(kind).includes(code)) {
        return 'Reason code is not allowed for this identity decision';
    }
    if (code === 'other' && !note?.trim()) {
        return 'A note is required when the identity reason is other';
    }
    return null;
}

export function findExactIdentityCandidates(input: {
    sourcePageId: string;
    redirectHops: string[];
    canonicalUrl?: string;
    sameClientUrlIndex: ReadonlyMap<string, SiteIdentityPageEvidence>;
}): { candidates: SiteIdentityCandidate[]; unmatchedSignals: SiteIdentitySignal[] } {
    const storedSignals: Array<Pick<SiteIdentitySignal, 'kind' | 'url'>> = [
        ...input.redirectHops.map(url => ({ kind: 'redirect' as const, url })),
        ...(input.canonicalUrl ? [{ kind: 'canonical' as const, url: input.canonicalUrl }] : []),
    ];
    const candidatesByPageId = new Map<string, SiteIdentityCandidate>();
    const unmatchedSignals: SiteIdentitySignal[] = [];

    for (const storedSignal of storedSignals) {
        const url = normalizeSiteUrl(storedSignal.url);
        const page = input.sameClientUrlIndex.get(url);
        if (!page) {
            unmatchedSignals.push({ kind: storedSignal.kind, url });
            continue;
        }
        if (page.pageId === input.sourcePageId) continue;

        const signal = { kind: storedSignal.kind, url, matchedPageId: page.pageId };
        const candidate = candidatesByPageId.get(page.pageId);
        if (candidate) {
            candidate.signals.push(signal);
        } else {
            candidatesByPageId.set(page.pageId, { page, signals: [signal] });
        }
    }

    return { candidates: [...candidatesByPageId.values()], unmatchedSignals };
}

export function resolveSitePageClaim(
    pageId: string,
    claims: SitePageClaim[],
    maxDepth = 32,
): SiteIdentityResolution {
    const depthLimit = Math.min(Number.isFinite(maxDepth) ? maxDepth : 32, 32);
    const bySource = new Map(claims.map(claim => [claim.sourcePageId, claim.targetPageId]));
    const path = [pageId];
    const seen = new Set(path);
    let current = pageId;
    while (bySource.has(current)) {
        if (path.length > depthLimit) throw new Error('Identity claim depth exceeded');
        current = bySource.get(current)!;
        if (seen.has(current)) throw new Error('Identity claim cycle detected');
        seen.add(current);
        path.push(current);
    }
    return { requestedPageId: pageId, resolvedPageId: current, path, claimed: path.length > 1 };
}
