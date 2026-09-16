import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';

import {
    buildJwtParts,
    DOCS_SCOPES,
    isCacheValid,
    parseServiceAccount,
    signJwt,
} from './service-account.ts';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
});

test('parseServiceAccount unescapes the PEM newlines an env var mangles', () => {
    // This is the failure that costs an afternoon: pasted into Vercel, the key's real
    // newlines become the two characters backslash-n, and createSign rejects it with an
    // error that names nothing useful.
    const escaped = privateKey.replace(/\n/g, '\\n');
    const creds = parseServiceAccount(
        JSON.stringify({ client_email: 'svc@project.iam.gserviceaccount.com', private_key: escaped }),
    );
    assert.ok(creds);
    assert.ok(creds.privateKey.includes('\n'), 'newlines must be restored');
    assert.equal(creds.privateKey, privateKey);
    assert.equal(creds.tokenUri, 'https://oauth2.googleapis.com/token', 'defaults when absent');
});

test('parseServiceAccount accepts an already-unescaped key', () => {
    const creds = parseServiceAccount(
        JSON.stringify({ client_email: 'svc@x.iam.gserviceaccount.com', private_key: privateKey }),
    );
    assert.equal(creds?.privateKey, privateKey);
});

test('parseServiceAccount rejects missing, malformed, and incomplete credentials', () => {
    assert.equal(parseServiceAccount(undefined), null);
    assert.equal(parseServiceAccount(''), null);
    assert.equal(parseServiceAccount('   '), null);
    assert.equal(parseServiceAccount('not json'), null);
    assert.equal(parseServiceAccount('{}'), null);
    assert.equal(parseServiceAccount(JSON.stringify({ client_email: 'a@b.c' })), null);
    assert.equal(
        parseServiceAccount(JSON.stringify({ client_email: 'a@b.c', private_key: 'nonsense' })),
        null,
        'a key that is not a PEM must be refused up front, not at signing time',
    );
});

test('parseServiceAccount honours a custom token_uri', () => {
    const creds = parseServiceAccount(
        JSON.stringify({
            client_email: 'a@b.c',
            private_key: privateKey,
            token_uri: 'https://oauth2.example.test/token',
        }),
    );
    assert.equal(creds?.tokenUri, 'https://oauth2.example.test/token');
});

test('buildJwtParts produces the claim set Google requires', () => {
    const now = new Date('2026-09-16T12:00:00Z');
    const { claims, header } = buildJwtParts(
        { clientEmail: 'svc@project.iam.gserviceaccount.com', tokenUri: 'https://oauth2.googleapis.com/token' },
        DOCS_SCOPES,
        now,
    );
    assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
    assert.equal(claims.iss, 'svc@project.iam.gserviceaccount.com');
    assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
    const expectedIat = Math.floor(now.getTime() / 1000);
    assert.equal(claims.iat, expectedIat);
    assert.equal(claims.exp, expectedIat + 3600, 'Google rejects assertions valid beyond an hour');
    assert.match(String(claims.scope), /documents\.readonly/);
    assert.match(String(claims.scope), /drive\.readonly/);
});

test('buildJwtParts base64url-encodes with no padding', () => {
    const { signingInput } = buildJwtParts({ clientEmail: 'a@b.c', tokenUri: 'https://t' }, 'scope');
    assert.match(signingInput, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.ok(!signingInput.includes('='), 'base64url carries no padding');
});

test('signJwt produces a signature the public key verifies', () => {
    const creds = { clientEmail: 'svc@x.iam.gserviceaccount.com', privateKey, tokenUri: 'https://oauth2.googleapis.com/token' };
    const jwt = signJwt(creds, DOCS_SCOPES, new Date('2026-09-16T12:00:00Z'));

    const [headerB64, claimsB64, signature] = jwt.split('.');
    assert.ok(signature && signature.length > 0);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${headerB64}.${claimsB64}`);
    verifier.end();
    assert.equal(
        verifier.verify(publicKey, Buffer.from(signature, 'base64url')),
        true,
        'the assertion must verify, or Google returns invalid_grant',
    );
});

test('isCacheValid refreshes early rather than racing the expiry', () => {
    const now = 1_000_000;
    assert.equal(isCacheValid(null, now), false);
    assert.equal(isCacheValid({ token: 't', expiresAt: now + 300_000 }, now), true);
    assert.equal(isCacheValid({ token: 't', expiresAt: now - 1 }, now), false);
    assert.equal(
        isCacheValid({ token: 't', expiresAt: now + 30_000 }, now),
        false,
        'inside the skew window the token is treated as already stale',
    );
});
