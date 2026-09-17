import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Share-link tokens.
 *
 * The raw token is shown to the internal user exactly once and never stored — only its
 * sha-256 hash lands in `content_share_links.token_hash`. A database leak therefore
 * yields no working links.
 */

/** 32 bytes of entropy, base64url — 256 bits, URL-safe, no padding. */
export function generateToken(): string {
    return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Constant-time hash comparison. Lookups go through the unique index on `token_hash`,
 * so this guards the belt-and-braces re-check after the row is fetched.
 */
export function tokensMatch(token: string, storedHash: string): boolean {
    const candidate = Buffer.from(hashToken(token), 'hex');
    let stored: Buffer;
    try {
        stored = Buffer.from(storedHash, 'hex');
    } catch {
        return false;
    }
    if (candidate.length !== stored.length) return false;
    return timingSafeEqual(candidate, stored);
}

export type ShareLinkDenial = 'revoked' | 'expired' | 'not_found';

export interface ShareLinkGate {
    revokedAt?: string | null;
    expiresAt?: string | null;
}

/**
 * Why a link should be refused, or null when it is usable.
 *
 * Revocation beats expiry: a revoked link that also happens to be expired should read
 * as revoked, because that is the fact the team acted on.
 */
export function shareLinkDenial(
    link: ShareLinkGate | null | undefined,
    now: Date = new Date(),
): ShareLinkDenial | null {
    if (!link) return 'not_found';
    if (link.revokedAt) return 'revoked';
    if (link.expiresAt && new Date(link.expiresAt).getTime() <= now.getTime()) return 'expired';
    return null;
}

/** Default share-link lifetime. */
export const DEFAULT_LINK_TTL_DAYS = 30;

export function defaultExpiry(from: Date = new Date(), days = DEFAULT_LINK_TTL_DAYS): string {
    const d = new Date(from.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString();
}
