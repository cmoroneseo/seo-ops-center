import test from 'node:test';
import assert from 'node:assert/strict';

import { generateLlm } from './client.ts';
import { formatUsd, parseUsd } from './cost.ts';
import { LlmNotConfiguredError, LlmProviderError, LlmSpendCapError } from './errors.ts';
import type { LlmCallDraft, LlmCallStore, LlmGenerateInput, LlmProvider, LlmProviderRequest, LlmUsage } from './types.ts';

const ORG = '06e536b9-beac-49bc-8c96-1df021102590';
const CLIENT = 'cbba5b14-7e24-4913-b396-0fff7fb2df17';
const SECRET = 'CLIENT_SECRET_PHRASE_do_not_store';

const FLAGS = {
    CONTENT_WRITER_ENABLED: 'true',
    CONTENT_WRITER_LLM_ENABLED: 'true',
};

function input(overrides: Partial<LlmGenerateInput> = {}): LlmGenerateInput {
    return {
        organizationId: ORG,
        clientId: CLIENT,
        feature: 'content_writer.draft',
        refId: 'brief_1',
        task: 'draft',
        messages: [
            { role: 'system', content: 'Write in the client voice.' },
            { role: 'user', content: SECRET },
        ],
        ...overrides,
    };
}

function memory(options?: { cap?: string; spent?: string; belongs?: boolean }) {
    const rows: LlmCallDraft[] = [];
    const store: LlmCallStore = {
        async getMonthlyCapUsd() {
            return options?.cap ?? '50.00';
        },
        async sumMonthSpendUsd() {
            const recorded = rows
                .filter(row => row.status === 'succeeded' || row.status === 'failed')
                .reduce((sum, row) => sum + parseUsd(row.costUsd), BigInt(0));
            return formatUsd(parseUsd(options?.spent ?? '0') + recorded);
        },
        async clientBelongsToOrg() {
            return options?.belongs ?? true;
        },
        async insertCall(row) {
            rows.push(row);
            return { id: `call-${rows.length}` };
        },
    };
    return { rows, store };
}

function provider(behavior?: {
    fail?: unknown;
    model?: string;
    text?: string;
    usage?: Partial<LlmUsage>;
}) {
    const requests: LlmProviderRequest[] = [];
    const fake: LlmProvider = {
        async generate(request) {
            requests.push(request);
            if (behavior?.fail) throw behavior.fail;
            return {
                text: behavior?.text ?? 'Finished draft.',
                model: behavior?.model ?? request.model,
                usage: {
                    inputTokens: 25_000,
                    outputTokens: 5_000,
                    cacheReadTokens: 0,
                    cacheWriteTokens: 0,
                    ...behavior?.usage,
                },
            };
        },
    };
    return { requests, fake };
}

test('flags off does not call the provider or write a row', async () => {
    const ledger = memory();
    const model = provider();
    await assert.rejects(
        () => generateLlm(input(), { provider: model.fake, store: ledger.store, env: {} }),
        { name: 'LlmDisabledError', code: 'content_writer_llm_disabled' },
    );
    assert.equal(model.requests.length, 0);
    assert.equal(ledger.rows.length, 0);
});

test('an organization outside the allowlist is off', async () => {
    const ledger = memory();
    const model = provider();
    await assert.rejects(
        () => generateLlm(input(), {
            provider: model.fake,
            store: ledger.store,
            env: { ...FLAGS, CONTENT_WRITER_ORG_IDS: '11111111-1111-4111-8111-111111111111' },
        }),
        { name: 'LlmDisabledError' },
    );
    assert.equal(model.requests.length, 0);
});

test('a draft call records Opus cost and warns once the month crosses 80 percent', async () => {
    const ledger = memory({ spent: '40.00' });
    const model = provider();
    const result = await generateLlm(input(), {
        provider: model.fake,
        store: ledger.store,
        env: FLAGS,
    });

    assert.equal(result.model, 'anthropic/claude-opus-5.5');
    assert.equal(result.costUsd, '0.20000000');
    assert.equal(result.text, 'Finished draft.');
    assert.equal(result.spend.warning, true);
    assert.match(result.spend.warningMessage ?? '', /\$40\.20 of its \$50\.00/);
    assert.equal(model.requests[0]?.model, 'anthropic/claude-opus-5.5');
    assert.equal(model.requests[0]?.fallbackModel, 'anthropic/claude-sonnet-5.5');
    assert.equal(model.requests[0]?.maxRetries, 2);
    assert.equal(model.requests[0]?.timeoutMs, 120_000);

    const row = ledger.rows[0];
    assert.equal(row?.status, 'succeeded');
    assert.equal(row?.feature, 'content_writer.draft');
    assert.equal(row?.inputTokens, 25_000);
    assert.equal(row?.outputTokens, 5_000);
    assert.equal(row?.costUsd, '0.20000000');
    assert.equal(JSON.stringify(row).includes(SECRET), false);
});

test('checks use Haiku and fall back to Sonnet', async () => {
    const ledger = memory();
    const model = provider();
    await generateLlm(input({ task: 'check', feature: 'content_writer.check' }), {
        provider: model.fake,
        store: ledger.store,
        env: FLAGS,
    });
    assert.equal(model.requests[0]?.model, 'anthropic/claude-haiku-5.5');
    assert.equal(model.requests[0]?.fallbackModel, 'anthropic/claude-sonnet-5.5');
    assert.equal(model.requests[0]?.timeoutMs, 30_000);
});

test('the cap stops the next call and records a blocked row', async () => {
    const ledger = memory({ cap: '0.10' });
    const model = provider();
    const deps = { provider: model.fake, store: ledger.store, env: FLAGS };
    const first = await generateLlm(input(), deps);
    assert.equal(first.costUsd, '0.20000000');

    await assert.rejects(
        () => generateLlm(input(), deps),
        (error: unknown) => {
            assert.ok(error instanceof LlmSpendCapError);
            assert.match(error.message, /\$0\.20 of its \$0\.10/);
            assert.match(error.message, /not billed to the client/);
            assert.equal(error.code, 'llm_monthly_spend_cap');
            return true;
        },
    );
    assert.equal(model.requests.length, 1);
    assert.equal(ledger.rows[1]?.status, 'blocked');
    assert.equal(ledger.rows[1]?.error, 'monthly_spend_cap');
    assert.equal(ledger.rows[1]?.costUsd, '0.00000000');
});

test('a provider failure is stored as a safe code and does not keep the prompt', async () => {
    const ledger = memory();
    const failure = new Error(`provider blew up: ${SECRET}`);
    Object.assign(failure, { statusCode: 500 });
    const model = provider({ fail: failure });
    await assert.rejects(
        () => generateLlm(input(), { provider: model.fake, store: ledger.store, env: FLAGS }),
        (error: unknown) => {
            assert.ok(error instanceof LlmProviderError);
            assert.equal(error.message, 'provider_status_500');
            assert.equal(error.message.includes(SECRET), false);
            assert.equal((error as { cause?: unknown }).cause, undefined);
            return true;
        },
    );
    assert.equal(ledger.rows[0]?.status, 'failed');
    assert.equal(ledger.rows[0]?.error, 'provider_status_500');
    assert.equal(JSON.stringify(ledger.rows[0]).includes(SECRET), false);
});

test('a Gateway provider error code is stored and the prompt is not', async () => {
    const ledger = memory();
    const model = provider({ fail: new LlmProviderError('provider_status_503') });
    await assert.rejects(
        () => generateLlm(input(), { provider: model.fake, store: ledger.store, env: FLAGS }),
        { message: 'provider_status_503' },
    );
    assert.equal(ledger.rows[0]?.error, 'provider_status_503');
});

test('missing Gateway configuration does not write a row', async () => {
    const ledger = memory();
    const model = provider({ fail: new LlmNotConfiguredError() });
    await assert.rejects(
        () => generateLlm(input(), { provider: model.fake, store: ledger.store, env: FLAGS }),
        { name: 'LlmNotConfiguredError' },
    );
    assert.equal(ledger.rows.length, 0);
});

test('a client outside the organization never reaches the provider', async () => {
    const ledger = memory({ belongs: false });
    const model = provider();
    await assert.rejects(
        () => generateLlm(input(), { provider: model.fake, store: ledger.store, env: FLAGS }),
        { code: 'client_not_in_organization' },
    );
    assert.equal(model.requests.length, 0);
    assert.equal(ledger.rows.length, 0);
});

test('a model id carrying prompt text is not stored', async () => {
    const ledger = memory();
    const model = provider({ model: `anthropic/claude-opus-5.5\n${SECRET}` });
    const result = await generateLlm(input(), {
        provider: model.fake,
        store: ledger.store,
        env: FLAGS,
    });
    assert.equal(result.model, 'unknown_model');
    assert.equal(result.costUsd, '0.20000000');
    assert.equal(JSON.stringify(ledger.rows[0]).includes(SECRET), false);
});
