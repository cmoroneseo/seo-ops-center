import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeResultUrl, resultUrlPattern } from './result-url';

test('live result URLs ignore scheme, www, trailing slash, query, and fragment', () => {
    const key = 'example.com/chino';
    assert.equal(normalizeResultUrl('https://www.Example.com/chino/'), key);
    assert.equal(normalizeResultUrl('http://example.com/chino'), key);
    assert.equal(normalizeResultUrl('https://example.com/chino/?utm_source=x&gclid=1#section'), key);
    assert.equal(normalizeResultUrl('HTTPS://WWW.example.com/chino'), key);
    assert.equal(normalizeResultUrl('https://example.com/Chino'), key);
    assert.equal(normalizeResultUrl('https://blog.example.com/chino'), 'blog.example.com/chino');
    assert.equal(normalizeResultUrl('https://example.com/'), 'example.com/');
    assert.equal(normalizeResultUrl('http://www.example.com'), 'example.com/');
    assert.equal(normalizeResultUrl('https://example.com/chino?'), key);
    assert.equal(normalizeResultUrl(''), null);
    assert.equal(normalizeResultUrl('   '), null);
    assert.equal(normalizeResultUrl('example.com/chino'), null);
    assert.equal(normalizeResultUrl('javascript:alert(1)'), null);
    assert.equal(normalizeResultUrl('not a url'), null);
});

test('the page filter matches the same identity and not a longer path', () => {
    const pattern = resultUrlPattern('https://www.example.com/chino/');
    assert.ok(pattern);
    const expression = new RegExp(pattern!, 'i');
    for (const url of [
        'https://www.example.com/chino/',
        'http://example.com/chino',
        'https://example.com/chino?utm_medium=gbp',
        'https://WWW.example.com/chino/#top',
    ]) {
        assert.equal(expression.test(url), true, url);
        assert.equal(normalizeResultUrl(url), 'example.com/chino');
    }
    for (const url of [
        'https://example.com/chino-hills',
        'https://example.com/chino/extra',
        'https://other.example/chino',
        'https://example.com/blog',
    ]) {
        assert.equal(expression.test(url), false, url);
    }

    const root = new RegExp(resultUrlPattern('http://www.example.com/')!, 'i');
    assert.equal(root.test('https://example.com'), true);
    assert.equal(root.test('https://example.com/'), true);
    assert.equal(root.test('https://example.com/?q=1'), true);
    assert.equal(root.test('https://example.com/blog'), false);
    assert.equal(resultUrlPattern('notaurl'), null);
});
