import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { canonicalDuplicateOf, discoverSitemapPages, isHtmlContentType, isMediaSitemap, parseSitemap } from './discovery.ts';
import { configuredSiteScope, isKnownNonPageAssetUrl } from './url.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const scope = configuredSiteScope('https://example.com/');

/** Serves fixtures by URL and records every URL requested — no network. */
function fakeSite(files: Record<string, string>) {
    const requested: string[] = [];
    const fetchXml = async (url: string) => {
        requested.push(url);
        return files[url];
    };
    return { requested, fetchXml };
}

test('follows a Yoast-style sitemap index from robots.txt and keeps only same-site page URLs', async () => {
    const site = fakeSite({
        'https://example.com/sitemap_index.xml': fixture('sitemap_index.xml'),
        'https://example.com/post-sitemap.xml': fixture('post-sitemap.xml'),
        'https://example.com/page-sitemap.xml': fixture('page-sitemap.xml'),
        'https://example.com/attachment-sitemap.xml': '<urlset><url><loc>https://example.com/?attachment_id=12</loc></url></urlset>',
    });
    const result = await discoverSitemapPages(scope, ['https://example.com/sitemap_index.xml'], site.fetchXml);

    assert.deepEqual(result.pages, [
        'https://example.com/blog/artificial-grass-cost/',
        'https://example.com/blog/pet-turf-guide/',
        'https://example.com/services/',
        'https://example.com/',
        'https://www.example.com/contact/',
    ]);
    assert.equal(result.sitemapsRead, 3);
    assert.ok(!result.pages.some(url => url.includes('/wp-content/')), 'image:loc and /wp-content/ entries are not pages');
    assert.ok(!site.requested.some(url => /attachment|image/.test(url)), 'media sub-sitemaps are never fetched');
    assert.ok(!site.requested.some(url => { const host = new URL(url).hostname; return host === 'other-site.com' || host.endsWith('.other-site.com'); }), 'off-site sitemaps are never fetched');
    assert.ok(site.requested.includes('https://example.com/sitemap.xml'), '/sitemap.xml is always checked too');
});

test('reads a plain urlset at /sitemap.xml when robots.txt lists no sitemap', async () => {
    const site = fakeSite({ 'https://example.com/sitemap.xml': fixture('post-sitemap.xml') });
    const result = await discoverSitemapPages(scope, [], site.fetchXml);
    assert.equal(result.sitemapsRead, 1);
    assert.deepEqual(result.pages, [
        'https://example.com/blog/artificial-grass-cost/',
        'https://example.com/blog/pet-turf-guide/',
        'https://example.com/services/',
    ]);
});

test('no sitemap: missing, broken or HTML soft-404 responses yield no pages so the link crawl takes over', async () => {
    for (const files of [
        {},
        { 'https://example.com/sitemap.xml': '<!doctype html><html><body><a href="/loc">Not found</a></body></html>' },
        { 'https://example.com/sitemap.xml': '<urlset><url><loc>' },
    ]) {
        const result = await discoverSitemapPages(scope, [], fakeSite(files).fetchXml);
        assert.deepEqual(result.pages, []);
    }
    const throwing = await discoverSitemapPages(scope, ['https://example.com/a.xml'], async () => { throw new Error('timeout'); });
    assert.deepEqual(throwing, { sitemapsRead: 0, pages: [] });
});

test('sitemap discovery stops at the sitemap and time limits', async () => {
    const index = (n: number) => `<sitemapindex><sitemap><loc>https://example.com/s${n + 1}.xml</loc></sitemap><sitemap><loc>https://example.com/s${n + 2}.xml</loc></sitemap></sitemapindex>`;
    const requested: string[] = [];
    await discoverSitemapPages(scope, ['https://example.com/s0.xml'], async url => {
        requested.push(url);
        return index(Number(/s(\d+)/.exec(url)?.[1] ?? 0));
    }, { maxSitemaps: 4 });
    assert.equal(requested.length, 4);

    let clock = 0;
    const timed: string[] = [];
    await discoverSitemapPages(scope, ['https://example.com/s0.xml'], async url => {
        timed.push(url);
        clock += 6_000;
        return index(Number(/s(\d+)/.exec(url)?.[1] ?? 0));
    }, { budgetMs: 20_000, now: () => clock });
    assert.equal(timed.length, 4);
});

test('parseSitemap tells an index from a urlset and ignores other documents', () => {
    assert.equal(parseSitemap(fixture('sitemap_index.xml')).kind, 'index');
    assert.equal(parseSitemap(fixture('page-sitemap.xml')).kind, 'urlset');
    assert.deepEqual(parseSitemap('<html><loc>https://example.com/x</loc></html>'), { kind: 'other', locations: [] });
    assert.equal(isMediaSitemap('https://example.com/attachment-sitemap.xml'), true);
    assert.equal(isMediaSitemap('https://example.com/image-sitemap-1.xml'), true);
    assert.equal(isMediaSitemap('https://example.com/page-sitemap.xml'), false);
});

test('link-crawl fallback keeps HTML pages only and dedupes by rel=canonical', () => {
    assert.equal(isHtmlContentType('text/html'), true);
    assert.equal(isHtmlContentType('application/xhtml+xml'), true);
    for (const type of ['image/jpeg', 'application/pdf', 'text/css', undefined]) assert.equal(isHtmlContentType(type), false);

    for (const link of ['https://example.com/wp-content/uploads/2024/05/hero.jpg', 'https://example.com/wp-content/uploads/2024/05/hero-1024x768', 'https://example.com/app.css']) {
        assert.equal(isKnownNonPageAssetUrl(link), true, link);
    }

    assert.equal(canonicalDuplicateOf('https://example.com/services/?utm_source=x', 'https://example.com/services/', scope), 'https://example.com/services/');
    assert.equal(canonicalDuplicateOf('https://example.com/services/', 'https://example.com/services/#top', scope), undefined);
    assert.equal(canonicalDuplicateOf('https://example.com/services/', undefined, scope), undefined);
    assert.equal(canonicalDuplicateOf('https://example.com/services/', 'https://other-site.com/services/', scope), undefined);
});
