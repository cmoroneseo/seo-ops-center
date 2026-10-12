/**
 * Server entry for a live model call.
 *
 * The caller has to authorize organizationId against the signed-in user
 * before calling this. Flags, the spend cap, and the client/org check
 * happen inside generateLlm.
 */

import { generateLlm } from './client.ts';
import { createGatewayLlmProvider } from './gateway.ts';
import { createSupabaseLlmCallStore } from './store.ts';
import type { LlmGenerateInput, LlmGenerateResult } from './types.ts';

export async function generateLlmCall(input: LlmGenerateInput): Promise<LlmGenerateResult> {
    return generateLlm(input, {
        provider: createGatewayLlmProvider(),
        store: createSupabaseLlmCallStore(),
    });
}
