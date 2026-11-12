/**
 * Existing pages for the topical-map prompt.
 *
 * Only real HTML pages with a title go in. Images, uploads, stylesheets,
 * scripts, feeds and downloads are dropped, and each URL appears once after
 * normalizeUrl. Pages with the most Search Console impressions come first,
 * then the most recently crawled.
 */

import { normalizeUrl } from '../url/normalize-url';

export interface PromptPageInput {
    pageId: string;
    url: string;
    title?: string;
    h1s: string[];
    wordCount?: number;
    /** ISO crawl time of the snapshot. */
    observedAt?: string;
}

export interface PromptPage extends PromptPageInput {
    normalizedUrl: string;
    impressions: number;
}

const ASSET_PATH_PARTS = ['/wp-content/uploads/', '/wp-includes/', '/wp-json/'];

const ASSET_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'ico', 'bmp', 'tif', 'tiff', 'avif', 'heic',
    'pdf', 'zip', 'rar', 'gz', 'tar', '7z',
    'css', 'js', 'mjs', 'map', 'json', 'xml', 'txt', 'rss', 'atom',
    'mp4', 'mov', 'webm', 'avi', 'm4v', 'mp3', 'wav', 'ogg', 'm4a',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv',
]);

/** True for an http(s) URL that looks like an HTML page, not an image, asset or file. */
export function isHtmlPageUrl(raw: string | null | undefined): boolean {
    const normalized = normalizeUrl(raw);
    if (!normalized) return false;
    const path = new URL(normalized.url).pathname.toLowerCase();
    if (ASSET_PATH_PARTS.some(part => path.includes(part))) return false;
    const lastSegment = path.slice(path.lastIndexOf('/') + 1);
    const dot = lastSegment.lastIndexOf('.');
    if (dot === -1) return true;
    return !ASSET_EXTENSIONS.has(lastSegment.slice(dot + 1));
}

function crawlTime(page: PromptPageInput): number {
    const time = page.observedAt ? Date.parse(page.observedAt) : Number.NaN;
    return Number.isFinite(time) ? time : 0;
}

/**
 * Filter, dedupe and order crawled pages. `pageImpressions` is keyed by
 * normalizeUrl(...).url. When one URL has several snapshots, the latest crawl wins.
 */
export function selectPromptPages(
    pages: readonly PromptPageInput[],
    pageImpressions: ReadonlyMap<string, number>,
): PromptPage[] {
    const byUrl = new Map<string, PromptPage>();
    for (const page of pages) {
        const title = page.title?.trim();
        if (!title || !isHtmlPageUrl(page.url)) continue;
        const normalizedUrl = normalizeUrl(page.url)!.url;
        const current = byUrl.get(normalizedUrl);
        if (current && crawlTime(current) >= crawlTime(page)) continue;
        byUrl.set(normalizedUrl, {
            ...page,
            title,
            normalizedUrl,
            impressions: pageImpressions.get(normalizedUrl) ?? 0,
        });
    }
    return [...byUrl.values()].sort((a, b) =>
        b.impressions - a.impressions
        || crawlTime(b) - crawlTime(a)
        || a.normalizedUrl.localeCompare(b.normalizedUrl));
}
