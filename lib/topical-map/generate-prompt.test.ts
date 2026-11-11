import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt, buildUserMessage } from './generate-prompt.ts';
import { architectStoredMetrics } from './metrics.ts';

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
