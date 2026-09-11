import assert from 'node:assert/strict';
import test from 'node:test';

import {
    configuredSiteScope,
    isUrlInSiteScope,
    normalizeSiteUrl,
} from './url.ts';

test('normalization changes syntax only', () => {
    assert.equal(
        normalizeSiteUrl('HTTPS://Example.COM:443/Path/?b=2&a=1#section'),
        'https://example.com/Path/?b=2&a=1',
    );
    assert.equal(normalizeSiteUrl('http://Example.com:80'), 'http://example.com/');
    assert.notEqual(normalizeSiteUrl('https://example.com/a'), normalizeSiteUrl('https://example.com/a/'));
    assert.notEqual(normalizeSiteUrl('https://example.com/a?x=1'), normalizeSiteUrl('https://example.com/a?x=2'));
});

test('normalization rejects credentials and unsupported or relative URLs', () => {
    assert.throws(() => normalizeSiteUrl('/relative'), /absolute/i);
    assert.throws(() => normalizeSiteUrl('ftp://example.com/a'), /http/i);
    assert.throws(() => normalizeSiteUrl('https://user:pass@example.com/a'), /credentials/i);
    assert.throws(() => normalizeSiteUrl('https://example.com:8080/a'), /port/i);
});

test('configured domain produces a safe HTTPS seed', () => {
    assert.deepEqual(configuredSiteScope('ecoworkz.net'), {
        seedUrl: 'https://ecoworkz.net/',
        configuredHost: 'ecoworkz.net',
        allowedHosts: ['ecoworkz.net', 'www.ecoworkz.net'],
    });
    assert.equal(configuredSiteScope('https://www.ecoworkz.net/services').seedUrl, 'https://www.ecoworkz.net/services');
});

test('scope permits only the configured host and its apex/www counterpart', () => {
    const scope = configuredSiteScope('https://www.ecoworkz.net/');
    assert.equal(isUrlInSiteScope('https://www.ecoworkz.net/a', scope), true);
    assert.equal(isUrlInSiteScope('http://ecoworkz.net/a', scope), true);
    assert.equal(isUrlInSiteScope('https://shop.ecoworkz.net/a', scope), false);
    assert.equal(isUrlInSiteScope('https://ecoworkz.net.example/a', scope), false);
});

test('non-www subdomains do not gain access to their parent domain', () => {
    const scope = configuredSiteScope('https://staging.example.com/');
    assert.deepEqual(scope.allowedHosts, ['staging.example.com']);
    assert.equal(isUrlInSiteScope('https://example.com/', scope), false);
});
