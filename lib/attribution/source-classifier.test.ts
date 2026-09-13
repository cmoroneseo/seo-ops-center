import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySource, countSeoConversions, isSourceCategory, resolveSessionAttribution } from './source-classifier.ts';

test('classifySource: google.com → organic_google', () => {
    assert.equal(classifySource('https://www.google.com/', null, 'client.com'), 'organic_google');
});

test('first-touch direct, organic, paid and AI inputs survive later internal navigation', () => {
    for (const [initial_referrer, initial_utm_medium, expected] of [
        ['', '', 'direct'], ['https://google.com/', '', 'organic_google'],
        ['https://google.com/', 'cpc', 'paid'], ['https://chatgpt.com/', '', 'ai_chatgpt'],
    ]) {
        const result = resolveSessionAttribution({ initial_referrer, initial_utm_medium,
            initial_utm_source: 'initial-source', initial_utm_campaign: 'initial-campaign',
            referrer: 'https://client.com/inside', utm_medium: 'organic', utm_source: 'later-source',
            session_source: 'https://forged.example/' }, 'client.com');
        assert.equal(result.sourceCategory, expected);
        assert.equal(result.referrer, initial_referrer);
        assert.equal(result.utmSource, 'initial-source');
        assert.equal(result.utmCampaign, 'initial-campaign');
    }
});

test('legacy session_source is classified or validated and never stored as a raw category', () => {
    for (const [session_source, expected] of [['', 'direct'], ['https://google.com/', 'organic_google'],
        ['paid', 'paid'], ['same_site', 'direct'], ['untrusted-category', 'direct']]) {
        assert.equal(resolveSessionAttribution({ referrer: 'https://client.com/contact', session_source }, 'client.com').sourceCategory, expected);
    }
    assert.equal(isSourceCategory('https://google.com/'), false);
    assert.equal(isSourceCategory('organic_made_up'), false);
});

test('SEO ROI credits only the six explicit organic and AI categories', () => {
    const sources = ['organic_google', 'organic_bing', 'organic_other', 'ai_chatgpt', 'ai_perplexity', 'ai_google_aio',
        'paid', 'direct', 'social', 'referral', 'same_site', 'organic_forged', 'ai_forged'].map(sourceCategory => ({ sourceCategory, count: 2 }));
    const leads = countSeoConversions(sources);
    assert.equal(leads, 12);
    assert.equal(leads * 4500, 54000);
    assert.equal(sources.reduce((sum, source) => sum + source.count, 0), 26);
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
