/**
 * Cost and spend-cap math.
 *
 * cost = uncached input * input rate
 *      + cache read * cache-read rate
 *      + cache write * cache-write rate
 *      + output * output rate
 *
 * Input tokens reported by the provider already include cache read and write
 * tokens. Those are priced at their own rates and are not billed again as
 * fresh input. Rates are the Gateway catalog base prices in lib/llm/config.ts.
 * An unknown model is priced at the Opus 5.5 rates so a surprise model id
 * still moves the cap.
 */

import { LLM_SPEND_WARNING_DENOMINATOR, LLM_SPEND_WARNING_NUMERATOR, MODEL_PRICES, type ModelPrice } from './config.ts';

const USD_SCALE = 8;
const RATE_SCALE = 12;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);
const TEN_THOUSAND = BigInt(10000);
const USD_FACTOR = TEN ** BigInt(USD_SCALE);

export type SpendLevel = 'ok' | 'warning' | 'blocked';

function parseDecimal(value: string, scale: number): bigint {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match) throw new Error('invalid_usd');
    const whole = BigInt(match[1]);
    const fracRaw = match[2] ?? '';
    const digits = fracRaw.slice(0, scale).padEnd(scale, '0');
    const rest = fracRaw.slice(scale);
    let frac = BigInt(digits);
    const roundDigit = rest[0];
    if (roundDigit != null && roundDigit >= '5') frac += ONE;
    const factor = TEN ** BigInt(scale);
    return whole * factor + frac;
}

export function parseUsd(value: string): bigint {
    return parseDecimal(value, USD_SCALE);
}

export function formatUsd(scaled: bigint): string {
    if (scaled < ZERO) throw new Error('invalid_usd');
    const whole = scaled / USD_FACTOR;
    const frac = scaled % USD_FACTOR;
    return `${whole}.${frac.toString().padStart(USD_SCALE, '0')}`;
}

/** Two decimal places for an AM-facing sentence. */
export function formatUsdForPeople(scaled: bigint): string {
    if (scaled < ZERO) throw new Error('invalid_usd');
    const centsFactor = HUNDRED;
    const rounded = (scaled + USD_FACTOR / centsFactor / TWO) / (USD_FACTOR / centsFactor);
    const whole = rounded / centsFactor;
    const cents = rounded % centsFactor;
    return `${whole}.${cents.toString().padStart(2, '0')}`;
}

export function tokensTimesRate(tokens: number, ratePerToken: string): bigint {
    if (!Number.isInteger(tokens) || tokens < 0) throw new Error('invalid_tokens');
    const rate = parseDecimal(ratePerToken, RATE_SCALE);
    const product = BigInt(tokens) * rate;
    const divisor = TEN ** BigInt(RATE_SCALE - USD_SCALE);
    return (product + divisor / TWO) / divisor;
}

function ceilingPrice(): ModelPrice {
    const price = MODEL_PRICES['anthropic/claude-opus-5.5'];
    if (!price) throw new Error('missing_ceiling_price');
    return price;
}

export interface PricedUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
}

export function costForUsage(model: string, usage: PricedUsage): string {
    const price = MODEL_PRICES[model] ?? ceilingPrice();
    const cacheRead = usage.cacheReadTokens;
    const cacheWrite = usage.cacheWriteTokens;
    const uncached = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
    const totalInput = uncached + cacheRead + cacheWrite;
    const long = price.longContextFromTokens != null && totalInput >= price.longContextFromTokens;
    const inputRate = long && price.longContextInputPerToken
        ? price.longContextInputPerToken
        : price.inputPerToken;
    const outputRate = long && price.longContextOutputPerToken
        ? price.longContextOutputPerToken
        : price.outputPerToken;
    const cacheReadRate = long && price.longContextCacheReadPerToken
        ? price.longContextCacheReadPerToken
        : price.cacheReadPerToken;
    const cacheWriteRate = long && price.longContextCacheWritePerToken
        ? price.longContextCacheWritePerToken
        : price.cacheWritePerToken;
    const total = tokensTimesRate(uncached, inputRate)
        + tokensTimesRate(cacheRead, cacheReadRate)
        + tokensTimesRate(cacheWrite, cacheWriteRate)
        + tokensTimesRate(usage.outputTokens, outputRate);
    return formatUsd(total);
}

/**
 * Hard-stop at 100% of the cap, including a cap of $0.
 * Warn at 80% while the call is still allowed.
 * The call that crosses the cap is allowed to finish; the next one stops.
 */
export function spendLevel(spend: bigint, cap: bigint): SpendLevel {
    if (cap <= ZERO || spend >= cap) return 'blocked';
    if (spend * LLM_SPEND_WARNING_DENOMINATOR >= cap * LLM_SPEND_WARNING_NUMERATOR) return 'warning';
    return 'ok';
}

export function spendRatio(spend: bigint, cap: bigint): string {
    if (cap <= ZERO) return '1.0000';
    const scaled = (spend * TEN_THOUSAND + cap / TWO) / cap;
    const whole = scaled / TEN_THOUSAND;
    const frac = scaled % TEN_THOUSAND;
    return `${whole}.${frac.toString().padStart(4, '0')}`;
}

export function spendWarningMessage(monthUsd: string, capUsd: string): string {
    return `This organization has used $${monthUsd} of its $${capUsd} AI budget this month (80% or more). `
        + 'Spend is absorbed by the agency. At 100% new AI calls stop.';
}

export function utcMonthWindow(now: Date): { start: Date; end: Date } {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
}

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$/;

export function sanitizeModelId(model: string): string {
    const trimmed = model.trim();
    return MODEL_ID.test(trimmed) ? trimmed : 'unknown_model';
}
