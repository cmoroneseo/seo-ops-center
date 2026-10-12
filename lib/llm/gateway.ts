/**
 * Vercel AI Gateway provider.
 *
 * This is the only module that talks to the AI SDK. Tests pass a fake
 * `generate` so this file's unit tests do not open a network connection.
 * Prompts are sent to the Gateway and are not logged.
 */

import { generateText } from 'ai';

import { LlmNotConfiguredError, LlmProviderError, publicProviderError } from './errors.ts';
import type { LlmMessage, LlmProvider, LlmProviderRequest, LlmProviderResult, LlmUsage } from './types.ts';

interface GatewayUsage {
    inputTokens?: number;
    outputTokens?: number;
    inputTokenDetails?: {
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
    };
}

interface GatewayResult {
    text: string;
    usage: GatewayUsage;
    response: { modelId?: string };
}

export interface GatewayGenerateOptions {
    model: string;
    system?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    maxOutputTokens: number;
    maxRetries: number;
    timeout: number;
    providerOptions: {
        gateway: {
            models: string[];
            zeroDataRetention: boolean;
            disallowPromptTraining: boolean;
            tags: string[];
        };
    };
}

export type GatewayGenerate = (options: GatewayGenerateOptions) => Promise<GatewayResult>;

function gatewayConfigured(env: NodeJS.ProcessEnv): boolean {
    return Boolean(env.AI_GATEWAY_API_KEY?.trim() || env.VERCEL_OIDC_TOKEN?.trim());
}

function tokenCount(value: unknown): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return 0;
    return Math.min(value, 2_000_000_000);
}

function usageFrom(usage: GatewayUsage): LlmUsage {
    return {
        inputTokens: tokenCount(usage.inputTokens),
        outputTokens: tokenCount(usage.outputTokens),
        cacheReadTokens: tokenCount(usage.inputTokenDetails?.cacheReadTokens),
        cacheWriteTokens: tokenCount(usage.inputTokenDetails?.cacheWriteTokens),
    };
}

function splitMessages(messages: LlmMessage[]): { system?: string; chat: GatewayGenerateOptions['messages'] } {
    const systemParts: string[] = [];
    const chat: GatewayGenerateOptions['messages'] = [];
    for (const message of messages) {
        if (message.role === 'system') {
            systemParts.push(message.content);
            continue;
        }
        chat.push({ role: message.role, content: message.content });
    }
    const system = systemParts.join('\n\n');
    return { system: system === '' ? undefined : system, chat };
}

async function defaultGenerate(options: GatewayGenerateOptions): Promise<GatewayResult> {
    const result = await generateText({
        model: options.model,
        system: options.system,
        messages: options.messages,
        maxOutputTokens: options.maxOutputTokens,
        maxRetries: options.maxRetries,
        timeout: options.timeout,
        providerOptions: options.providerOptions,
    });
    return {
        text: result.text,
        usage: result.usage,
        response: { modelId: result.response.modelId },
    };
}

export function createGatewayLlmProvider(options?: {
    generate?: GatewayGenerate;
    env?: NodeJS.ProcessEnv;
}): LlmProvider {
    const generate = options?.generate ?? defaultGenerate;
    const env = options?.env ?? process.env;
    return {
        async generate(request: LlmProviderRequest): Promise<LlmProviderResult> {
            if (!gatewayConfigured(env)) throw new LlmNotConfiguredError();
            const { system, chat } = splitMessages(request.messages);
            try {
                const result = await generate({
                    model: request.model,
                    system,
                    messages: chat,
                    maxOutputTokens: request.maxOutputTokens,
                    maxRetries: request.maxRetries,
                    timeout: request.timeoutMs,
                    providerOptions: {
                        gateway: {
                            models: [request.fallbackModel],
                            zeroDataRetention: true,
                            disallowPromptTraining: true,
                            tags: [request.feature],
                        },
                    },
                });
                if (typeof result.text !== 'string') throw new LlmProviderError('provider_error');
                return {
                    text: result.text,
                    model: result.response.modelId?.trim() || request.model,
                    usage: usageFrom(result.usage ?? {}),
                };
            } catch (error) {
                if (error instanceof LlmProviderError || error instanceof LlmNotConfiguredError) throw error;
                throw new LlmProviderError(publicProviderError(error));
            }
        },
    };
}
