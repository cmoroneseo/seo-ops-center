import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyFavicon, propertyHost, withPropertyLogos } from './property-branding';

test('domain and www URL-prefix variants share branding without changing property identity', () => {
    const sites = ['sc-domain:example.com', 'https://www.example.com/blog/', 'https://shop.example.com/'].map(siteUrl => ({ siteUrl, permissionLevel: 'siteOwner' }));
    const result = withPropertyLogos(sites, [{ domain: 'https://example.com', logoUrl: 'https://assets.example.com/logo.png' }]);
    assert.equal(result[0].logoUrl, result[1].logoUrl);
    assert.equal(result[1].siteUrl, 'https://www.example.com/blog/');
    assert.equal(result[2].logoUrl, undefined);
});

test('saved property supplies missing domain and conflicting brands fall back', () => {
    const sites = [{ siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' }];
    const brand = { savedProperty: 'https://www.example.com/', logoUrl: 'https://assets.example.com/logo.png' };
    assert.equal(withPropertyLogos(sites, [brand])[0].logoUrl, brand.logoUrl);
    assert.equal(withPropertyLogos(sites, [brand, { domain: 'example.com', logoUrl: 'https://assets.example.com/other.png' }])[0].logoUrl, undefined);
    assert.equal(withPropertyLogos(sites, [{ ...brand, logoUrl: 'javascript:alert(1)' }])[0].logoUrl, undefined);
});

test('favicon lookup includes only the public host and no paths or query data', () => {
    assert.equal(propertyFavicon('https://www.example.com/private/?key=secret'), 'https://www.google.com/s2/favicons?domain=example.com&sz=64');
    for (const input of ['http://127.0.0.1/', 'http://[::1]/', 'http://localhost', 'sc-domain:company.internal', 'https://user:pass@example.com/']) {
        assert.equal(propertyFavicon(input), undefined);
    }
    assert.equal(propertyHost('sc-domain:EXAMPLE.COM'), 'example.com');
});
