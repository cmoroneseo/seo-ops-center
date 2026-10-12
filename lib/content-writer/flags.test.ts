import test from 'node:test';
import assert from 'node:assert/strict';

import { contentWriterEnabled, contentWriterLlmEnabled } from './flags.ts';

const SANDBOX = '06e536b9-beac-49bc-8c96-1df021102590';
const OTHER = '11111111-1111-4111-8111-111111111111';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

test('content writer flags are off unless the value is exactly true', () => {
    assert.equal(contentWriterEnabled(env({})), false);
    assert.equal(contentWriterEnabled(env({ CONTENT_WRITER_ENABLED: '1' })), false);
    assert.equal(contentWriterEnabled(env({ CONTENT_WRITER_ENABLED: 'TRUE' })), false);
    assert.equal(contentWriterEnabled(env({ CONTENT_WRITER_ENABLED: 'true' })), true);
});

test('the llm flag also requires the master flag', () => {
    assert.equal(contentWriterLlmEnabled(env({
        CONTENT_WRITER_LLM_ENABLED: 'true',
    })), false);
    assert.equal(contentWriterLlmEnabled(env({
        CONTENT_WRITER_ENABLED: 'true',
    })), false);
    assert.equal(contentWriterLlmEnabled(env({
        CONTENT_WRITER_ENABLED: 'true',
        CONTENT_WRITER_LLM_ENABLED: 'true',
    })), true);
});

test('an organization allowlist limits both flags', () => {
    const flags = {
        CONTENT_WRITER_ENABLED: 'true',
        CONTENT_WRITER_LLM_ENABLED: 'true',
        CONTENT_WRITER_ORG_IDS: ` ${SANDBOX.toUpperCase()} , not-a-uuid `,
    };
    assert.equal(contentWriterEnabled(env(flags), SANDBOX), true);
    assert.equal(contentWriterLlmEnabled(env(flags), SANDBOX), true);
    assert.equal(contentWriterLlmEnabled(env(flags), OTHER), false);
    assert.equal(contentWriterLlmEnabled(env(flags)), false);
});

test('a non-empty allowlist with no organization id allows nobody', () => {
    const flags = {
        CONTENT_WRITER_ENABLED: 'true',
        CONTENT_WRITER_LLM_ENABLED: 'true',
        CONTENT_WRITER_ORG_IDS: 'nope',
    };
    assert.equal(contentWriterLlmEnabled(env(flags), SANDBOX), false);
});
