import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_LINK_TTL_DAYS,
    defaultExpiry,
    generateToken,
    hashToken,
    shareLinkDenial,
    tokensMatch,
} from './token.ts';

test('generateToken produces distinct URL-safe tokens', () => {
    const a = generateToken();
    const b = generateToken();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Za-z0-9_-]+$/, 'must be URL-safe with no padding');
    assert.ok(a.length >= 43, 'must carry at least 256 bits of entropy');
});

test('hashToken is stable and does not echo the token', () => {
    const token = generateToken();
    assert.equal(hashToken(token), hashToken(token));
    assert.notEqual(hashToken(token), token);
    assert.equal(hashToken(token).length, 64, 'sha-256 hex');
});

test('tokensMatch accepts the real token and rejects near misses', () => {
    const token = generateToken();
    const stored = hashToken(token);
    assert.equal(tokensMatch(token, stored), true);
    assert.equal(tokensMatch(generateToken(), stored), false);
    assert.equal(tokensMatch(token, stored.slice(0, 60)), false, 'truncated hash');
    assert.equal(tokensMatch(token, 'not-hex-at-all'), false);
    assert.equal(tokensMatch(token, ''), false);
});

test('shareLinkDenial gates missing, revoked, and expired links', () => {
    const now = new Date('2026-09-16T12:00:00Z');
    assert.equal(shareLinkDenial(null, now), 'not_found');
    assert.equal(shareLinkDenial(undefined, now), 'not_found');
    assert.equal(shareLinkDenial({}, now), null, 'no expiry means no expiry');
    assert.equal(
        shareLinkDenial({ expiresAt: '2026-09-17T12:00:00Z' }, now),
        null,
    );
    assert.equal(
        shareLinkDenial({ expiresAt: '2026-09-15T12:00:00Z' }, now),
        'expired',
    );
    assert.equal(
        shareLinkDenial({ expiresAt: '2026-09-16T12:00:00Z' }, now),
        'expired',
        'expiry is inclusive — a link is dead the instant it expires',
    );
    assert.equal(shareLinkDenial({ revokedAt: '2026-09-01T00:00:00Z' }, now), 'revoked');
});

test('revocation outranks expiry so the UI reports the fact the team acted on', () => {
    const now = new Date('2026-09-16T12:00:00Z');
    const denial = shareLinkDenial(
        { revokedAt: '2026-09-02T00:00:00Z', expiresAt: '2026-09-03T00:00:00Z' },
        now,
    );
    assert.equal(denial, 'revoked');
});

test('defaultExpiry lands the configured number of days out', () => {
    const from = new Date('2026-09-16T12:00:00Z');
    const iso = defaultExpiry(from);
    const days = (new Date(iso).getTime() - from.getTime()) / 86_400_000;
    assert.equal(days, DEFAULT_LINK_TTL_DAYS);
});
