import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    CAMPAIGN_DESK_MEG_ORG_ID,
    CAMPAIGN_DESK_SANDBOX_ORG_ID,
    campaignDeskAllowlist,
    campaignDeskBaseUrl,
    campaignDeskReady,
    campaignDeskToken,
} from './flags.ts';

const TOKEN = 'synthetic-campaign-desk-token';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

test('sync stays off until the flag, allowlist, https url, and token are all set', () => {
    assert.equal(campaignDeskReady(CAMPAIGN_DESK_SANDBOX_ORG_ID, env({})).enabled, false);
    assert.equal(campaignDeskReady(CAMPAIGN_DESK_MEG_ORG_ID, env({})).enabled, false);
    assert.equal(campaignDeskReady(CAMPAIGN_DESK_SANDBOX_ORG_ID, env({
        CAMPAIGN_DESK_SYNC_ENABLED: 'TRUE',
        CAMPAIGN_DESK_ORG_IDS: CAMPAIGN_DESK_SANDBOX_ORG_ID,
        CAMPAIGN_DESK_API_BASE_URL: 'https://desk.example.test',
        CAMPAIGN_DESK_API_TOKEN: TOKEN,
    })).enabled, false);
    assert.match(campaignDeskReady(CAMPAIGN_DESK_SANDBOX_ORG_ID, env({
        CAMPAIGN_DESK_SYNC_ENABLED: 'true',
    })).reason ?? '', /not allowed/);
    assert.match(campaignDeskReady(CAMPAIGN_DESK_SANDBOX_ORG_ID, env({
        CAMPAIGN_DESK_SYNC_ENABLED: 'true',
        CAMPAIGN_DESK_ORG_IDS: CAMPAIGN_DESK_SANDBOX_ORG_ID,
    })).reason ?? '', /CAMPAIGN_DESK_API_BASE_URL is not set/);
    assert.match(campaignDeskReady(CAMPAIGN_DESK_SANDBOX_ORG_ID, env({
        CAMPAIGN_DESK_SYNC_ENABLED: 'true',
        CAMPAIGN_DESK_ORG_IDS: CAMPAIGN_DESK_SANDBOX_ORG_ID,
        CAMPAIGN_DESK_API_BASE_URL: 'http://desk.example.test',
        CAMPAIGN_DESK_API_TOKEN: TOKEN,
    })).reason ?? '', /https/);
    assert.equal(campaignDeskReady(CAMPAIGN_DESK_MEG_ORG_ID, env({
        CAMPAIGN_DESK_SYNC_ENABLED: 'true',
        CAMPAIGN_DESK_ORG_IDS: CAMPAIGN_DESK_SANDBOX_ORG_ID,
        CAMPAIGN_DESK_API_BASE_URL: 'https://desk.example.test',
        CAMPAIGN_DESK_API_TOKEN: TOKEN,
    })).enabled, false);

    const ready = campaignDeskReady(CAMPAIGN_DESK_SANDBOX_ORG_ID, env({
        CAMPAIGN_DESK_SYNC_ENABLED: 'true',
        CAMPAIGN_DESK_ORG_IDS: ` ${CAMPAIGN_DESK_SANDBOX_ORG_ID.toUpperCase()} `,
        CAMPAIGN_DESK_API_BASE_URL: 'https://desk.example.test/api/',
        CAMPAIGN_DESK_API_TOKEN: `  ${TOKEN}  `,
    }));
    assert.equal(ready.enabled, true);
    assert.equal(ready.reason, null);
    assert.equal(JSON.stringify(ready).includes(TOKEN), false);
    assert.deepEqual(campaignDeskAllowlist(env({
        CAMPAIGN_DESK_SYNC_ENABLED: 'true',
        CAMPAIGN_DESK_ORG_IDS: CAMPAIGN_DESK_SANDBOX_ORG_ID,
    })), [CAMPAIGN_DESK_SANDBOX_ORG_ID]);
    assert.equal(campaignDeskBaseUrl(env({
        CAMPAIGN_DESK_API_BASE_URL: 'https://user:secret@desk.example.test',
    })), null);
    assert.equal(campaignDeskBaseUrl(env({
        CAMPAIGN_DESK_API_BASE_URL: 'http://localhost:4000/v1/',
    })), 'http://localhost:4000/v1');
    assert.equal(campaignDeskBaseUrl(env({
        CAMPAIGN_DESK_API_BASE_URL: '  https://hub.example.test/v1 \n',
    })), 'https://hub.example.test/v1');
    assert.equal(campaignDeskToken(env({ CAMPAIGN_DESK_API_TOKEN: `  ${TOKEN}  ` })), TOKEN);
    assert.equal(campaignDeskToken(env({ CAMPAIGN_DESK_API_TOKEN: '   ' })), null);
});

test('the example env does not allowlist the production org', () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    assert.match(example, /^CAMPAIGN_DESK_SYNC_ENABLED=$/m);
    assert.match(example, /^CAMPAIGN_DESK_ORG_IDS=$/m);
    assert.match(example, /^CAMPAIGN_DESK_API_BASE_URL=$/m);
    assert.match(example, /^CAMPAIGN_DESK_API_TOKEN=$/m);
    assert.equal(example.includes(CAMPAIGN_DESK_MEG_ORG_ID), false);
    const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');
    assert.equal(vercel.includes('forecast'), false);
    assert.equal(vercel.includes('campaign-desk'), false);
});
