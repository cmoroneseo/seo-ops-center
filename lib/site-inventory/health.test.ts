import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateCrawlHealth, type CrawlHealthObservation } from './health.ts';

const base = (patch: Partial<CrawlHealthObservation> = {}): CrawlHealthObservation => ({
    pageId: 'page-1',
    url: 'https://example.com/a',
    isHomepage: false,
    sources: ['sitemap'],
    fetchStatus: 'success',
    statusCode: 200,
    contentType: 'text/html',
    redirectCount: 0,
    robotsAllowed: true,
    noindex: false,
    canonicalIssue: 'none',
    title: 'Unique title',
    h1Count: 1,
    inboundInternalLinks: 1,
    ...patch,
});

test('returns no score before a crawl completes', () => {
    assert.equal(calculateCrawlHealth({ status: 'running', capped: false, observations: [base()] }).score, null);
});

test('a clean completed crawl receives all five category weights', () => {
    const result = calculateCrawlHealth({ status: 'completed', capped: false, observations: [base()] });
    assert.equal(result.score, 100);
    assert.deepEqual(result.categories.map(category => [category.key, category.points, category.maxPoints]), [
        ['fetch_reliability', 30, 30],
        ['indexability_conflicts', 25, 25],
        ['canonical_integrity', 20, 20],
        ['metadata_coverage', 15, 15],
        ['internal_discoverability', 10, 10],
    ]);
});

test('applies approved full, half, and quarter deductions with per-page caps', () => {
    const observations = [
        base({ pageId: 'failed', url: 'https://example.com/failed', fetchStatus: 'failed', statusCode: 500, robotsAllowed: undefined, canonicalIssue: undefined, title: undefined, h1Count: undefined, inboundInternalLinks: 0 }),
        base({ pageId: 'redirect', url: 'https://example.com/redirect', redirectCount: 2, canonicalIssue: 'target_redirect', title: '', h1Count: 0, inboundInternalLinks: 0 }),
    ];
    const result = calculateCrawlHealth({ status: 'completed', capped: false, observations });
    const fetch = result.categories.find(item => item.key === 'fetch_reliability')!;
    const canonical = result.categories.find(item => item.key === 'canonical_integrity')!;
    const metadata = result.categories.find(item => item.key === 'metadata_coverage')!;
    assert.equal(fetch.issueUnits, 1.5);
    assert.equal(fetch.points, 7.5);
    assert.equal(canonical.issueUnits, 0.5);
    assert.equal(metadata.issueUnits, 0.75);
    assert.ok(metadata.deductions.every(item => item.issueUnits <= 1));
});

test('intentional noindex only reduces the score when sitemap or GSC evidence conflicts', () => {
    const internalOnly = calculateCrawlHealth({ status: 'completed', capped: false, observations: [base({ sources: ['internal'], noindex: true })] });
    assert.equal(internalOnly.categories.find(item => item.key === 'indexability_conflicts')?.eligibleUrls, 0);
    const conflict = calculateCrawlHealth({ status: 'completed', capped: false, observations: [base({ sources: ['gsc'], noindex: true })] });
    assert.equal(conflict.categories.find(item => item.key === 'indexability_conflicts')?.issueUnits, 1);
});

test('metadata duplicate titles are normalized and homepage is excluded from orphan checks', () => {
    const result = calculateCrawlHealth({
        status: 'completed',
        capped: false,
        observations: [
            base({ pageId: 'home', url: 'https://example.com/', isHomepage: true, title: ' Same  TITLE ', inboundInternalLinks: 0 }),
            base({ pageId: 'child', title: 'same title', inboundInternalLinks: 0 }),
        ],
    });
    assert.equal(result.categories.find(item => item.key === 'metadata_coverage')?.issueUnits, 0.5);
    assert.equal(result.categories.find(item => item.key === 'internal_discoverability')?.deductions.length, 1);
});

test('empty categories are provisional and limitations remain explicit', () => {
    const result = calculateCrawlHealth({
        status: 'completed',
        capped: true,
        observations: [base({ sources: ['internal'], fetchStatus: 'blocked', robotsAllowed: false, canonicalIssue: undefined })],
    });
    assert.equal(result.provisional, true);
    assert.match(result.limitations.join(' '), /cap/i);
    assert.match(result.limitations.join(' '), /blocked/i);
    assert.ok(result.categories.some(category => category.eligibleUrls === 0));
});
