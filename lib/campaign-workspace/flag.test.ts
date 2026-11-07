import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { campaignWorkspaceEnabled } from './flag.ts';

test('campaign workspace is off unless the flag is exactly true', () => {
    const previous = process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
    try {
        delete process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
        assert.equal(campaignWorkspaceEnabled(), false);
        process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = 'false';
        assert.equal(campaignWorkspaceEnabled(), false);
        process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = '1';
        assert.equal(campaignWorkspaceEnabled(), false);
        process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = 'TRUE';
        assert.equal(campaignWorkspaceEnabled(), false);
        process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = 'true';
        assert.equal(campaignWorkspaceEnabled(), true);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE;
        else process.env.NEXT_PUBLIC_CAMPAIGN_WORKSPACE = previous;
    }
});

test('the example env leaves the campaign flag blank and Vercel config does not set it', () => {
    const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');
    assert.match(envExample, /^NEXT_PUBLIC_CAMPAIGN_WORKSPACE=$/m);
    assert.equal(envExample.includes('NEXT_PUBLIC_CAMPAIGN_WORKSPACE=true'), false);
    assert.equal(vercel.includes('CAMPAIGN_WORKSPACE'), false);
});
