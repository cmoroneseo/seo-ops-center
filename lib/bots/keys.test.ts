import assert from 'node:assert/strict';
import test from 'node:test';

import { botKeyHashMatches, generateBotKey, hashBotKey, normalizeBotName } from './keys.ts';
import { BOT_KEY_PREFIX } from './scope.ts';

test('a minted key is hashed and the plaintext is not the stored value', () => {
    const minted = generateBotKey();
    assert.equal(minted.token.startsWith(BOT_KEY_PREFIX), true);
    assert.equal(minted.prefix, minted.token.slice(0, 16));
    assert.match(minted.hash, /^[0-9a-f]{64}$/);
    assert.notEqual(minted.hash, minted.token);
    assert.equal(hashBotKey(minted.token), minted.hash);
    assert.equal(botKeyHashMatches(minted.hash, minted.token), true);
    assert.equal(botKeyHashMatches(minted.hash, `${minted.token}x`), false);
    assert.equal(botKeyHashMatches('not-a-hash', minted.token), false);
});

test('bot names stay short labels', () => {
    assert.equal(normalizeBotName('  ecoworkz  '), 'ecoworkz');
    assert.equal(normalizeBotName('SEO brief bot'), 'SEO brief bot');
    assert.equal(normalizeBotName(''), null);
    assert.equal(normalizeBotName('../settings'), null);
    assert.equal(normalizeBotName('a'.repeat(41)), null);
});

test('approval actor lookup prefers validated id, then configured email, then legacy email', async () => {
    const { resolveBotActorLookup, BOT_ACTOR_EMAIL } = await import('./keys.ts');
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    assert.deepEqual(resolveBotActorLookup({ BOT_ACTOR_USER_ID: id, BOT_ACTOR_EMAIL: 'bot@example.com' }), { kind: 'id', value: id });
    assert.deepEqual(resolveBotActorLookup({ BOT_ACTOR_EMAIL: ' bot@example.com ' }), { kind: 'email', value: 'bot@example.com' });
    assert.deepEqual(resolveBotActorLookup({}), { kind: 'email', value: BOT_ACTOR_EMAIL });
    assert.throws(() => resolveBotActorLookup({ BOT_ACTOR_USER_ID: 'invalid', BOT_ACTOR_EMAIL: 'bot@example.com' }), /UUID/);
});
