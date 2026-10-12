import test from 'node:test';
import assert from 'node:assert/strict';

import { createSupabaseLlmCallStore } from './store.ts';
import type { LlmCallDraft } from './types.ts';

test('the ledger insert stores cost fields and not prompt text', async () => {
    const inserted: Record<string, unknown>[] = [];
    const store = createSupabaseLlmCallStore({
        from() {
            return {
                select() {
                    throw new Error('not used');
                },
                insert(row: Record<string, unknown>) {
                    inserted.push(row);
                    return {
                        select() {
                            return { async single() { return { data: { id: 'row-1' }, error: null }; } };
                        },
                    };
                },
            };
        },
        async rpc() {
            return { data: '0', error: null };
        },
    });

    const draft: LlmCallDraft = {
        organizationId: '06e536b9-beac-49bc-8c96-1df021102590',
        clientId: null,
        feature: 'content_writer.draft',
        refId: null,
        model: 'anthropic/claude-opus-5.5',
        inputTokens: 10,
        outputTokens: 4,
        costUsd: '0.00012000',
        latencyMs: 15,
        status: 'succeeded',
        error: null,
    };
    const result = await store.insertCall(draft);
    assert.equal(result.id, 'row-1');
    assert.equal(inserted[0]?.cost_usd, '0.00012000');
    assert.equal(inserted[0]?.input_tokens, 10);
    assert.equal(inserted[0]?.status, 'succeeded');
    assert.equal(Object.hasOwn(inserted[0] ?? {}, 'messages'), false);
    assert.equal(Object.hasOwn(inserted[0] ?? {}, 'content'), false);
});
