import assert from 'node:assert/strict';
import test from 'node:test';

import { extractHtmlEvidence, extractSitemapLocations } from './extract.ts';

test('extracts page evidence and resolves links without inventing fields', () => {
    const result = extractHtmlEvidence(`<!doctype html><html><head>
      <title>  Outdoor   Living </title>
      <meta name="description" content=" A useful description. ">
      <meta name="robots" content="noindex, follow">
      <link rel="canonical" href="/preferred/">
    </head><body>
      <h1>Build a better yard</h1><h1>Second heading</h1>
      <p>Hello <strong>outdoor</strong> world.</p>
      <a href="/services/">Services</a>
      <a href="/services/" rel="nofollow">Other services</a>
      <a href="mailto:test@example.com">Email</a>
    </body></html>`, 'https://example.com/current/');

    assert.equal(result.title, 'Outdoor Living');
    assert.equal(result.metaDescription, 'A useful description.');
    assert.deepEqual(result.robotsDirectives, ['noindex', 'follow']);
    assert.equal(result.canonicalUrl, 'https://example.com/preferred/');
    assert.deepEqual(result.h1s, ['Build a better yard', 'Second heading']);
    assert.ok(result.wordCount >= 8);
    assert.deepEqual(result.links.map(link => [link.url, link.nofollow]), [
        ['https://example.com/services/', false],
        ['https://example.com/services/', true],
    ]);
});

test('honors a valid base element and tolerates malformed markup', () => {
    const result = extractHtmlEvidence('<base href="https://www.example.com/base/"><title>Broken</title><body><a href="child">Child', 'https://example.com/');
    assert.equal(result.links[0].url, 'https://www.example.com/base/child');
    assert.match(result.title ?? '', /Broken/);
});

test('sitemap extraction supports urlsets and sitemap indexes', () => {
    assert.deepEqual(extractSitemapLocations(`<?xml version="1.0"?><urlset><url><loc>https://example.com/a</loc></url><url><loc> https://example.com/b </loc></url></urlset>`), [
        'https://example.com/a',
        'https://example.com/b',
    ]);
    assert.deepEqual(extractSitemapLocations('<sitemapindex><sitemap><loc>https://example.com/posts.xml</loc></sitemap></sitemapindex>'), ['https://example.com/posts.xml']);
});

test('empty or invalid link targets are omitted', () => {
    const result = extractHtmlEvidence('<a href="#section">Jump</a><a href="javascript:alert(1)">Bad</a><a>No href</a>', 'https://example.com/a');
    assert.deepEqual(result.links, []);
});
