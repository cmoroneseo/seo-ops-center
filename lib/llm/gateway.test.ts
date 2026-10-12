import test from 'node:test';
import assert from 'node:assert/strict';

import { createGatewayLlmProvider, type GatewayGenerateOptions } from './gateway.ts';
import { LlmProviderError, publicProviderError } from './errors.ts';
import type { LlmProviderRequest } from './types.ts';

const SECRET = 'CLIENT_SECRET_PHRASE_do_not_store';

function request(): LlmProviderRequest {
    return {
        model: 'anthropic/claude-opus-5.5',
        fallbackModel: 'anthropic/claude-sonnet-5.5',
        feature: 'content_writer.draft',
        messages: [
            { role: 'system', content: 'Voice notes.' },
            { role: 'user', content: SECRET },
        ],
        maxOutputTokens: 800,
        timeoutMs: 120_000,
        maxRetries: 2,
    };
}

test('provider errors keep the status code and drop the provider message', () => {
    const error = new Error(`body included ${SECRET}`);
    Object.assign(error, { statusCode: 429 });
    assert.equal(publicProviderError(error), 'rate_limited');
    assert.equal(publicProviderError(Object.assign(new Error(SECRET), { name: 'TimeoutError' })), 'timeout');
    assert.equal(publicProviderError(new Error(SECRET)), 'provider_error');
});

test('a missing Gateway credential fails before any generate call', async () => {
    let called = false;
    const provider = createGatewayLlmProvider({
        env: {},
        generate: async () => {
            called = true;
            return { text: 'nope', usage: {}, response: {} };
        },
    });
    await assert.rejects(() => provider.generate(request()), { name: 'LlmNotConfiguredError' });
    assert.equal(called, false);
});

test('the Gateway request uses the configured model, fallback, retries, and retention flags', async () => {
    const seen: GatewayGenerateOptions[] = [];
    const provider = createGatewayLlmProvider({
        env: { AI_GATEWAY_API_KEY: 'test-gateway-key' },
        generate: async options => {
            seen.push(options);
            return {
                text: 'Draft text.',
                usage: {
                    inputTokens: 100,
                    outputTokens: 20,
                    inputTokenDetails: { cacheReadTokens: 40, cacheWriteTokens: 10 },
                },
                response: { modelId: 'anthropic/claude-sonnet-5.5' },
            };
        },
    });

    const result = await provider.generate(request());
    const call = seen[0];
    assert.equal(call?.model, 'anthropic/claude-opus-5.5');
    assert.equal(call?.providerOptions.gateway.models[0], 'anthropic/claude-sonnet-5.5');
    assert.equal(call?.providerOptions.gateway.zeroDataRetention, true);
    assert.equal(call?.providerOptions.gateway.disallowPromptTraining, true);
    assert.deepEqual(call?.providerOptions.gateway.tags, ['content_writer.draft']);
    assert.equal(call?.maxRetries, 2);
    assert.equal(call?.timeout, 120_000);
    assert.equal(call?.system, 'Voice notes.');
    assert.deepEqual(call?.messages, [{ role: 'user', content: SECRET }]);
    assert.equal(result.model, 'anthropic/claude-sonnet-5.5');
    assert.equal(result.usage.inputTokens, 100);
    assert.equal(result.usage.cacheReadTokens, 40);
    assert.equal(result.usage.cacheWriteTokens, 10);
});

test('a Gateway exception does not keep the prompt or a cause', async () => {
    const provider = createGatewayLlmProvider({
        env: { VERCEL_OIDC_TOKEN: 'test-oidc-token' },
        generate: async () => {
            const error = new Error(`upstream echoed ${SECRET}`);
            Object.assign(error, { statusCode: 503 });
            throw error;
        },
    });
    await assert.rejects(
        () => provider.generate(request()),
        (error: unknown) => {
            assert.ok(error instanceof LlmProviderError);
            assert.equal(error.message, 'provider_status_503');
            assert.equal(error.message.includes(SECRET), false);
            assert.equal((error as { cause?: unknown }).cause, undefined);
            return true;
        },
    );
});
