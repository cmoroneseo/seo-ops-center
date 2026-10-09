/**
 * Proof a deliverable is actually shipped: a live URL and a ship date.
 * This is not behind the search-reporting flag. The database trigger in
 * migration 076 is the backstop and uses the same host list.
 */

/** Registrable hosts for a Google Business Profile or a local citation. */
export const PROOF_CITATION_HOSTS = [
    'google.com',
    'g.page',
    'business.google',
    'maps.app.goo.gl',
    'yelp.com',
    'facebook.com',
    'bbb.org',
    'yellowpages.com',
    'angi.com',
    'angieslist.com',
    'thumbtack.com',
    'nextdoor.com',
    'bing.com',
    'mapquest.com',
    'apple.com',
    'foursquare.com',
    'tripadvisor.com',
    'houzz.com',
    'homeadvisor.com',
    'manta.com',
    'superpages.com',
    'merchantcircle.com',
    'alignable.com',
    'linkedin.com',
] as const;

export const PROOF_MESSAGES = {
    missingUrl: 'Add the live page URL before marking this Published.',
    missingDate: 'Add the ship date before marking this Published.',
    badUrl: 'The live URL has to start with http:// or https://.',
    offDomain: 'The live URL has to be on the client domain, or on a known Business Profile or citation site.',
    hint: 'Published work needs a live http(s) URL on the client domain, or on a known Business Profile or citation site, and a ship date.',
} as const;

const TRACKING_PARAMS = new Set([
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    'utm_id',
    'gclid',
    'fbclid',
    'msclkid',
    'gbraid',
    'wbraid',
]);

export type ProofSuccess = { ok: true; url: string; deliveredOn: string };
export type ProofFailure = { ok: false; message: string };
export type ProofResult = ProofSuccess | ProofFailure;

function stripWww(host: string): string {
    return host.startsWith('www.') ? host.slice(4) : host;
}

function hostMatches(host: string, root: string): boolean {
    return host === root || host.endsWith(`.${root}`);
}

export function parseHttpUrl(raw: string | null | undefined): URL | null {
    if (!raw?.trim()) return null;
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname || !/^[a-z0-9.-]+$/i.test(url.hostname)) return null;
    return url;
}

/** Client domains are stored as a host, a URL, or a URL with a path. */
export function canonicalDomain(raw: string | null | undefined): string | null {
    if (!raw?.trim()) return null;
    const trimmed = raw.trim();
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = parseHttpUrl(withScheme);
    if (!url) return null;
    const host = stripWww(url.hostname.toLowerCase());
    return host || null;
}

export function proofHost(raw: string | null | undefined): string | null {
    const url = parseHttpUrl(raw);
    if (!url) return null;
    return stripWww(url.hostname.toLowerCase());
}

export function isCitationHost(host: string): boolean {
    return PROOF_CITATION_HOSTS.some(root => hostMatches(host, root));
}

export function isClientHost(host: string, clientDomain: string | null | undefined): boolean {
    const domain = canonicalDomain(clientDomain);
    if (!domain) return false;
    return hostMatches(host, domain);
}

/**
 * GSC page identity: scheme, www, trailing slash, and tracking params do not
 * make a different page. Other query params stay, so a filtered URL does not
 * join the bare page.
 */
export function gscPageKey(raw: string | null | undefined): string | null {
    const url = parseHttpUrl(raw);
    if (!url) return null;
    const host = stripWww(url.hostname.toLowerCase());
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const kept: [string, string][] = [];
    for (const [key, value] of url.searchParams.entries()) {
        if (TRACKING_PARAMS.has(key.toLowerCase())) continue;
        kept.push([key, value]);
    }
    kept.sort((a, b) => a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0]));
    const query = kept.map(([key, value]) => `${key}=${value}`).join('&');
    return query ? `${host}${path}?${query}` : `${host}${path}`;
}

export function normalizeShipDate(value: string | null | undefined): string | null {
    if (!value?.trim()) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

export function validateProofUrl(raw: string | null | undefined, clientDomain: string | null | undefined): { ok: true; url: string } | ProofFailure {
    const url = parseHttpUrl(raw);
    if (!url) return { ok: false, message: PROOF_MESSAGES.badUrl };
    const host = stripWww(url.hostname.toLowerCase());
    if (!isClientHost(host, clientDomain) && !isCitationHost(host)) {
        return { ok: false, message: PROOF_MESSAGES.offDomain };
    }
    return { ok: true, url: raw!.trim() };
}

/** Both fields, checked only when a deliverable is moving to Published. */
export function validatePublishedProof(input: {
    publishedUrl: string | null | undefined;
    deliveredOn: string | null | undefined;
    clientDomain: string | null | undefined;
}): ProofResult {
    if (!input.publishedUrl?.trim()) return { ok: false, message: PROOF_MESSAGES.missingUrl };
    const deliveredOn = normalizeShipDate(input.deliveredOn);
    if (!deliveredOn) return { ok: false, message: PROOF_MESSAGES.missingDate };
    const url = validateProofUrl(input.publishedUrl, input.clientDomain);
    if (!url.ok) return url;
    return { ok: true, url: url.url, deliveredOn };
}

export function isMissingProof(row: {
    status: string;
    publishedUrl?: string | null;
    deliveredOn?: string | null;
}): boolean {
    return row.status === 'Published' && (!row.publishedUrl?.trim() || !normalizeShipDate(row.deliveredOn));
}
