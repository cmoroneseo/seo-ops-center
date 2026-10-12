/**
 * Audited model call.
 *
 * Checks the content-writer flags and the organization's monthly cap,
 * calls the provider, then writes one llm_calls row. The row stores the
 * model, token counts, cost, latency, and status. It does not store the
 * prompt or the completion.
 *
 * The cap is checked before the provider call. The call that crosses the
 * cap still finishes; the next call stops. Two calls that both read under
 * the cap can both run.
 *
 * Callers must already know the signed-in user belongs to organizationId.
 * This function checks that clientId, when set, belongs to that organization.
 */

import {
    LLM_MAX_OUTPUT_TOKENS,
    LLM_MAX_OUTPUT_TOKENS_LIMIT,
    LLM_MAX_RETRIES,
    LLM_MODELS,
    LLM_TIMEOUTS_MS,
} from './config.ts';
import {
    costForUsage,
    formatUsd,
    formatUsdForPeople,
    parseUsd,
    sanitizeModelId,
    spendLevel,
    spendRatio,
    spendWarningMessage,
    utcMonthWindow,
} from './cost.ts';
import {
    LlmDisabledError,
    LlmInvalidRequestError,
    LlmLedgerError,
    LlmNotConfiguredError,
    LlmProviderError,
    LlmSpendCapError,
    publicProviderError,
} from './errors.ts';
import type {
    LlmCallDraft,
    LlmCallStore,
    LlmGenerateInput,
    LlmGenerateResult,
    LlmProvider,
    LlmProviderResult,
    LlmSpendSnapshot,
    LlmUsage,
} from './types.ts';
import { contentWriterLlmEnabled } from '../content-writer/flags.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEATURE = /^[a-z][a-z0-9_.]{0,63}$/;
const REF_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;
const MAX_MESSAGES = 40;
const MAX_MESSAGE_CHARS = 200_000;
const MAX_PROMPT_CHARS = 400_000;
const LEDGER_ERROR = /^[a-z0-9_]{1,64}$/;

function ledgerErrorCode(code: string): string {
    return LEDGER_ERROR.test(code) ? code : 'provider_error';
}

export interface LlmDeps {
    provider: LlmProvider;
    store: LlmCallStore;
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
}

function tokenCount(value: number): number {
    if (!Number.isInteger(value) || value < 0) return 0;
    return Math.min(value, 2_000_000_000);
}

function normalizeUsage(usage: LlmUsage): LlmUsage {
    return {
        inputTokens: tokenCount(usage.inputTokens),
        outputTokens: tokenCount(usage.outputTokens),
        cacheReadTokens: tokenCount(usage.cacheReadTokens),
        cacheWriteTokens: tokenCount(usage.cacheWriteTokens),
    };
}

function validate(input: LlmGenerateInput): { clientId: string | null; refId: string | null } {
    if (!UUID.test(input.organizationId)) {
        throw new LlmInvalidRequestError('invalid_organization');
    }
    if (input.task !== 'draft' && input.task !== 'check') {
        throw new LlmInvalidRequestError('invalid_task');
    }
    if (!FEATURE.test(input.feature)) {
        throw new LlmInvalidRequestError('invalid_feature');
    }
    const ref = input.refId == null || input.refId.trim() === '' ? null : input.refId.trim();
    if (ref != null && !REF_ID.test(ref)) {
        throw new LlmInvalidRequestError('invalid_ref');
    }
    const clientId = input.clientId == null || input.clientId === '' ? null : input.clientId;
    if (clientId != null && !UUID.test(clientId)) {
        throw new LlmInvalidRequestError('invalid_client');
    }
    if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > MAX_MESSAGES) {
        throw new LlmInvalidRequestError('invalid_messages');
    }
    let chars = 0;
    let userMessages = 0;
    for (const message of input.messages) {
        if (message.role !== 'system' && message.role !== 'user' && message.role !== 'assistant') {
            throw new LlmInvalidRequestError('invalid_messages');
        }
        if (typeof message.content !== 'string' || message.content.length === 0 || message.content.length > MAX_MESSAGE_CHARS) {
            throw new LlmInvalidRequestError('invalid_messages');
        }
        chars += message.content.length;
        if (message.role === 'user') userMessages += 1;
    }
    if (userMessages === 0 || chars > MAX_PROMPT_CHARS) {
        throw new LlmInvalidRequestError('invalid_messages');
    }
    if (input.maxOutputTokens != null) {
        const max = input.maxOutputTokens;
        if (!Number.isInteger(max) || max < 1 || max > LLM_MAX_OUTPUT_TOKENS_LIMIT) {
            throw new LlmInvalidRequestError('invalid_max_output_tokens');
        }
    }
    return { clientId, refId: ref };
}

function snapshot(spend: bigint, cap: bigint): LlmSpendSnapshot {
    const level = spendLevel(spend, cap);
    const monthUsd = formatUsdForPeople(spend);
    const capUsd = formatUsdForPeople(cap);
    return {
        monthUsd: formatUsd(spend),
        capUsd: formatUsd(cap),
        ratio: spendRatio(spend, cap),
        warning: level === 'warning' || level === 'blocked',
        warningMessage: level === 'ok' ? null : spendWarningMessage(monthUsd, capUsd),
    };
}

async function insertCall(store: LlmCallStore, row: LlmCallDraft): Promise<string> {
    try {
        const inserted = await store.insertCall(row);
        return inserted.id;
    } catch (error) {
        if (error instanceof LlmLedgerError) throw error;
        throw new LlmLedgerError('ledger_write_failed');
    }
}

export async function generateLlm(input: LlmGenerateInput, deps: LlmDeps): Promise<LlmGenerateResult> {
    const { clientId, refId } = validate(input);
    const env = deps.env ?? process.env;
    if (!contentWriterLlmEnabled(env, input.organizationId)) {
        throw new LlmDisabledError();
    }

    if (clientId != null) {
        let belongs = false;
        try {
            belongs = await deps.store.clientBelongsToOrg(input.organizationId, clientId);
        } catch (error) {
            if (error instanceof LlmLedgerError || error instanceof LlmInvalidRequestError) throw error;
            throw new LlmLedgerError('ledger_read_failed');
        }
        if (!belongs) throw new LlmInvalidRequestError('client_not_in_organization');
    }

    let capUsd: string;
    let spentUsd: string;
    try {
        capUsd = await deps.store.getMonthlyCapUsd(input.organizationId);
        const window = utcMonthWindow((deps.now ?? (() => new Date()))());
        spentUsd = await deps.store.sumMonthSpendUsd(input.organizationId, window.start, window.end);
    } catch (error) {
        if (error instanceof LlmLedgerError || error instanceof LlmInvalidRequestError) throw error;
        throw new LlmLedgerError('ledger_read_failed');
    }

    let cap: bigint;
    let spent: bigint;
    try {
        cap = parseUsd(capUsd);
        spent = parseUsd(spentUsd);
    } catch {
        throw new LlmLedgerError('ledger_read_failed');
    }

    const choice = LLM_MODELS[input.task];
    const base = {
        organizationId: input.organizationId,
        clientId,
        feature: input.feature,
        refId,
    };

    if (spendLevel(spent, cap) === 'blocked') {
        await insertCall(deps.store, {
            ...base,
            model: choice.model,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: '0.00000000',
            latencyMs: null,
            status: 'blocked',
            error: 'monthly_spend_cap',
        });
        throw new LlmSpendCapError(formatUsdForPeople(spent), formatUsdForPeople(cap));
    }

    const started = Date.now();
    let result: LlmProviderResult;
    try {
        result = await deps.provider.generate({
            model: choice.model,
            fallbackModel: choice.fallbackModel,
            feature: input.feature,
            messages: input.messages,
            maxOutputTokens: input.maxOutputTokens ?? LLM_MAX_OUTPUT_TOKENS[input.task],
            timeoutMs: LLM_TIMEOUTS_MS[input.task],
            maxRetries: LLM_MAX_RETRIES,
        });
    } catch (error) {
        if (error instanceof LlmNotConfiguredError || error instanceof LlmInvalidRequestError) {
            throw error;
        }
        const code = ledgerErrorCode(
            error instanceof LlmProviderError ? error.code : publicProviderError(error),
        );
        const latencyMs = Math.min(Math.max(0, Date.now() - started), 2_000_000_000);
        await insertCall(deps.store, {
            ...base,
            model: choice.model,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: '0.00000000',
            latencyMs,
            status: 'failed',
            error: code,
        });
        throw new LlmProviderError(code);
    }

    if (typeof result.text !== 'string') {
        const latencyMs = Math.min(Math.max(0, Date.now() - started), 2_000_000_000);
        await insertCall(deps.store, {
            ...base,
            model: choice.model,
            inputTokens: 0,
            outputTokens: 0,
            costUsd: '0.00000000',
            latencyMs,
            status: 'failed',
            error: 'provider_error',
        });
        throw new LlmProviderError('provider_error');
    }

    const usage = normalizeUsage(result.usage);
    const model = sanitizeModelId(result.model || choice.model);
    const costUsd = costForUsage(model, usage);
    const latencyMs = Math.min(Math.max(0, Date.now() - started), 2_000_000_000);
    const callId = await insertCall(deps.store, {
        ...base,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd,
        latencyMs,
        status: 'succeeded',
        error: null,
    });
    const after = spent + parseUsd(costUsd);
    return {
        callId,
        text: result.text,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd,
        latencyMs,
        spend: snapshot(after, cap),
    };
}
