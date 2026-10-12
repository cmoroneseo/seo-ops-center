import test from 'node:test';
import assert from 'node:assert/strict';

import {
    costForUsage,
    formatUsdForPeople,
    parseUsd,
    sanitizeModelId,
    spendLevel,
    utcMonthWindow,
} from './cost.ts';

const usage = {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
};

test('a 25k/5k Opus draft costs twenty cents at the catalog base rate', () => {
    assert.equal(costForUsage('anthropic/claude-opus-5.5', {
        ...usage,
        inputTokens: 25_000,
        outputTokens: 5_000,
    }), '0.20000000');
});

test('the same draft on Sonnet costs ten cents', () => {
    assert.equal(costForUsage('anthropic/claude-sonnet-5.5', {
        ...usage,
        inputTokens: 25_000,
        outputTokens: 5_000,
    }), '0.10000000');
});

test('Haiku checks use the short-context rate under 100001 input tokens', () => {
    assert.equal(costForUsage('anthropic/claude-haiku-5.5', {
        ...usage,
        inputTokens: 40_000,
        outputTokens: 5_000,
    }), '0.00650000');
    assert.equal(costForUsage('anthropic/claude-haiku-5.5', {
        ...usage,
        inputTokens: 100_000,
        outputTokens: 0,
    }), '0.01000000');
});

test('Haiku input at the long-context tier prices the whole request at the higher rate', () => {
    assert.equal(costForUsage('anthropic/claude-haiku-5.5', {
        ...usage,
        inputTokens: 100_001,
        outputTokens: 0,
    }), '0.05000050');
});

test('cache writes are billed at the cache-write rate', () => {
    assert.equal(costForUsage('anthropic/claude-opus-5.5', {
        inputTokens: 1_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 1_000,
    }), '0.00500000');
});

test('an unknown model uses the Opus rate so the cap still moves', () => {
    assert.equal(costForUsage('other/model', {
        ...usage,
        inputTokens: 25_000,
        outputTokens: 5_000,
    }), '0.20000000');
});

test('spend warns at 80 percent and stops at the cap', () => {
    const cap = parseUsd('50.00');
    assert.equal(spendLevel(parseUsd('39.99999999'), cap), 'ok');
    assert.equal(spendLevel(parseUsd('40.00'), cap), 'warning');
    assert.equal(spendLevel(parseUsd('49.99999999'), cap), 'warning');
    assert.equal(spendLevel(parseUsd('50.00'), cap), 'blocked');
    assert.equal(spendLevel(parseUsd('0'), parseUsd('0')), 'blocked');
});

test('people-facing dollars round half up to cents', () => {
    assert.equal(formatUsdForPeople(parseUsd('40.20')), '40.20');
    assert.equal(formatUsdForPeople(parseUsd('50')), '50.00');
});

test('the ledger month is a UTC calendar month', () => {
    const october = utcMonthWindow(new Date('2026-10-31T23:59:59.000Z'));
    const november = utcMonthWindow(new Date('2026-11-01T00:00:00.000Z'));
    assert.equal(october.start.toISOString(), '2026-10-01T00:00:00.000Z');
    assert.equal(october.end.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(november.start.toISOString(), '2026-11-01T00:00:00.000Z');
});

test('a model id that is not a slug is replaced', () => {
    assert.equal(sanitizeModelId('anthropic/claude-opus-5.5'), 'anthropic/claude-opus-5.5');
    assert.equal(sanitizeModelId('anthropic/claude-opus-5.5\nsecret'), 'unknown_model');
});
