import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRobots, robotsAllows } from './robots.ts';

const rules = parseRobots(`
User-agent: *
Disallow: /private/
Allow: /private/public/
Sitemap: https://example.com/sitemap.xml

User-agent: SEO-Ops-Center-Crawler
Disallow: /crawler-only/
`);

test('robots parser exposes sitemap observations', () => {
    assert.deepEqual(rules.sitemaps, ['https://example.com/sitemap.xml']);
});

test('specific user-agent group takes precedence over wildcard group', () => {
    assert.equal(robotsAllows('https://example.com/private/page', rules, 'SEO-Ops-Center-Crawler'), true);
    assert.equal(robotsAllows('https://example.com/crawler-only/page', rules, 'SEO-Ops-Center-Crawler'), false);
    assert.equal(robotsAllows('https://example.com/private/page', rules, 'OtherBot'), false);
    assert.equal(robotsAllows('https://example.com/private/public/page', rules, 'OtherBot'), true);
});

test('empty disallow allows crawling and longest matching rule wins', () => {
    const parsed = parseRobots('User-agent: *\nDisallow:\nDisallow: /a\nAllow: /a/b');
    assert.equal(robotsAllows('https://example.com/different', parsed), true);
    assert.equal(robotsAllows('https://example.com/a/c', parsed), false);
    assert.equal(robotsAllows('https://example.com/a/b/c', parsed), true);
});
