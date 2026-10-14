import test from 'node:test';
import assert from 'node:assert/strict';
import { BING_WEBMASTER_MEG_ORG_ID, BING_WEBMASTER_SANDBOX_ORG_ID, bingWebmasterEnabled } from './flags.ts';

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
