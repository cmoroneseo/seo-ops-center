import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    PROOF_CITATION_HOSTS,
    PROOF_MESSAGES,
    gscPageKey,
    isMissingProof,
    validateProofUrl,
    validatePublishedProof,
} from './proof';

const migration = readFileSync(new URL('../../migrations/076_deliverable_proof.sql', import.meta.url), 'utf8');

test('page keys ignore scheme, www, trailing slash, and tracking params', () => {
    const key = 'example.com/chino';
    assert.equal(gscPageKey('https://www.Example.com/chino/'), key);
    assert.equal(gscPageKey('http://example.com/chino'), key);
    assert.equal(gscPageKey('https://example.com/chino?utm_medium=gbp&utm_source=gmb&gclid=1'), key);
    assert.equal(gscPageKey('https://example.com/chino/?fbclid=abc'), key);
    assert.equal(gscPageKey('https://example.com/chino?x=1'), 'example.com/chino?x=1');
    assert.equal(gscPageKey('https://example.com'), 'example.com/');
    assert.equal(gscPageKey('https://example.com/'), 'example.com/');
    assert.equal(gscPageKey('javascript:alert(1)'), null);
    assert.equal(gscPageKey('not a url'), null);
    assert.equal(gscPageKey(''), null);
});

test('published proof requires a ship date and a client or citation URL', () => {
    const domain = 'https://www.Example.com/services';
    assert.deepEqual(validatePublishedProof({ publishedUrl: '', deliveredOn: '2026-08-06', clientDomain: domain }), {
        ok: false,
        message: PROOF_MESSAGES.missingUrl,
    });
    assert.deepEqual(validatePublishedProof({ publishedUrl: 'https://example.com/a', deliveredOn: '', clientDomain: domain }), {
        ok: false,
        message: PROOF_MESSAGES.missingDate,
    });
    assert.equal(validatePublishedProof({
        publishedUrl: 'javascript:alert(1)',
        deliveredOn: '2026-08-06',
        clientDomain: domain,
    }).ok, false);
    assert.equal(validateProofUrl('https://evil.example/a', domain).ok, false);
    assert.equal(validateProofUrl('https://notexample.com/a', domain).ok, false);
    assert.equal(validateProofUrl('https://example.com.evil.test/a', domain).ok, false);

    const onSite = validatePublishedProof({
        publishedUrl: 'https://blog.example.com/chino/',
        deliveredOn: '2026-08-06T18:00:00.000Z',
        clientDomain: domain,
    });
    assert.equal(onSite.ok, true);
    if (onSite.ok) {
        assert.equal(onSite.url, 'https://blog.example.com/chino/');
        assert.equal(onSite.deliveredOn, '2026-08-06');
    }
    assert.equal(validateProofUrl('https://maps.google.com/maps/place/scott', domain).ok, true);
    assert.equal(validateProofUrl('https://www.yelp.com/biz/scott-cole', null).ok, true);
    assert.equal(validateProofUrl('https://example.com/a', null).ok, false);
    assert.equal(validatePublishedProof({
        publishedUrl: 'https://example.com/a',
        deliveredOn: '2026-02-31',
        clientDomain: domain,
    }).ok, false);
});

test('missing proof is a published row without a URL or a real ship date', () => {
    assert.equal(isMissingProof({ status: 'Published', publishedUrl: null, deliveredOn: '2026-08-06' }), true);
    assert.equal(isMissingProof({ status: 'Published', publishedUrl: 'https://example.com/a', deliveredOn: null }), true);
    assert.equal(isMissingProof({ status: 'Published', publishedUrl: ' https://example.com/a ', deliveredOn: '2026-08-06' }), false);
    assert.equal(isMissingProof({ status: 'Approved', publishedUrl: null, deliveredOn: null }), false);
});

test('the migration allowlist matches the proof hosts', () => {
    for (const host of PROOF_CITATION_HOSTS) {
        assert.equal(migration.includes(`'${host}'`), true, host);
    }
    assert.equal(migration.includes('old.status is not distinct from \'Published\''), true);
    assert.equal(migration.includes('security definer'), false);
});
