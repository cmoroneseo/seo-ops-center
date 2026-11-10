import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pipelineNavEnabled } from './pipeline-flag.ts';

test('pipeline nav is off unless the flag is exactly true', () => {
    const previous = process.env.NEXT_PUBLIC_PIPELINE_NAV;
    try {
        delete process.env.NEXT_PUBLIC_PIPELINE_NAV;
        assert.equal(pipelineNavEnabled(), false);
        process.env.NEXT_PUBLIC_PIPELINE_NAV = 'false';
        assert.equal(pipelineNavEnabled(), false);
        process.env.NEXT_PUBLIC_PIPELINE_NAV = '1';
        assert.equal(pipelineNavEnabled(), false);
        process.env.NEXT_PUBLIC_PIPELINE_NAV = 'TRUE';
        assert.equal(pipelineNavEnabled(), false);
        process.env.NEXT_PUBLIC_PIPELINE_NAV = 'true';
        assert.equal(pipelineNavEnabled(), true);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_PIPELINE_NAV;
        else process.env.NEXT_PUBLIC_PIPELINE_NAV = previous;
    }
});

test('the example env leaves the pipeline flag blank and Vercel config does not set it', () => {
    const envExample = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    const vercel = readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8');
    assert.match(envExample, /^NEXT_PUBLIC_PIPELINE_NAV=$/m);
    assert.equal(envExample.includes('NEXT_PUBLIC_PIPELINE_NAV=true'), false);
    assert.equal(vercel.includes('PIPELINE_NAV'), false);
});
