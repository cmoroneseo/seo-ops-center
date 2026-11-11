import { generateToken, hashToken, shareLinkDenial, tokensMatch, type ShareLinkDenial } from '@/lib/approvals/token';
import { isUuid } from '@/lib/portal/access-policy';
import { parseGtmEventsSnapshot, type GtmEventsSnapshot } from './gtm-events';

export type PublicLinkKind = 'events' | 'roadmap';

export interface PublicShareRow {
    tokenHash: string;
    revokedAt: string | null;
    expiresAt: string | null;
    snapshot: unknown;
    /**
     * Missing on a row read before migration 127. Those rows are event reports.
     * A roadmap row must say so explicitly.
     */
    kind?: string | null;
    organizationId?: string | null;
    clientId?: string | null;
    reportId?: string | null;
}

export type PublicShareDecision =
    | { ok: true; kind: 'events'; snapshot: GtmEventsSnapshot }
    | { ok: true; kind: 'roadmap'; organizationId: string; clientId: string; reportId: string }
    | { ok: false; denial: ShareLinkDenial };

/** A PostgREST or Postgres error that means the kind column is not there yet. */
export function missingKindColumn(error: { code?: string; message?: string } | null | undefined): boolean {
    if (!error) return false;
    const message = error.message ?? '';
    if (!/\bkind\b/i.test(message)) return false;
    return error.code === '42703' || error.code === 'PGRST204' || /column|schema cache/i.test(message);
}

/**
 * The lookup key is the sha-256 of the token. A mismatched hash, the wrong
 * kind of link, a revoked link, and an expired link all refuse. Revocation
 * wins over expiry, and only after the kind matches this page. Organization,
 * client, and report ids for a roadmap link come from the stored row.
 */
export function decidePublicShare(
    link: PublicShareRow | null,
    token: string,
    now = new Date(),
    expectedKind: PublicLinkKind = 'events',
): PublicShareDecision {
    if (!link || !tokensMatch(token, link.tokenHash)) return { ok: false, denial: 'not_found' };
    const kind = storedKind(link.kind);
    if (kind !== expectedKind) return { ok: false, denial: 'not_found' };
    const denial = shareLinkDenial({ revokedAt: link.revokedAt, expiresAt: link.expiresAt }, now);
    if (denial) return { ok: false, denial };
    if (expectedKind === 'roadmap') {
        const organizationId = link.organizationId ?? '';
        const clientId = link.clientId ?? '';
        const reportId = link.reportId ?? '';
        if (!isUuid(organizationId) || !isUuid(clientId) || !isUuid(reportId)) {
            return { ok: false, denial: 'not_found' };
        }
        return { ok: true, kind: 'roadmap', organizationId, clientId, reportId };
    }
    const snapshot = parseGtmEventsSnapshot(link.snapshot);
    if (!snapshot) return { ok: false, denial: 'not_found' };
    return { ok: true, kind: 'events', snapshot };
}

export async function resolvePublicShare(token: string, deps: {
    now?: () => Date;
    expectedKind?: PublicLinkKind;
    findByHash: (hash: string) => Promise<PublicShareRow | null>;
}): Promise<PublicShareDecision> {
    const hash = hashToken(token);
    const link = await deps.findByHash(hash);
    return decidePublicShare(link, token, deps.now?.() ?? new Date(), deps.expectedKind ?? 'events');
}

/** Blank and missing kinds are event links. Anything else must match exactly. */
function storedKind(kind: string | null | undefined): PublicLinkKind | null {
    if (kind == null || kind === '' || kind === 'events') return 'events';
    if (kind === 'roadmap') return 'roadmap';
    return null;
}

/** The frozen report version's portal blocks. Staff notes on the block are not copied. */
export function snapshotFromFrozenVersion(version: unknown): GtmEventsSnapshot | null {
    if (!version || typeof version !== 'object') return null;
    const portal = (version as { portal?: { sections?: { blocks?: unknown } } }).portal;
    const blocks = portal?.sections?.blocks;
    if (!Array.isArray(blocks)) return null;
    for (const block of blocks) {
        if (!block || typeof block !== 'object') continue;
        const row = block as { type?: unknown; props?: { snapshot?: unknown } };
        if (row.type !== 'gtm_events') continue;
        const snapshot = parseGtmEventsSnapshot(row.props?.snapshot);
        if (snapshot) return snapshot;
    }
    return null;
}

export function newPublicToken(): { token: string; tokenHash: string } {
    const token = generateToken();
    return { token, tokenHash: hashToken(token) };
}
