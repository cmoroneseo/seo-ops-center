/**
 * Shared page identity for SEO URLs.
 *
 * Drops the fragment, including Wix `#viewer-*`, and every `utm_*` parameter.
 * Other query parameters stay, so city pages and filtered URLs do not collapse
 * together. A Google Business Profile or Maps URL, or any URL carrying
 * `utm_medium=gbp`, is classified `gbp_link`.
 */

export type UrlSurface = 'organic' | 'gbp_link';

export interface NormalizedUrl {
    /** Absolute http(s) URL with the fragment and `utm_*` parameters removed. */
    url: string;
    surface: UrlSurface;
}

const GBP_HOSTS = new Set([
    'g.page',
    'maps.app.goo.gl',
    'business.google',
    'business.google.com',
]);

function bareHost(hostname: string): string {
    const host = hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
}

function isGbpMapsUrl(url: URL): boolean {
    const host = bareHost(url.hostname);
    if (GBP_HOSTS.has(host) || host.endsWith('.g.page') || host.startsWith('maps.google.')) return true;
    if (host === 'google.com' || host.endsWith('.google.com')) {
        return url.pathname === '/maps' || url.pathname.startsWith('/maps/');
    }
    return false;
}

/** `utm_medium=gbp` in the query, including the percent-encoded `=` form. */
function hasGbpMedium(url: URL, raw: string): boolean {
    for (const [key, value] of url.searchParams.entries()) {
        if (key.toLowerCase() === 'utm_medium' && value.toLowerCase() === 'gbp') return true;
    }
    const hashAt = raw.indexOf('#');
    const beforeHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
    const queryAt = beforeHash.indexOf('?');
    if (queryAt === -1) return false;
    return /(?:^|&)utm_medium(?:=|%3d)gbp(?:&|$)/i.test(beforeHash.slice(queryAt + 1));
}

function stripUtm(url: URL): void {
    const keys = new Set<string>();
    for (const key of url.searchParams.keys()) {
        if (key.toLowerCase().startsWith('utm_')) keys.add(key);
    }
    for (const key of keys) url.searchParams.delete(key);
}

export function normalizeUrl(raw: string | null | undefined): NormalizedUrl | null {
    if (!raw?.trim()) return null;
    let url: URL;
    try {
        url = new URL(raw.trim());
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;

    const surface: UrlSurface = isGbpMapsUrl(url) || hasGbpMedium(url, raw) ? 'gbp_link' : 'organic';
    url.hash = '';
    stripUtm(url);
    return { url: url.toString(), surface };
}
