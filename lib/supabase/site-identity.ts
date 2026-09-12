import type { SupabaseClient } from '@supabase/supabase-js';

import { findExactIdentityCandidates, resolveSitePageClaim, sameSiteIdentityClaimState, siteIdentityClaimState } from '@/lib/site-inventory/identity';
import type {
    SiteDiscoverySource,
    SiteIdentityActiveClaimsPayload,
    SiteIdentityClaimState,
    SiteIdentityDecision,
    SiteIdentityDecisionKind,
    SiteIdentityPageEvidence,
    SiteIdentityReasonCode,
    SiteIdentityReviewPayload,
    SiteIdentitySignal,
    SitePageClaim,
    SitePageObservation,
} from '@/lib/types';

export interface SetSiteIdentityDecisionInput {
    organizationId: string;
    clientId: string;
    createdBy: string;
    sourcePageId: string;
    targetPageId?: string;
    decisionKind: SiteIdentityDecisionKind;
    reasonCode: SiteIdentityReasonCode;
    note?: string;
    expectedSourceSnapshotId: string;
    expectedTargetSnapshotId?: string;
    expectedActiveDecisionId: string | null;
    expectedTargetResolution: SiteIdentityClaimState | null;
}

export type SiteIdentityErrorCode = 'not_found' | 'stale' | 'conflict' | 'read_failed' | 'write_failed';

const ERROR_MESSAGES: Record<SiteIdentityErrorCode, string> = {
    not_found: 'The site identity page was not found.',
    stale: 'The crawl evidence changed. Refresh the review and try again.',
    conflict: 'The identity decision conflicts with the current review state.',
    read_failed: 'Unable to load the site identity review.',
    write_failed: 'Unable to save the site identity decision.',
};

export class SiteIdentityError extends Error {
    constructor(public readonly code: SiteIdentityErrorCode) {
        super(ERROR_MESSAGES[code]);
        this.name = 'SiteIdentityError';
    }
}

type Row = Record<string, unknown>;
const PAGINATION_RANGE_SIZE = 1000;

interface ScopedIdentityRows {
    sourcePage: Row;
    urls: Row[];
    snapshots: Row[];
    claims: Row[];
}

interface EvidenceState extends ScopedIdentityRows {
    source: SiteIdentityPageEvidence;
    evidenceByPageId: Map<string, SiteIdentityPageEvidence>;
    urlIndex: Map<string, SiteIdentityPageEvidence>;
    mappedClaims: SitePageClaim[];
    sourceOmitted?: boolean;
}

export function rowToSitePageClaim(row: Row): SitePageClaim {
    return {
        sourcePageId: String(row.source_site_page_id),
        targetPageId: String(row.target_site_page_id),
        ...(row.decision_id ? { decisionId: String(row.decision_id) } : {}),
    };
}

export function rowToSiteIdentityDecision(row: Row): SiteIdentityDecision {
    return {
        id: String(row.id),
        sourcePageId: String(row.source_site_page_id),
        ...(row.target_site_page_id ? { targetPageId: String(row.target_site_page_id) } : {}),
        decisionKind: row.decision_kind as SiteIdentityDecisionKind,
        reasonCode: row.reason_code as SiteIdentityReasonCode,
        ...(row.note ? { note: String(row.note) } : {}),
        ...(row.created_by ? { createdBy: String(row.created_by) } : {}),
        createdAt: String(row.created_at),
    };
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(String) : [];
}

function rowToPageEvidence(input: {
    pageId: string;
    primaryUrlRow: Row;
    snapshot?: Row;
    snapshotUrlRow?: Row;
}): SiteIdentityPageEvidence {
    const { pageId, primaryUrlRow, snapshot, snapshotUrlRow } = input;
    const evidence: SiteIdentityPageEvidence = {
        pageId,
        primaryUrl: String(primaryUrlRow.normalized_url),
        redirectHops: asStringArray(snapshot?.redirect_hops),
        discoverySources: asStringArray(snapshotUrlRow?.discovery_sources ?? primaryUrlRow.discovery_sources) as SiteDiscoverySource[],
        limitationFlags: asStringArray(snapshot?.limitation_flags),
    };
    if (!snapshot) return { ...evidence, limitationFlags: ['omitted_from_latest_completed_crawl'] };
    return {
        ...evidence,
        snapshotId: String(snapshot.id),
        observedAt: String(snapshot.observed_at),
        ...(snapshot.title ? { title: String(snapshot.title) } : {}),
        ...(snapshot.fetch_status ? { fetchStatus: snapshot.fetch_status as SitePageObservation['fetchStatus'] } : {}),
        ...(snapshot.status_code !== null && snapshot.status_code !== undefined
            ? { statusCode: Number(snapshot.status_code) }
            : {}),
        ...(snapshot.canonical_url ? { canonicalUrl: String(snapshot.canonical_url) } : {}),
        ...(snapshot.canonical_issue ? {
            canonicalIssue: snapshot.canonical_issue as SitePageObservation['canonicalIssue'],
        } : {}),
    };
}

function buildEvidenceState(rows: ScopedIdentityRows): EvidenceState {
    const urlById = new Map(rows.urls.map(url => [String(url.id), url]));
    const urlsByPageId = new Map<string, Row[]>();
    for (const url of rows.urls) {
        const pageId = String(url.site_page_id);
        urlsByPageId.set(pageId, [...(urlsByPageId.get(pageId) ?? []), url]);
    }

    const latestSnapshotByPageId = new Map<string, Row>();
    const orderedSnapshots = [...rows.snapshots].sort((left, right) => {
        const observedComparison = String(right.observed_at).localeCompare(String(left.observed_at));
        return observedComparison || String(right.id).localeCompare(String(left.id));
    });
    for (const snapshot of orderedSnapshots) {
        const pageId = String(snapshot.site_page_id);
        if (!latestSnapshotByPageId.has(pageId)) latestSnapshotByPageId.set(pageId, snapshot);
    }

    const evidenceByPageId = new Map<string, SiteIdentityPageEvidence>();
    for (const [pageId, pageUrls] of urlsByPageId) {
        const primaryUrlRow = pageUrls.find(url => url.is_primary === true) ?? pageUrls[0];
        const snapshot = latestSnapshotByPageId.get(pageId);
        evidenceByPageId.set(pageId, rowToPageEvidence({
            pageId,
            primaryUrlRow,
            snapshot,
            snapshotUrlRow: snapshot ? urlById.get(String(snapshot.site_page_url_id)) : undefined,
        }));
    }

    const sourcePageId = String(rows.sourcePage.id);
    const source = evidenceByPageId.get(sourcePageId);
    if (!source) throw new SiteIdentityError('read_failed');

    const urlIndex = new Map<string, SiteIdentityPageEvidence>();
    for (const url of rows.urls) {
        const evidence = evidenceByPageId.get(String(url.site_page_id));
        if (evidence) urlIndex.set(String(url.normalized_url), evidence);
    }

    return {
        ...rows,
        source,
        evidenceByPageId,
        urlIndex,
        mappedClaims: rows.claims.map(rowToSitePageClaim),
    };
}

async function readLatestCompletedRunId(
    admin: SupabaseClient,
    organizationId: string,
    clientId: string,
): Promise<string | undefined> {
    const { data, error } = await admin.from('site_crawl_runs').select('id')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('status', 'completed')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data ? String(data.id) : undefined;
}

async function readScopedPage(
    admin: SupabaseClient,
    organizationId: string,
    clientId: string,
    pageId: string,
): Promise<Row | undefined> {
    const { data, error } = await admin.from('site_pages').select('id')
        .eq('organization_id', organizationId)
        .eq('client_id', clientId)
        .eq('id', pageId)
        .maybeSingle();
    if (error) throw error;
    return data as Row | undefined;
}

async function readAllScopedRows(
    admin: SupabaseClient,
    table: 'site_page_urls' | 'site_page_claims',
    orderColumn: 'id' | 'source_site_page_id',
    organizationId: string,
    clientId: string,
): Promise<Row[]> {
    const rows: Row[] = [];
    const seenKeys = new Set<string>();
    let from = 0;
    while (true) {
        const { data, error } = await admin.from(table).select('*')
            .eq('organization_id', organizationId)
            .eq('client_id', clientId)
            .order(orderColumn, { ascending: true })
            .range(from, from + PAGINATION_RANGE_SIZE - 1);
        if (error) throw error;
        if (!Array.isArray(data)) throw new Error('Invalid paginated site identity rows');
        if (data.length === 0) return rows;
        for (const value of data) {
            const row = value as Row;
            const key = row[orderColumn];
            if (typeof key !== 'string' || !key || seenKeys.has(key)) {
                throw new Error('Invalid paginated site identity rows');
            }
            seenKeys.add(key);
            rows.push(row);
        }
        from += data.length;
    }
}

async function readEvidenceState(
    admin: SupabaseClient,
    organizationId: string,
    clientId: string,
    sourcePageId: string,
): Promise<EvidenceState> {
    const [runId, sourcePage] = await Promise.all([
        readLatestCompletedRunId(admin, organizationId, clientId),
        readScopedPage(admin, organizationId, clientId, sourcePageId),
    ]);
    if (!sourcePage) throw new SiteIdentityError('not_found');

    const snapshotsQuery = async () => {
        if (!runId) return [];
        const snapshots: Row[] = [];
        const seen = new Set<string>();
        while (true) {
            const { data, error } = await admin.from('site_page_snapshots').select('*')
                .eq('organization_id', organizationId).eq('client_id', clientId).eq('run_id', runId)
                .order('observed_at', { ascending: false }).order('id', { ascending: false })
                .range(snapshots.length, snapshots.length + PAGINATION_RANGE_SIZE - 1);
            if (error) throw error;
            if (!Array.isArray(data)) throw new SiteIdentityError('read_failed');
            if (!data.length) return snapshots;
            for (const row of data) {
                if (typeof row.id !== 'string' || seen.has(row.id)) throw new SiteIdentityError('read_failed');
                seen.add(row.id);
                snapshots.push(row);
            }
        }
    };
    const [urls, snapshots, claims] = await Promise.all([
        readAllScopedRows(admin, 'site_page_urls', 'id', organizationId, clientId),
        snapshotsQuery(),
        readAllScopedRows(admin, 'site_page_claims', 'source_site_page_id', organizationId, clientId),
    ]);
    const state = buildEvidenceState({
        sourcePage,
        urls,
        snapshots,
        claims,
    });
    const active = state.mappedClaims.find(claim => claim.sourcePageId === sourcePageId);
    if (!state.source.snapshotId && active?.decisionId) {
        const { data: decision, error } = await admin.from('site_page_identity_decisions').select('evidence_snapshot')
            .eq('organization_id', organizationId).eq('client_id', clientId)
            .eq('source_site_page_id', sourcePageId).eq('id', active.decisionId).maybeSingle();
        if (error) throw error;
        const retainedId = decision?.evidence_snapshot?.source?.snapshotId;
        if (typeof retainedId !== 'string') throw new SiteIdentityError('read_failed');
        const { data: snapshot, error: snapshotError } = await admin.from('site_page_snapshots').select('*')
            .eq('organization_id', organizationId).eq('client_id', clientId)
            .eq('site_page_id', sourcePageId).eq('id', retainedId).maybeSingle();
        if (snapshotError || !snapshot) throw new SiteIdentityError('read_failed');
        const primaryUrlRow = urls.find(url => url.site_page_id === sourcePageId && url.is_primary === true)
            ?? urls.find(url => url.site_page_id === sourcePageId)!;
        state.source = rowToPageEvidence({ pageId: sourcePageId, primaryUrlRow, snapshot,
            snapshotUrlRow: urls.find(url => url.id === snapshot.site_page_url_id) });
        state.source.limitationFlags = [...state.source.limitationFlags, 'omitted_from_latest_completed_crawl', 'historical_claim_evidence'];
        state.sourceOmitted = true;
    }
    return state;
}

function signalsForSource(state: EvidenceState): SiteIdentitySignal[] {
    if (state.sourceOmitted) return [];
    const { candidates, unmatchedSignals } = findExactIdentityCandidates({
        sourcePageId: state.source.pageId,
        redirectHops: state.source.redirectHops,
        canonicalUrl: state.source.canonicalUrl,
        sameClientUrlIndex: state.urlIndex,
    });
    return [...candidates.flatMap(candidate => candidate.signals), ...unmatchedSignals];
}

export async function getSiteIdentityActiveClaims(
    admin: SupabaseClient, organizationId: string, clientId: string, cursor?: string,
): Promise<SiteIdentityActiveClaimsPayload> {
    try {
        const [rows, urls] = await Promise.all([
            readAllScopedRows(admin, 'site_page_claims', 'source_site_page_id', organizationId, clientId),
            readAllScopedRows(admin, 'site_page_urls', 'id', organizationId, clientId),
        ]);
        const remaining = rows.filter(row => !cursor || String(row.source_site_page_id) > cursor);
        const page = remaining.slice(0, 50);
        const primaryUrl = (id: string) => String((urls.find(url => url.site_page_id === id && url.is_primary === true)
            ?? urls.find(url => url.site_page_id === id))?.normalized_url ?? id);
        return {
            claims: page.map(row => {
                const claim = rowToSitePageClaim(row);
                return { ...claim, sourcePrimaryUrl: primaryUrl(claim.sourcePageId), targetPrimaryUrl: primaryUrl(claim.targetPageId) };
            }),
            ...(remaining.length > page.length ? { nextCursor: String(page.at(-1)!.source_site_page_id) } : {}),
        };
    } catch { throw new SiteIdentityError('read_failed'); }
}

export async function getSiteIdentityReview(
    admin: SupabaseClient,
    organizationId: string,
    clientId: string,
    pageId: string,
): Promise<SiteIdentityReviewPayload> {
    try {
        const [state, decisionsResult] = await Promise.all([
            readEvidenceState(admin, organizationId, clientId, pageId),
            admin.from('site_page_identity_decisions').select('*')
                .eq('organization_id', organizationId)
                .eq('client_id', clientId)
                .eq('source_site_page_id', pageId)
                .order('created_at', { ascending: false })
                .order('id', { ascending: false }),
        ]);
        if (decisionsResult.error) throw decisionsResult.error;
        const exactCandidates = findExactIdentityCandidates({
            sourcePageId: pageId,
            redirectHops: state.sourceOmitted ? [] : state.source.redirectHops,
            canonicalUrl: state.sourceOmitted ? undefined : state.source.canonicalUrl,
            sameClientUrlIndex: state.urlIndex,
        });
        const candidates = exactCandidates.candidates.map(candidate => {
            const resolution = resolveSitePageClaim(candidate.page.pageId, state.mappedClaims);
            const resolvedPage = state.evidenceByPageId.get(resolution.resolvedPageId);
            return {
                ...candidate,
                resolution,
                claimState: siteIdentityClaimState(candidate.page.pageId, state.mappedClaims),
                ...(resolvedPage ? { resolvedPage } : {}),
            };
        });
        const activeClaim = state.mappedClaims.find(claim => claim.sourcePageId === pageId);
        const activeTarget = activeClaim && state.evidenceByPageId.get(activeClaim.targetPageId);
        const targetResolution = activeClaim && resolveSitePageClaim(activeClaim.targetPageId, state.mappedClaims);
        return {
            source: state.source,
            candidates,
            unmatchedSignals: exactCandidates.unmatchedSignals,
            resolution: resolveSitePageClaim(pageId, state.mappedClaims),
            ...(activeClaim ? { activeClaim } : {}),
            ...(activeTarget && targetResolution ? { activeClaimTarget: {
                page: activeTarget, resolution: targetResolution,
                claimState: siteIdentityClaimState(activeTarget.pageId, state.mappedClaims),
                resolvedPage: state.evidenceByPageId.get(targetResolution.resolvedPageId),
            } } : {}),
            decisions: ((decisionsResult.data ?? []) as Row[]).map(rowToSiteIdentityDecision),
        };
    } catch (error) {
        if (error instanceof SiteIdentityError) throw error;
        throw new SiteIdentityError('read_failed');
    }
}

function persistenceError(error: unknown): SiteIdentityError {
    const message = typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message).toLowerCase()
        : '';
    if (message.includes('snapshot is stale') || message.includes('evidence scope mismatch')) {
        return new SiteIdentityError('stale');
    }
    if (message.includes('scope mismatch')) return new SiteIdentityError('not_found');
    if (
        message.includes('identity state conflict')
        || message.includes('active claim')
        || message.includes('self-claim')
        || message.includes('claim cycle')
        || message.includes('claim depth')
        || message.includes('reopen')
    ) {
        return new SiteIdentityError('conflict');
    }
    return new SiteIdentityError('write_failed');
}

export async function setSiteIdentityDecision(
    admin: SupabaseClient,
    input: SetSiteIdentityDecisionInput,
): Promise<SiteIdentityDecision> {
    let state: EvidenceState;
    try {
        state = await readEvidenceState(admin, input.organizationId, input.clientId, input.sourcePageId);
    } catch (error) {
        if (error instanceof SiteIdentityError) throw error;
        throw new SiteIdentityError('read_failed');
    }

    const activeClaim = state.mappedClaims.find(claim => claim.sourcePageId === input.sourcePageId);
    if ((activeClaim?.decisionId ?? null) !== input.expectedActiveDecisionId) throw new SiteIdentityError('conflict');
    if (input.decisionKind === 'reopen') {
        if (input.targetPageId || !activeClaim) throw new SiteIdentityError('conflict');
    } else if (activeClaim) {
        throw new SiteIdentityError('conflict');
    }
    if (input.decisionKind === 'claim_into' || input.decisionKind === 'keep_separate') {
        if (!input.targetPageId || input.targetPageId === input.sourcePageId) throw new SiteIdentityError('conflict');
    }

    if (!state.source.snapshotId || state.source.snapshotId !== input.expectedSourceSnapshotId) {
        throw new SiteIdentityError('stale');
    }

    let signals: SiteIdentitySignal[];
    try { signals = signalsForSource(state); }
    catch { throw new SiteIdentityError('write_failed'); }
    if (input.targetPageId && !signals.some(signal => signal.matchedPageId === input.targetPageId)) {
        throw new SiteIdentityError('conflict');
    }
    if (input.decisionKind === 'needs_research' && !input.targetPageId
        && !signals.some(signal => !signal.matchedPageId)) throw new SiteIdentityError('conflict');
    const evidenceTargetPageId = input.decisionKind === 'reopen' ? activeClaim?.targetPageId : input.targetPageId;
    let targetResolution: SiteIdentityClaimState | null;
    try { targetResolution = evidenceTargetPageId ? siteIdentityClaimState(evidenceTargetPageId, state.mappedClaims) : null; }
    catch { throw new SiteIdentityError('conflict'); }
    if (!sameSiteIdentityClaimState(input.expectedTargetResolution, targetResolution)) throw new SiteIdentityError('conflict');
    let target: SiteIdentityPageEvidence | undefined;
    if (evidenceTargetPageId) {
        try {
            const targetPage = await readScopedPage(admin, input.organizationId, input.clientId, evidenceTargetPageId);
            if (!targetPage) throw new SiteIdentityError('not_found');
        } catch (error) {
            if (error instanceof SiteIdentityError) throw error;
            throw new SiteIdentityError('read_failed');
        }
        target = state.evidenceByPageId.get(evidenceTargetPageId);
        if (!target) throw new SiteIdentityError('read_failed');
    }

    if (input.decisionKind === 'claim_into') {
        if (!input.expectedTargetSnapshotId || target?.snapshotId !== input.expectedTargetSnapshotId) {
            throw new SiteIdentityError('stale');
        }
    } else if (target?.snapshotId !== input.expectedTargetSnapshotId) {
        throw new SiteIdentityError('stale');
    }

    let evidenceSnapshot: {
        version: 1;
        source: SiteIdentityPageEvidence;
        target?: SiteIdentityPageEvidence;
        signals: SiteIdentitySignal[];
    };
    try {
        evidenceSnapshot = {
            version: 1,
            source: state.source,
            ...(target ? { target } : {}),
            signals,
        };
        if (new TextEncoder().encode(JSON.stringify(evidenceSnapshot)).byteLength >= 262144) {
            throw new SiteIdentityError('write_failed');
        }
    } catch (error) {
        if (error instanceof SiteIdentityError) throw error;
        throw new SiteIdentityError('write_failed');
    }

    try {
        const { data, error } = await admin.rpc('set_site_page_identity_decision', {
            p_organization_id: input.organizationId,
            p_client_id: input.clientId,
            p_created_by: input.createdBy,
            p_source_site_page_id: input.sourcePageId,
            p_target_site_page_id: input.targetPageId ?? null,
            p_decision_kind: input.decisionKind,
            p_reason_code: input.reasonCode,
            p_note: input.note ?? null,
            p_evidence_snapshot: evidenceSnapshot,
            p_expected_active_decision_id: input.expectedActiveDecisionId,
            p_expected_target_resolution: input.expectedTargetResolution,
        });
        if (error) throw persistenceError(error);
        if (!data) throw new SiteIdentityError('write_failed');
        return rowToSiteIdentityDecision(data as Row);
    } catch (error) {
        if (error instanceof SiteIdentityError) throw error;
        throw new SiteIdentityError('write_failed');
    }
}
