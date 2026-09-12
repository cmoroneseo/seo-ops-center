import type { SupabaseClient } from '@supabase/supabase-js';

import { validateIdentityReason } from './identity.ts';
import {
    SiteIdentityError,
    type SetSiteIdentityDecisionInput,
} from '../supabase/site-identity.ts';
import type {
    SiteIdentityDecision,
    SiteIdentityActiveClaimsPayload,
    SiteIdentityClaimState,
    SiteIdentityDecisionKind,
    SiteIdentityReasonCode,
    SiteIdentityReviewPayload,
} from '../types.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECISION_KINDS = new Set<SiteIdentityDecisionKind>([
    'claim_into',
    'keep_separate',
    'needs_research',
    'reopen',
]);
const REASON_CODES = new Set<SiteIdentityReasonCode>([
    'redirect_alias',
    'canonical_alias',
    'protocol_or_host_variant',
    'duplicate_page',
    'historical_url',
    'distinct_intent',
    'distinct_location',
    'distinct_language',
    'intentional_variant',
    'different_content',
    'content_purpose_unknown',
    'conflicting_signals',
    'target_unfetched',
    'ownership_unknown',
    'incorrect_decision',
    'new_evidence',
    'site_changed',
    'other',
]);

export type SiteIdentityAuthorization =
    | {
        ok: true;
        userId: string;
        actorName?: string;
        organizationId: string;
        clientId: string;
        role: 'owner' | 'admin' | 'member' | 'viewer';
    }
    | { ok: false; status: number; error: string };

export interface SiteIdentityRouteDependencies {
    authorize(clientId: unknown): Promise<SiteIdentityAuthorization>;
    createAdmin(): SupabaseClient;
    getReview(
        admin: SupabaseClient,
        organizationId: string,
        clientId: string,
        pageId: string,
    ): Promise<SiteIdentityReviewPayload>;
    setDecision(admin: SupabaseClient, input: SetSiteIdentityDecisionInput): Promise<SiteIdentityDecision>;
    getActiveClaims(admin: SupabaseClient, organizationId: string, clientId: string, cursor?: string): Promise<SiteIdentityActiveClaimsPayload>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function isSiteIdentityUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function persistenceFailure(error: unknown, operation: 'read' | 'write') {
    if (error instanceof SiteIdentityError) {
        const status = error.code === 'not_found' ? 404
            : error.code === 'stale' || error.code === 'conflict' ? 409
                : 500;
        return json({ error: error.message }, status);
    }
    return json({
        error: operation === 'read'
            ? 'Unable to load the site identity review.'
            : 'Unable to save the site identity decision.',
    }, 500);
}

type ParsedDecision = Omit<
    SetSiteIdentityDecisionInput,
    'organizationId' | 'clientId' | 'createdBy'
>;

function parseDecision(input: Record<string, unknown>): ParsedDecision | null {
    if (!isSiteIdentityUuid(input.pageId)
        || !isSiteIdentityUuid(input.expectedSourceSnapshotId)
        || typeof input.decisionKind !== 'string'
        || !DECISION_KINDS.has(input.decisionKind as SiteIdentityDecisionKind)
        || typeof input.reasonCode !== 'string'
        || !REASON_CODES.has(input.reasonCode as SiteIdentityReasonCode)) {
        return null;
    }

    const decisionKind = input.decisionKind as SiteIdentityDecisionKind;
    if (input.expectedActiveDecisionId !== null && !isSiteIdentityUuid(input.expectedActiveDecisionId)) return null;
    const expectedActiveDecisionId = input.expectedActiveDecisionId as string | null;
    const value = input.expectedTargetResolution;
    let expectedTargetResolution: SiteIdentityClaimState | null = null;
    if (value !== null) {
        if (!isRecord(value) || !Array.isArray(value.path) || !Array.isArray(value.decisionIds)
            || value.path.length < 1 || value.path.length > 33
            || value.decisionIds.length !== value.path.length - 1
            || !value.path.every(isSiteIdentityUuid) || !value.decisionIds.every(isSiteIdentityUuid)
            || new Set(value.path).size !== value.path.length) return null;
        expectedTargetResolution = { path: value.path, decisionIds: value.decisionIds };
    }
    const reasonCode = input.reasonCode as SiteIdentityReasonCode;
    const targetPageId = input.targetPageId === null || input.targetPageId === undefined
        ? undefined
        : isSiteIdentityUuid(input.targetPageId) ? input.targetPageId : null;
    const expectedTargetSnapshotId = input.expectedTargetSnapshotId === null
        || input.expectedTargetSnapshotId === undefined
        ? undefined
        : isSiteIdentityUuid(input.expectedTargetSnapshotId) ? input.expectedTargetSnapshotId : null;
    if (targetPageId === null || expectedTargetSnapshotId === null) return null;

    if (input.note !== undefined && input.note !== null && typeof input.note !== 'string') return null;
    const rawNote = typeof input.note === 'string' ? input.note : '';
    if (rawNote.length > 2000) return null;
    const note = rawNote.trim();
    if (validateIdentityReason(decisionKind, reasonCode, note)) return null;

    if ((decisionKind === 'claim_into' || decisionKind === 'keep_separate') && !targetPageId) return null;
    if (decisionKind === 'claim_into' && !expectedTargetSnapshotId) return null;
    if (targetPageId === input.pageId) return null;
    if (decisionKind === 'reopen') {
        if (targetPageId || !expectedActiveDecisionId || !expectedTargetResolution) return null;
    } else {
        if (expectedActiveDecisionId !== null) return null;
        if (targetPageId ? expectedTargetResolution?.path[0] !== targetPageId : expectedTargetResolution !== null || expectedTargetSnapshotId) return null;
    }

    return {
        sourcePageId: input.pageId,
        ...(targetPageId ? { targetPageId } : {}),
        decisionKind,
        reasonCode,
        ...(note ? { note } : {}),
        expectedSourceSnapshotId: input.expectedSourceSnapshotId,
        expectedActiveDecisionId,
        expectedTargetResolution,
        ...(expectedTargetSnapshotId ? { expectedTargetSnapshotId } : {}),
    };
}

export function createSiteIdentityHandlers(
    dependencies: SiteIdentityRouteDependencies,
) {
    return {
        async GET(request: Request): Promise<Response> {
            const params = new URL(request.url).searchParams;
            const clientId = params.get('clientId');
            const pageId = params.get('pageId');
            const activeClaims = params.get('view') === 'active_claims';
            const cursor = params.get('cursor');
            if (!isSiteIdentityUuid(clientId) || (!activeClaims && !isSiteIdentityUuid(pageId))
                || (cursor !== null && !isSiteIdentityUuid(cursor))) {
                return json({ error: 'Valid clientId and pageId are required' }, 400);
            }

            let authorization: SiteIdentityAuthorization;
            try {
                authorization = await dependencies.authorize(clientId);
            } catch {
                return json({ error: 'Unable to verify client access' }, 500);
            }
            if (!authorization.ok) {
                return json({ error: authorization.error }, authorization.status);
            }

            try {
                const admin = dependencies.createAdmin();
                if (activeClaims) return json(await dependencies.getActiveClaims(admin, authorization.organizationId, authorization.clientId, cursor ?? undefined));
                return json(await dependencies.getReview(
                    admin,
                    authorization.organizationId,
                    authorization.clientId,
                    pageId!,
                ));
            } catch (error) {
                return persistenceFailure(error, 'read');
            }
        },

        async POST(request: Request): Promise<Response> {
            let value: unknown;
            try {
                value = await request.json();
            } catch {
                return json({ error: 'Invalid JSON' }, 400);
            }
            if (!isRecord(value) || !isSiteIdentityUuid(value.clientId)) {
                return json({ error: 'Invalid identity decision' }, 400);
            }

            let authorization: SiteIdentityAuthorization;
            try {
                authorization = await dependencies.authorize(value.clientId);
            } catch {
                return json({ error: 'Unable to verify client access' }, 500);
            }
            if (!authorization.ok) {
                return json({ error: authorization.error }, authorization.status);
            }
            if (authorization.role === 'viewer') {
                return json({ error: 'Forbidden' }, 403);
            }

            const decision = parseDecision(value);
            if (!decision) return json({ error: 'Invalid identity decision' }, 400);

            try {
                const admin = dependencies.createAdmin();
                return json(await dependencies.setDecision(admin, {
                    organizationId: authorization.organizationId,
                    clientId: authorization.clientId,
                    createdBy: authorization.userId,
                    ...decision,
                }));
            } catch (error) {
                return persistenceFailure(error, 'write');
            }
        },
    };
}
