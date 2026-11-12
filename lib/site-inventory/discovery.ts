import * as cheerio from 'cheerio';

import { isKnownNonPageAssetUrl, isUrlInSiteScope, normalizeSiteUrl, type SiteScope } from './url.ts';

export const MAX_SITEMAPS = 25;
/** Discovery runs inside a 60s serverless request, which also has to enqueue the pages it finds. */
const SITEMAP_BUDGET_MS = 20_000;

function localName(name: string | undefined) {
    return (name ?? '').toLowerCase().split(':').pop() ?? '';
}

/** Reads a urlset or sitemap index. Only direct <url>/<sitemap> → <loc> children count, so image:loc entries are ignored. */
export function parseSitemap(xml: string): { kind: 'index' | 'urlset' | 'other'; locations: string[] } {
    const $ = cheerio.load(xml, { xmlMode: true });
    const root = $.root().children().first();
    const rootName = localName(root.get(0)?.tagName);
    const kind = rootName === 'sitemapindex' ? 'index' : rootName === 'urlset' ? 'urlset' : 'other';
    if (kind === 'other') return { kind, locations: [] };
    const entryName = kind === 'index' ? 'sitemap' : 'url';
    const locations: string[] = [];
    root.children().each((_index, entry) => {
        if (localName(entry.tagName) !== entryName) return;
        const loc = $(entry).children().filter((_i, child) => localName(child.tagName) === 'loc').first().text().trim();
        if (loc) locations.push(loc);
    });
    return { kind, locations };
}

/** Image and attachment sub-sitemaps list media files, not pages. */
export function isMediaSitemap(url: string) {
    const segment = new URL(url).pathname.split('/').pop() ?? '';
    return /image|attachment/i.test(segment);
}

/**
 * Reads robots.txt Sitemap: lines plus /sitemap.xml, follows sitemap indexes, and returns the
 * same-site page URLs they list (first-seen order, deduped). Empty pages means "no usable sitemap".
 */
export async function discoverSitemapPages(
    scope: SiteScope,
    robotsSitemaps: string[],
    fetchXml: (url: string) => Promise<string | undefined>,
    { maxSitemaps = MAX_SITEMAPS, budgetMs = SITEMAP_BUDGET_MS, now = Date.now } = {},
) {
    const deadline = now() + budgetMs;
    const queue = [...robotsSitemaps, new URL('/sitemap.xml', scope.seedUrl).toString()];
    const visited = new Set<string>();
    const pages = new Map<string, string>();
    let sitemapsRead = 0;
    while (queue.length > 0 && visited.size < maxSitemaps && now() < deadline) {
        let url: string;
        try {
            url = normalizeSiteUrl(queue.shift()!);
        } catch {
            continue;
        }
        if (visited.has(url) || !isUrlInSiteScope(url, scope) || isMediaSitemap(url)) continue;
        visited.add(url);
        let xml: string | undefined;
        try {
            xml = await fetchXml(url);
        } catch {
            continue; // A broken sitemap limits discovery but never loosens scope.
        }
        if (!xml) continue;
        const parsed = parseSitemap(xml);
        if (parsed.kind === 'other') continue;
        sitemapsRead += 1;
        for (const location of parsed.locations) {
            try {
                const normalized = normalizeSiteUrl(location);
                if (!isUrlInSiteScope(normalized, scope)) continue;
                if (parsed.kind === 'index') queue.push(normalized);
                else if (!isKnownNonPageAssetUrl(normalized) && !pages.has(normalized)) pages.set(normalized, location);
            } catch { /* Skip unparseable locations. */ }
        }
    }
    return { sitemapsRead, pages: [...pages.values()] };
}

export function isHtmlContentType(contentType: string | undefined) {
    return contentType === 'text/html' || contentType === 'application/xhtml+xml';
}

/** In the link-crawl fallback, a page whose in-scope canonical points elsewhere is a duplicate of that canonical. */
export function canonicalDuplicateOf(pageUrl: string, canonicalUrl: string | undefined, scope: SiteScope) {
    if (!canonicalUrl || !isUrlInSiteScope(canonicalUrl, scope)) return undefined;
    const canonical = normalizeSiteUrl(canonicalUrl);
    return canonical === normalizeSiteUrl(pageUrl) || isKnownNonPageAssetUrl(canonical) ? undefined : canonical;
}
