import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isHtmlPageUrl, selectPromptPages, type PromptPageInput } from './prompt-pages.ts';
import { pageImpressionsFromFacts } from './architect-gsc.ts';
import { buildUserMessage } from './generate-prompt.ts';

const site = 'https://ecoworkz.com';

function page(path: string, extra: Partial<PromptPageInput> = {}): PromptPageInput {
    return {
        pageId: path,
        url: `${site}${path}`,
        title: `Title ${path}`,
        h1s: [],
        wordCount: 500,
        observedAt: '2026-11-01T00:00:00Z',
        ...extra,
    };
}

test('asset, upload and file URLs are not pages', () => {
    for (const path of [
        '/wp-content/uploads/2024/05/hero',
        '/wp-content/uploads/2024/05/hero.jpg',
        '/img/logo.PNG', '/a.jpeg', '/a.webp', '/a.gif', '/a.svg', '/favicon.ico',
        '/brochure.pdf', '/files/kit.zip', '/style.css', '/app.js', '/sitemap.xml', '/video.mp4',
    ]) {
        assert.equal(isHtmlPageUrl(`${site}${path}`), false, path);
    }
    for (const path of ['/', '/services', '/blog/how-to-clean/', '/about.html', '/v1.2/page']) {
        assert.equal(isHtmlPageUrl(`${site}${path}`), true, path);
    }
    assert.equal(isHtmlPageUrl('/relative-only'), false);
    assert.equal(isHtmlPageUrl('mailto:hi@ecoworkz.com'), false);
});

test('assets and untitled rows are dropped from the prompt list', () => {
    const pages = selectPromptPages([
        page('/services'),
        page('/wp-content/uploads/2024/05/hero.jpg'),
        page('/brochure.pdf'),
        page('/untitled', { title: undefined }),
        page('/blank-title', { title: '   ' }),
    ], new Map());
    assert.deepEqual(pages.map(p => p.url), [`${site}/services`]);
});

test('the homepage appears once however many snapshots and URL variants it has', () => {
    const pages = selectPromptPages([
        page('/', { pageId: 'home', observedAt: '2026-11-03T00:00:00Z', title: 'Newest' }),
        page('/', { pageId: 'home', observedAt: '2026-10-01T00:00:00Z', title: 'Older' }),
        page('/?utm_source=newsletter', { pageId: 'home-utm', observedAt: '2026-09-01T00:00:00Z' }),
        page('/#viewer-k3f9a', { pageId: 'home-hash', observedAt: '2026-08-01T00:00:00Z' }),
        page('/services'),
    ], new Map());
    const homes = pages.filter(p => p.normalizedUrl === `${site}/`);
    assert.equal(homes.length, 1);
    assert.equal(homes[0]?.title, 'Newest');
    assert.equal(pages.length, 2);
});

test('pages are ordered by Search Console impressions, then by latest crawl', () => {
    const impressions = pageImpressionsFromFacts([
        { query: 'a', page: `${site}/low`, clicks: 0, impressions: 5, position: 9 },
        { query: 'b', page: `${site}/top?utm_medium=email`, clicks: 1, impressions: 300, position: 3 },
        { query: 'c', page: `${site}/top`, clicks: 1, impressions: 200, position: 4 },
        { query: 'd', page: `${site}/mid`, clicks: 0, impressions: 50, position: 7 },
    ]);
    assert.equal(impressions.get(`${site}/top`), 500);

    const pages = selectPromptPages([
        page('/old-no-gsc', { observedAt: '2026-01-01T00:00:00Z' }),
        page('/low', { observedAt: '2026-11-05T00:00:00Z' }),
        page('/new-no-gsc', { observedAt: '2026-11-09T00:00:00Z' }),
        page('/mid', { observedAt: '2026-02-01T00:00:00Z' }),
        page('/top', { observedAt: '2026-03-01T00:00:00Z' }),
    ], impressions);
    assert.deepEqual(pages.map(p => p.url.slice(site.length)), ['/top', '/mid', '/low', '/new-no-gsc', '/old-no-gsc']);
    assert.deepEqual(pages.map(p => p.impressions), [500, 50, 5, 0, 0]);
});

test('the architect route filters pages and its AI timeout fits inside maxDuration', () => {
    const route = readFileSync(new URL('../../app/api/topical-map/generate-architect/route.ts', import.meta.url), 'utf8');
    assert.match(route, /selectPromptPages\(/);
    assert.match(route, /loadArchitectGscContext\(/);
    const maxDuration = Number(route.match(/export const maxDuration = (\d+);/)?.[1]);
    const timeoutMs = Number(route.match(/timeout: ([\d_]+),/)?.[1]?.replaceAll('_', ''));
    assert.equal(maxDuration, 300);
    assert.ok(timeoutMs > 120_000, 'longer than the old 120s');
    assert.ok(timeoutMs <= (maxDuration - 60) * 1000, 'leaves a minute for DB reads and inserts');
    assert.match(route, /maxRetries: 0/);
});

test('the prompt keeps the 40-page cap and lists the highest-impression page first', () => {
    const raw = Array.from({ length: 60 }, (_, i) => page(`/p${i}`));
    const impressions = new Map([[`${site}/p59`, 1000], [`${site}/p0`, 10]]);
    const pages = selectPromptPages(raw, impressions);
    const message = buildUserMessage({
        profile: { brandName: 'Ecoworkz', businessDescription: 'x', contentLanguage: 'en', focusTopics: [], rivals: [] },
        existingPages: pages,
        gscQueries: [],
        clientDomain: 'ecoworkz.com',
    });
    const listed = message.split('\n').filter(line => line.startsWith(`- ${site}/`));
    assert.equal(listed.length, 40);
    assert.ok(listed[0]?.startsWith(`- ${site}/p59 |`));
    assert.ok(listed[1]?.startsWith(`- ${site}/p0 |`));
});
