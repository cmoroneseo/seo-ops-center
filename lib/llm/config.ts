/**
 * Model choice for the content writer.
 *
 * Gateway ids and base prices were read from
 * https://ai-gateway.vercel.sh/v1/models on 2026-10-12.
 * Prices are USD per token at the catalog base rate (not the US/EU regional
 * rate, which is about 10% higher). Swapping a model is a change to this file.
 *
 * Opus 5.5, Sonnet 5.5, and Haiku 5.5 each report zero data retention and
 * no-training on every provider endpoint in that catalog.
 */

export type LlmTask = 'draft' | 'check';

export interface LlmModelChoice {
    model: string;
    fallbackModel: string;
}

export const LLM_MODELS: Record<LlmTask, LlmModelChoice> = {
    draft: {
        model: 'anthropic/claude-opus-5.5',
        fallbackModel: 'anthropic/claude-sonnet-5.5',
    },
    check: {
        model: 'anthropic/claude-haiku-5.5',
        fallbackModel: 'anthropic/claude-sonnet-5.5',
    },
};

export interface ModelPrice {
    /** USD per token. */
    inputPerToken: string;
    outputPerToken: string;
    cacheReadPerToken: string;
    cacheWritePerToken: string;
    /**
     * When total input tokens (including cache read and write) reach this
     * count, the long-context rates apply to the whole request.
     */
    longContextFromTokens?: number;
    longContextInputPerToken?: string;
    longContextOutputPerToken?: string;
    longContextCacheReadPerToken?: string;
    longContextCacheWritePerToken?: string;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
    'anthropic/claude-opus-5.5': {
        inputPerToken: '0.000004',
        outputPerToken: '0.00002',
        cacheReadPerToken: '0.0000002',
        cacheWritePerToken: '0.000005',
    },
    'anthropic/claude-sonnet-5.5': {
        inputPerToken: '0.000002',
        outputPerToken: '0.00001',
        cacheReadPerToken: '0.0000001',
        cacheWritePerToken: '0.0000025',
    },
    'anthropic/claude-haiku-5.5': {
        inputPerToken: '0.0000001',
        outputPerToken: '0.0000005',
        cacheReadPerToken: '0.00000001',
        cacheWritePerToken: '0.000000125',
        longContextFromTokens: 100_001,
        longContextInputPerToken: '0.0000005',
        longContextOutputPerToken: '0.0000025',
        longContextCacheReadPerToken: '0.00000005',
        longContextCacheWritePerToken: '0.000000625',
    },
};

/** Starting cap when an organization row has not customized it. */
export const LLM_DEFAULT_MONTHLY_CAP_USD = '50.00';

export const LLM_TIMEOUTS_MS: Record<LlmTask, number> = {
    draft: 120_000,
    check: 30_000,
};

export const LLM_MAX_OUTPUT_TOKENS: Record<LlmTask, number> = {
    draft: 8_000,
    check: 2_048,
};

/** Hard ceiling so a caller cannot request an unbounded completion. */
export const LLM_MAX_OUTPUT_TOKENS_LIMIT = 16_000;

/**
 * Retries for a failed Gateway attempt that has not returned usage.
 * The AI SDK default is 2. Set it here so the policy lives with the models.
 */
export const LLM_MAX_RETRIES = 2;

export const LLM_SPEND_WARNING_NUMERATOR = BigInt(4);
export const LLM_SPEND_WARNING_DENOMINATOR = BigInt(5);
