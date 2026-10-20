/**
 * One identity for a live URL against Search Console page rows.
 * Scheme, www, a trailing slash, the query string, and the fragment do not
 * make a different page.
 */

import { parseHttpUrl } from './proof';

export function normalizeResultUrl(raw: string | null | undefined): string | null {
    const url = parseHttpUrl(raw);
    if (!url) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return null;
    let path = url.pathname.replace(/\/+$/, '');
    try {
        path = decodeURIComponent(path);
    } catch {
        // Keep the parsed path when a percent sequence is not valid encoding.
    }
    path = path.toLowerCase();
    return `${host}${path || '/'}`;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Search Analytics page filter for the same identity.
 * Rows are still checked with `normalizeResultUrl` after they come back.
 */
export function resultUrlPattern(raw: string | null | undefined): string | null {
    const url = parseHttpUrl(raw);
    if (!url) return null;
    const host = escapeRegExp(url.hostname.toLowerCase().replace(/^www\./, ''));
    if (!host) return null;
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    const body = path ? escapeRegExp(path) : '';
    return `^https?://(www\\.)?${host}${body}/?(\\?[^#]*)?(\\#.*)?$`;
}
