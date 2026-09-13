import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySource } from './source-classifier.ts';

test('classifySource: google.com → organic_google', () => {
    assert.equal(classifySource('https://www.google.com/', null, 'client.com'), 'organic_google');
});

test('classifySource: google.co.uk → organic_google', () => {
    assert.equal(classifySource('https://www.google.co.uk/search?q=test', null, 'client.com'), 'organic_google');
});

test('classifySource: bing.com → organic_bing', () => {
    assert.equal(classifySource('https://www.bing.com/search?q=test', null, 'client.com'), 'organic_bing');
});

test('classifySource: duckduckgo.com → organic_other', () => {
    assert.equal(classifySource('https://duckduckgo.com/?q=test', null, 'client.com'), 'organic_other');
});

test('classifySource: yahoo.com → organic_other', () => {
    assert.equal(classifySource('https://search.yahoo.com/search?p=test', null, 'client.com'), 'organic_other');
});

test('classifySource: chatgpt.com → ai_chatgpt', () => {
    assert.equal(classifySource('https://chatgpt.com/', null, 'client.com'), 'ai_chatgpt');
});

test('classifySource: chat.openai.com → ai_chatgpt', () => {
    assert.equal(classifySource('https://chat.openai.com/', null, 'client.com'), 'ai_chatgpt');
});

test('classifySource: perplexity.ai → ai_perplexity', () => {
    assert.equal(classifySource('https://www.perplexity.ai/', null, 'client.com'), 'ai_perplexity');
});

test('classifySource: facebook.com → social', () => {
    assert.equal(classifySource('https://www.facebook.com/post/123', null, 'client.com'), 'social');
});

test('classifySource: instagram.com → social', () => {
    assert.equal(classifySource('https://www.instagram.com/', null, 'client.com'), 'social');
});

test('classifySource: linkedin.com → social', () => {
    assert.equal(classifySource('https://www.linkedin.com/', null, 'client.com'), 'social');
});

test('classifySource: x.com → social', () => {
    assert.equal(classifySource('https://x.com/', null, 'client.com'), 'social');
});

test('classifySource: tiktok.com → social', () => {
    assert.equal(classifySource('https://www.tiktok.com/', null, 'client.com'), 'social');
});

test('classifySource: utm_medium=cpc → paid', () => {
    assert.equal(classifySource('https://www.google.com/', 'cpc', 'client.com'), 'paid');
});

test('classifySource: utm_medium=ppc → paid', () => {
    assert.equal(classifySource('https://www.google.com/', 'ppc', 'client.com'), 'paid');
});

test('classifySource: same domain → same_site', () => {
    assert.equal(classifySource('https://www.client.com/about', null, 'client.com'), 'same_site');
});

test('classifySource: no referrer → direct', () => {
    assert.equal(classifySource('', null, 'client.com'), 'direct');
});

test('classifySource: unknown site → referral', () => {
    assert.equal(classifySource('https://www.somesite.com/', null, 'client.com'), 'referral');
});
