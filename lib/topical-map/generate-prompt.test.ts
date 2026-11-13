import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { buildSystemPrompt, buildUserMessage, GENERATION_SCHEMA, GSC_PROMPT_GROUPS } from './generate-prompt.ts';
import { architectStoredMetrics } from './metrics.ts';
import { PAGE_KINDS } from './page-mix.ts';

test('the architect prompt does not ask for volume or keyword difficulty', () => {
    const prompt = buildSystemPrompt();
    assert.equal(prompt.includes('"search_volume_monthly"'), false);
    assert.equal(prompt.includes('"keyword_difficulty"'), false);
    assert.equal(prompt.includes('your best estimate'), false);
    assert.match(prompt, /Do not estimate search volume, keyword difficulty, or traffic/);
    assert.match(prompt, /Do NOT include search_volume_monthly, keyword_difficulty, or traffic estimates/);
});

test('the user message still passes measured Search Console queries', () => {
    const message = buildUserMessage({
        profile: {
            brandName: 'Northside Plumbing',
            businessDescription: 'Local plumbing',
            contentLanguage: 'en',
            focusTopics: ['drain cleaning'],
            rivals: [],
        },
        existingPages: [],
        gscQueries: [{ query: 'emergency plumber', clicks: 3, impressions: 40, position: 8.2 }],
        clientDomain: 'northside.example',
    });
    assert.match(message, /"emergency plumber" \| 3 clicks \| 40 impr \| pos 8\.2/);
    assert.equal(message.includes('Keywords to cover'), false);
});

test('the prompt asks for money pages first with capped articles and cited demand', () => {
    const prompt = buildSystemPrompt();
    assert.equal(prompt.includes('MINIMUM 30'), false);
    assert.equal(/long-tail/i.test(prompt), false);
    for (const kind of PAGE_KINDS) assert.ok(prompt.includes(`- ${kind}:`), kind);
    assert.match(prompt, /Articles at most 30%/);
    assert.match(prompt, /removes seed_only records, except service pages for services the business sells/);
    assert.match(prompt, /top 3-5 cities by impressions times the top 2-3 services, never the full city-by-service matrix/);
    assert.match(prompt, /A city page only when the map has 2 or more service_city pages/);
    assert.match(prompt, /3-10 supporting_queries/);
    assert.match(prompt, /Never create pages for services the business does not sell/);
    assert.match(prompt, /Never more than 40/);
    assert.match(prompt, /"supporting_queries": \[/);
    assert.match(prompt, /"demand_query":/);
    assert.match(prompt, /"seed_only": false/);
});

test('the prompt asks for one idea per page, service pages first and city pages only with their own demand', () => {
    const prompt = buildSystemPrompt();
    assert.match(prompt, /Never make two records for the same existing page/);
    assert.match(prompt, /put the other searches in its supporting_queries/);
    assert.match(prompt, /Every existing service page whose service has searches in the Search Console list gets its own record/);
    assert.match(prompt, /listed before any service_city page for that service/);
    assert.match(prompt, /that exact service-and-city search has its own line in the Search Console list/);
    assert.match(prompt, /target_query should be that search/);
});

test('the user message lists grouped searches with their wordings, capped for prompt size', () => {
    const groups = Array.from({ length: 80 }, (_, i) => ({
        query: `search ${i}`, clicks: 0, impressions: 1000 - i, position: 30, variants: i === 0 ? ['other wording'] : [],
    }));
    const message = buildUserMessage({
        profile: { brandName: 'Ecoworkz', businessDescription: 'Turf', contentLanguage: 'en', focusTopics: [], rivals: [] },
        existingPages: [],
        gscQueries: groups,
        gscDays: 90,
        clientDomain: 'ecoworkz.com',
    });
    const lines = message.split('\n').filter(line => line.startsWith('- "search '));
    assert.equal(lines.length, GSC_PROMPT_GROUPS);
    assert.equal(lines[0], '- "search 0" | 0 clicks | 1000 impr | pos 30.0 | also: "other wording"');
    assert.match(message, /last 90 days, grouped by intent, top 60 of 80 by impressions/);
});

test('the output schema asks for the new page types and demand fields', () => {
    const record = GENERATION_SCHEMA.properties.silos.items.properties.records.items;
    assert.deepEqual(record.properties.page_type.enum, [...PAGE_KINDS]);
    assert.ok(record.required.includes('supporting_queries'));
    assert.ok(record.required.includes('demand_query'));
    assert.ok(record.required.includes('seed_only'));
});

test('the architect route runs the page-mix check and stores mapped types and counts', () => {
    const route = readFileSync(new URL('../../app/api/topical-map/generate-architect/route.ts', import.meta.url), 'utf8');
    assert.match(route, /validatePageMix\(/);
    assert.match(route, /gscQueries: gscContext\.clusters/);
    assert.match(route, /page_type: mix\.storedType/);
    assert.match(route, /content_category: mix\.label/);
    assert.match(route, /page_mix: \{/);
    assert.equal(route.includes('String(rec.page_type'), false, 'the raw model page type is never stored');
    // Matching, one-idea-per-page and service pages run in planPages on the stored page types.
    assert.match(route, /planPages\(\{/);
    assert.match(route, /target_query: mix\.targetQuery/);
    assert.match(route, /supporting_queries: mix\.supportingQueries/);
    assert.match(route, /servicePageNames\(existingPages/);
    assert.match(route, /\{ services \}/);
    assert.match(route, /mix\.parentIndex/);
    assert.match(route, /max_tokens: 16384/);
});

test('model volume and difficulty are not stored', () => {
    assert.deepEqual(architectStoredMetrics({
        search_volume_monthly: 2400,
        keyword_difficulty: 52,
        title: 'Local SEO',
    }), {
        search_volume_monthly: null,
        keyword_difficulty: null,
    });
});
