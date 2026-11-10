import { generateToken, hashToken, shareLinkDenial, tokensMatch, type ShareLinkDenial } from '@/lib/approvals/token';
import { parseGtmEventsSnapshot, type GtmEventsSnapshot } from './gtm-events';

export interface PublicShareRow {
    tokenHash: string;
    revokedAt: string | null;
    expiresAt: string | null;
    snapshot: unknown;
}

export type PublicShareDecision =
    | { ok: true; snapshot: GtmEventsSnapshot }
    | { ok: false; denial: ShareLinkDenial };

/**
 * The lookup key is the sha-256 of the token. A mismatched hash, a revoked
 * link, and an expired link all refuse the report. Revocation wins over expiry.
 * The snapshot returned here is the client report only.
 */
export function decidePublicShare(link: PublicShareRow | null, token: string, now = new Date()): PublicShareDecision {
    if (!link || !tokensMatch(token, link.tokenHash)) return { ok: false, denial: 'not_found' };
    const denial = shareLinkDenial({ revokedAt: link.revokedAt, expiresAt: link.expiresAt }, now);
    if (denial) return { ok: false, denial };
    const snapshot = parseGtmEventsSnapshot(link.snapshot);
    if (!snapshot) return { ok: false, denial: 'not_found' };
    return { ok: true, snapshot };
}

export async function resolvePublicShare(token: string, deps: {
    now?: () => Date;
    findByHash: (hash: string) => Promise<PublicShareRow | null>;
}): Promise<PublicShareDecision> {
    const hash = hashToken(token);
    const link = await deps.findByHash(hash);
    return decidePublicShare(link, token, deps.now?.() ?? new Date());
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
