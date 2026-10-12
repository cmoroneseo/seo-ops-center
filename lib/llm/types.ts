import type { LlmTask } from './config.ts';

export interface LlmMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LlmUsage {
    /** Total input tokens, including any cache read and write tokens. */
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}

export interface LlmGenerateInput {
    organizationId: string;
    clientId?: string | null;
    /** Short slug stored on the ledger, such as content_writer.draft. */
    feature: string;
    refId?: string | null;
    task: LlmTask;
    messages: LlmMessage[];
    maxOutputTokens?: number;
}

export interface LlmSpendSnapshot {
    monthUsd: string;
    capUsd: string;
    /** spend / cap, four decimal places. A zero cap is reported as 1. */
    ratio: string;
    warning: boolean;
    warningMessage: string | null;
}

export interface LlmGenerateResult {
    callId: string;
    text: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: string;
    latencyMs: number;
    spend: LlmSpendSnapshot;
}

export interface LlmProviderRequest {
    model: string;
    fallbackModel: string;
    feature: string;
    messages: LlmMessage[];
    maxOutputTokens: number;
    timeoutMs: number;
    maxRetries: number;
}

export interface LlmProviderResult {
    text: string;
    /** Model that actually answered. May be the fallback. */
    model: string;
    usage: LlmUsage;
}

export interface LlmProvider {
    generate(request: LlmProviderRequest): Promise<LlmProviderResult>;
}

export type LlmCallStatus = 'succeeded' | 'failed' | 'blocked';

export interface LlmCallDraft {
    organizationId: string;
    clientId: string | null;
    feature: string;
    refId: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: string;
    latencyMs: number | null;
    status: LlmCallStatus;
    error: string | null;
}

export interface LlmCallStore {
    getMonthlyCapUsd(organizationId: string): Promise<string>;
    sumMonthSpendUsd(organizationId: string, monthStart: Date, monthEnd: Date): Promise<string>;
    clientBelongsToOrg(organizationId: string, clientId: string): Promise<boolean>;
    insertCall(row: LlmCallDraft): Promise<{ id: string }>;
}
