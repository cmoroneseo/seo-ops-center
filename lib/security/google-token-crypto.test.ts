import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { toPublicIntegration } from '@/lib/integrations/public-integration';
import {
    credentialSecretState,
    GoogleTokenCryptoError,
    isTokenEnvelope,
    openCredentialSecrets,
    parseKeyRing,
    readKeyRing,
    sealCredentialSecrets,
} from './google-token-crypto';

function material() {
    return randomBytes(32).toString('base64url');
}

test('round trip seals both tokens and leaves property fields readable', () => {
    const ring = parseKeyRing(material());
    const sealed = sealCredentialSecrets({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        site_url: 'sc-domain:example.com',
        property_id: 'properties/15',
        api_key: 'ahrefs-key',
        expiry_date: 42,
    }, ring);
    assert.equal(isTokenEnvelope(sealed.access_token), true);
    assert.equal(isTokenEnvelope(sealed.refresh_token), true);
    assert.equal(sealed.site_url, 'sc-domain:example.com');
    assert.equal(sealed.property_id, 'properties/15');
    assert.equal(sealed.api_key, 'ahrefs-key');
    assert.equal(JSON.stringify(sealed).includes('access-secret'), false);
    assert.equal(JSON.stringify(sealed).includes('refresh-secret'), false);
    const opened = openCredentialSecrets(sealed, ring);
    assert.equal(opened.access_token, 'access-secret');
    assert.equal(opened.refresh_token, 'refresh-secret');
    assert.equal(credentialSecretState(sealed, ring), 'sealed');
});

test('legacy plaintext is returned unchanged and is not sealed without a key', () => {
    const legacy = { access_token: 'plain-access', refresh_token: 'plain-refresh', site_url: 'sc-domain:example.com' };
    assert.equal(openCredentialSecrets(legacy, null).access_token, 'plain-access');
    assert.equal(sealCredentialSecrets(legacy, null).access_token, 'plain-access');
    assert.equal(credentialSecretState(legacy, null), 'plaintext');
    assert.equal(credentialSecretState({ site_url: 'sc-domain:example.com' }, null), 'empty');
});

test('a swapped field envelope does not decrypt', () => {
    const ring = parseKeyRing(material());
    const sealed = sealCredentialSecrets({ access_token: 'access-secret', refresh_token: 'refresh-secret' }, ring);
    const swapped = { ...sealed, access_token: sealed.refresh_token, refresh_token: sealed.access_token };
    assert.throws(() => openCredentialSecrets(swapped, ring), (error: unknown) => error instanceof GoogleTokenCryptoError);
});

test('rotation re-encrypts under the new kid and the old key still opens the previous envelope', () => {
    const first = material();
    const second = material();
    const oldRing = parseKeyRing(`k1:${first}`);
    const sealed = sealCredentialSecrets({ access_token: 'access-secret', refresh_token: 'refresh-secret' }, oldRing);
    const nextRing = parseKeyRing(`k2:${second},k1:${first}`);
    assert.equal(credentialSecretState(sealed, nextRing), 'rotate');
    const rotated = sealCredentialSecrets(sealed, nextRing);
    assert.equal((rotated.access_token as { kid: string }).kid, 'k2');
    assert.equal(openCredentialSecrets(rotated, nextRing).refresh_token, 'refresh-secret');
    assert.equal(openCredentialSecrets(sealed, nextRing).access_token, 'access-secret');
    assert.throws(() => openCredentialSecrets(rotated, oldRing), GoogleTokenCryptoError);
    assert.equal(credentialSecretState(rotated, nextRing), 'sealed');
    assert.deepEqual(sealCredentialSecrets(rotated, nextRing).access_token, rotated.access_token);
});

test('the key ring accepts one key or a named current kid', () => {
    const key = material();
    assert.equal(parseKeyRing(key).currentKid, '1');
    assert.equal(readKeyRing({ GOOGLE_TOKEN_ENC_KEY: '' }), null);
    assert.equal(readKeyRing({}), null);
    const named = readKeyRing({ GOOGLE_TOKEN_ENC_KEY: `k2:${material()},k1:${key}`, GOOGLE_TOKEN_ENC_KEY_ID: 'k1' });
    assert.equal(named?.currentKid, 'k1');
    assert.throws(() => parseKeyRing('not-a-key'), GoogleTokenCryptoError);
    assert.throws(() => parseKeyRing(`k1:${key}`, 'missing'), GoogleTokenCryptoError);
});

test('a public integration projection does not contain sealed token material', () => {
    const ring = parseKeyRing(material());
    const sealed = sealCredentialSecrets({
        access_token: 'access-secret',
        refresh_token: 'refresh-secret',
        google_email: 'am@agency.test',
        site_url: 'sc-domain:example.com',
    }, ring);
    const pub = toPublicIntegration({
        id: '1',
        organization_id: 'org',
        client_id: 'client',
        service: 'gsc',
        credentials: sealed,
        connected_at: '2026-10-15T00:00:00Z',
        sync_status: 'active',
    });
    const json = JSON.stringify(pub);
    assert.equal(json.includes('access-secret'), false);
    assert.equal(json.includes('refresh-secret'), false);
    assert.equal(json.includes((sealed.access_token as { ct: string }).ct), false);
    assert.equal(pub.googleEmail, 'am@agency.test');
    assert.equal(pub.selectedProperty, 'sc-domain:example.com');
});
