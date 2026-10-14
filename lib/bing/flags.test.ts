import test from 'node:test';
import assert from 'node:assert/strict';
import {
    BING_WEBMASTER_MEG_ORG_ID, BING_WEBMASTER_SANDBOX_ORG_ID,
    bingWebmasterAllowlist, bingWebmasterApiKey, bingWebmasterEnabled,
} from './flags.ts';

const OTHER = '11111111-1111-4111-8111-111111111111';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

test('Bing Webmaster stays off unless the flag is exactly true and the org is allowlisted', () => {
    assert.equal(bingWebmasterEnabled(env({}), BING_WEBMASTER_SANDBOX_ORG_ID), false);
    assert.equal(bingWebmasterEnabled(env({}), BING_WEBMASTER_MEG_ORG_ID), false);
    assert.equal(bingWebmasterEnabled(env({ BING_WEBMASTER: '1' }), BING_WEBMASTER_SANDBOX_ORG_ID), false);
    assert.equal(bingWebmasterEnabled(env({ BING_WEBMASTER: 'TRUE', BING_WEBMASTER_ORG_IDS: BING_WEBMASTER_SANDBOX_ORG_ID }), BING_WEBMASTER_SANDBOX_ORG_ID), false);
    assert.equal(bingWebmasterEnabled(env({ BING_WEBMASTER: 'true' }), BING_WEBMASTER_SANDBOX_ORG_ID), false);
    assert.equal(bingWebmasterEnabled(env({ BING_WEBMASTER: 'true', BING_WEBMASTER_ORG_IDS: '' }), BING_WEBMASTER_SANDBOX_ORG_ID), false);
    assert.equal(bingWebmasterEnabled(env({ BING_WEBMASTER: 'true', BING_WEBMASTER_ORG_IDS: 'nope' }), BING_WEBMASTER_SANDBOX_ORG_ID), false);
    assert.equal(bingWebmasterEnabled(env({
        BING_WEBMASTER: 'true',
        BING_WEBMASTER_ORG_IDS: ` ${BING_WEBMASTER_SANDBOX_ORG_ID.toUpperCase()} , not-a-uuid `,
    }), BING_WEBMASTER_SANDBOX_ORG_ID), true);
    assert.equal(bingWebmasterEnabled(env({
        BING_WEBMASTER: 'true',
        BING_WEBMASTER_ORG_IDS: BING_WEBMASTER_SANDBOX_ORG_ID,
    }), BING_WEBMASTER_MEG_ORG_ID), false);
    assert.equal(bingWebmasterEnabled(env({
        BING_WEBMASTER: 'true',
        BING_WEBMASTER_ORG_IDS: BING_WEBMASTER_SANDBOX_ORG_ID,
    }), OTHER), false);
    assert.equal(bingWebmasterEnabled(env({
        BING_WEBMASTER: 'true',
        BING_WEBMASTER_ORG_IDS: BING_WEBMASTER_SANDBOX_ORG_ID,
    })), false);
});

test('the allowlist is empty unless the master flag is exactly true', () => {
    assert.deepEqual(bingWebmasterAllowlist(env({})), []);
    assert.deepEqual(bingWebmasterAllowlist(env({ BING_WEBMASTER: 'true' })), []);
    assert.deepEqual(bingWebmasterAllowlist(env({
        BING_WEBMASTER: 'TRUE',
        BING_WEBMASTER_ORG_IDS: BING_WEBMASTER_SANDBOX_ORG_ID,
    })), []);
    assert.deepEqual(bingWebmasterAllowlist(env({
        BING_WEBMASTER: 'true',
        BING_WEBMASTER_ORG_IDS: `nope, ${BING_WEBMASTER_SANDBOX_ORG_ID.toUpperCase()}`,
    })), [BING_WEBMASTER_SANDBOX_ORG_ID]);
});

test('the API key helper returns a trimmed value and does not log it', () => {
    const key = 'synthetic-bing-key';
    assert.equal(bingWebmasterApiKey(env({})), null);
    assert.equal(bingWebmasterApiKey(env({ BING_WEBMASTER_API_KEY: '   ' })), null);
    const hits: string[] = [];
    const sinks = ['log', 'info', 'warn', 'error', 'debug'] as const;
    const originals = sinks.map(name => console[name]);
    for (const name of sinks) {
        console[name] = (...args: unknown[]) => { hits.push(args.map(String).join(' ')); };
    }
    let resolved: string | null = null;
    try {
        resolved = bingWebmasterApiKey(env({ BING_WEBMASTER_API_KEY: `  ${key}  ` }));
    } finally {
        sinks.forEach((name, index) => { console[name] = originals[index]; });
    }
    assert.equal(resolved, key);
    assert.deepEqual(hits, []);
});
