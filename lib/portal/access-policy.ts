/**
 * Pure gates for the client portal. Safe to import from middleware (no Node
 * or database clients). A portal session is not an organization member.
 */

export type ActorKind = 'staff' | 'client' | 'none';

export function classifyActor(input: {
    membershipError: boolean;
    membershipCount: number;
    /** `missing_relation` means the migration is not applied yet. */
    contactError: 'none' | 'missing_relation' | 'other';
    contactCount: number;
}): ActorKind {
    if (input.membershipError || input.membershipCount > 0) return 'staff';
    if (input.contactError === 'missing_relation') return 'none';
    // Permission errors fail closed: an authenticated user we cannot prove is
    // staff is kept on portal paths instead of the agency APIs.
    if (input.contactError === 'other' || input.contactCount > 0) return 'client';
    return 'none';
}

export function contactErrorKind(error: { code?: string; message?: string } | null): 'none' | 'missing_relation' | 'other' {
    if (!error) return 'none';
    const message = error.message ?? '';
    if (
        error.code === '42P01'
        || error.code === 'PGRST205'
        || /schema cache/i.test(message)
        || /does not exist/i.test(message)
    ) {
        return 'missing_relation';
    }
    return 'other';
}

/** Paths a client-only session may open. Everything else is staff surface. */
export function clientPortalAllowedPath(pathname: string): boolean {
    if (pathname === '/portal' || pathname.startsWith('/portal/')) return true;
    if (pathname.startsWith('/api/client-portal')) return true;
    if (pathname.startsWith('/auth')) return true;
    if (pathname.startsWith('/review')) return true;
    if (pathname.startsWith('/api/portal')) return true;
    return false;
}

export function isPortalLoginPath(pathname: string): boolean {
    return pathname === '/portal/login' || pathname === '/api/client-portal/login';
}

const REPORT_PATH = /^\/portal\/reports\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Magic-link `next` for a client. Anything outside the portal hub becomes
 * the progress home, including staff routes and protocol-relative URLs.
 */
export function safePortalNext(value: string | null | undefined): string {
    if (!value) return '/portal';
    if (!value.startsWith('/portal')) return '/portal';
    if (value.startsWith('//') || value.includes('\\') || value.includes('://')) return '/portal';
    const path = value.split('?')[0]?.split('#')[0] ?? '';
    if (path === '/portal/login' || path.startsWith('/portal/login/')) return '/portal';
    if (
        path === '/portal'
        || path === '/portal/plan'
        || path === '/portal/pending'
        || path === '/portal/reports'
        || path === '/portal/messages'
        || REPORT_PATH.test(path)
    ) {
        return path;
    }
    return '/portal';
}

export function portalCallbackUrl(siteUrl: string, opts: { portalInvite?: string | null; nextPath?: string | null }): string {
    const url = new URL('/auth/callback', siteUrl);
    if (opts.portalInvite) url.searchParams.set('portal_invite', opts.portalInvite);
    url.searchParams.set('next', safePortalNext(opts.nextPath));
    return url.toString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
    return typeof value === 'string' && UUID.test(value);
}

export function normalizeEmail(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function cleanDisplayName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const name = value.trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 80) return null;
    return name;
}

export function cleanShortText(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (text.length < 1 || text.length > max) return null;
    return text;
}

export function cleanFeedbackBody(value: unknown): string | null {
    return cleanShortText(value, 2000);
}

/** Cap how many review links a signed-in contact can mint for one batch. */
export function reviewHandoffAllowed(recentLinkCount: number, limit = 8): boolean {
    return Number.isInteger(recentLinkCount) && recentLinkCount >= 0 && recentLinkCount < limit;
}

/** A general conversation always belongs to the signed-in contact's client. */
export function generalFeedbackAllowed(subjectId: unknown, clientId: string): boolean {
    return isUuid(subjectId) && subjectId === clientId;
}
