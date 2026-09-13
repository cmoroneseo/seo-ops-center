import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, matchesSiteDomain, pageBelongsToProperty } from './domain.ts';

test('site domain parsing canonicalizes case, URL schemes, www, ports, paths, and query fragments', () => {
    for (const value of ['EXAMPLE.COM', ' https://WWW.Example.COM:8443/a?x=1#top ', 'example.com:443?x=1', 'example.com.']) {
        assert.equal(normalizeDomain(value), 'example.com');
    }
    assert.equal(normalizeDomain('https://bücher.example'), 'xn--bcher-kva.example');
});

test('site domains reject non-web URLs, credentials, malformed DNS, and empty hosts', () => {
    for (const value of ['', 'https://', 'ftp://example.com', 'https://user:pass@example.com', 'bad domain.com',
        'localhost', '127.0.0.1', '-example.com', 'bad_domain.com', 'example..com']) assert.equal(normalizeDomain(value), null);
});

test('domain matching requires an exact host or subdomain boundary', () => {
    assert.equal(matchesSiteDomain('www.EXAMPLE.com', 'example.com'), true);
    assert.equal(matchesSiteDomain('shop.example.com', 'example.com'), true);
    assert.equal(matchesSiteDomain('notexample.com', 'example.com'), false);
    assert.equal(matchesSiteDomain('example.com.attacker.test', 'example.com'), false);
});

test('GSC scope retains exact URL-prefix origin/path and domain-property boundaries', () => {
    assert.equal(pageBelongsToProperty('https://shop.example.com/a', 'sc-domain:example.com'), true);
    assert.equal(pageBelongsToProperty('https://example.com.evil.test/a', 'sc-domain:example.com'), false);
    assert.equal(pageBelongsToProperty('https://example.com/a', 'sc-domain:www.example.com'), false);
    assert.equal(pageBelongsToProperty('https://example.com/blog/a', 'https://example.com/blog/'), true);
    assert.equal(pageBelongsToProperty('https://example.com/blogger/a', 'https://example.com/blog/'), false);
    assert.equal(pageBelongsToProperty('http://example.com/blog/a', 'https://example.com/blog/'), false);
    assert.equal(pageBelongsToProperty('https://www.example.com/blog/a', 'https://example.com/blog/'), false);
});
