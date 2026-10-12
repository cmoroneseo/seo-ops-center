/**
 * Errors raised by the LLM entry point.
 * Messages and codes are fixed strings. They do not include prompts,
 * completions, credentials, or provider response bodies.
 */

export class LlmDisabledError extends Error {
    readonly code = 'content_writer_llm_disabled';

    constructor() {
        super('Content writer AI is off for this organization.');
        this.name = 'LlmDisabledError';
    }
}

export class LlmNotConfiguredError extends Error {
    readonly code = 'ai_gateway_not_configured';

    constructor() {
        super('AI Gateway is not configured. Set AI_GATEWAY_API_KEY, or deploy on Vercel so the OIDC token is available.');
        this.name = 'LlmNotConfiguredError';
    }
}

export class LlmSpendCapError extends Error {
    readonly code = 'llm_monthly_spend_cap';
    readonly monthUsd: string;
    readonly capUsd: string;

    constructor(monthUsd: string, capUsd: string) {
        super(
            `This organization has used $${monthUsd} of its $${capUsd} AI budget this month. `
            + 'New AI calls are stopped until the next UTC month, or until an owner raises the cap. '
            + 'Spend is absorbed by the agency and is not billed to the client.',
        );
        this.name = 'LlmSpendCapError';
        this.monthUsd = monthUsd;
        this.capUsd = capUsd;
    }
}

export class LlmInvalidRequestError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.name = 'LlmInvalidRequestError';
        this.code = code;
    }
}

export class LlmProviderError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(code);
        this.name = 'LlmProviderError';
        this.code = code;
    }
}

export class LlmLedgerError extends Error {
    readonly code: string;

    constructor(code: 'ledger_read_failed' | 'ledger_write_failed') {
        super(code);
        this.name = 'LlmLedgerError';
        this.code = code;
    }
}

function statusCode(error: unknown): number | null {
    if (typeof error !== 'object' || error === null) return null;
    const record = error as { statusCode?: unknown; status?: unknown };
    const value = typeof record.statusCode === 'number' ? record.statusCode : record.status;
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < 100 || value > 599) return null;
    return value;
}

/** A stable code for a provider failure. Ignores the provider message. */
export function publicProviderError(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'name' in error) {
        const name = (error as { name?: unknown }).name;
        if (name === 'TimeoutError' || name === 'AbortError') return 'timeout';
    }
    const status = statusCode(error);
    if (status === 429) return 'rate_limited';
    if (status === 401 || status === 403) return 'gateway_auth_failed';
    if (status === 402) return 'gateway_budget_or_credits';
    if (status === 404) return 'model_not_found';
    if (status != null) return `provider_status_${status}`;
    return 'provider_error';
}
