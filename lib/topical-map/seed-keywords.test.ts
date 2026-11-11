import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildUserMessage } from './generate-prompt.ts';
import { profileFromStored, profileToStored } from './profile.ts';
import {
    generationRequestBody,
    normalizeSeedKeywords,
    seedInputWithKeywords,
    seedKeywordsFromMap,
    selectedSeedKeywords,
} from './seed-keywords.ts';

const profile = {
    brandName: 'Northside Plumbing',
    businessDescription: 'Local plumbing',
    contentLanguage: 'en',
    focusTopics: ['drain cleaning'],
    rivals: ['rival.example'],
};

test('seed keywords drop blanks, duplicates, and anything that is not text', () => {
    assert.deepEqual(normalizeSeedKeywords([
        ' Roof repair ',
        'roof repair',
        '',
        '   ',
        12,
        null,
        'a'.repeat(81),
        'emergency plumber',
    ]), ['Roof repair', 'emergency plumber']);
});

test('an empty keyword choice is omitted from the generation request', () => {
    const body = generationRequestBody({
        clientId: 'client',
        organizationId: 'org',
        keywords: selectedSeedKeywords([
            { keyword: 'roof repair', selected: false },
            { keyword: '   ', selected: true },
        ]),
    });
    assert.deepEqual(body, { clientId: 'client', organizationId: 'org' });
    assert.equal('keywords' in body, false);
    assert.deepEqual(seedInputWithKeywords({ rivals: ['rival.example'], focus_topics: ['drains'] }, []), {
        rivals: ['rival.example'],
        focus_topics: ['drains'],
    });
    assert.equal('keywords' in seedInputWithKeywords({ rivals: [], focus_topics: [] }, []), false);
});

test('chosen keywords are stored on the map and repeated in the generation prompt', () => {
    const keywords = selectedSeedKeywords([
        { keyword: 'roof repair', selected: true },
        { keyword: 'skipped', selected: false },
        { keyword: 'emergency plumber', selected: true },
    ]);
    const body = generationRequestBody({ clientId: 'client', organizationId: 'org', keywords });
    assert.deepEqual(body.keywords, ['roof repair', 'emergency plumber']);
    const stored = seedInputWithKeywords({ rivals: ['rival.example'], focus_topics: ['drains'] }, keywords);
    assert.deepEqual(seedKeywordsFromMap(stored), ['roof repair', 'emergency plumber']);
    assert.deepEqual(seedKeywordsFromMap({ rivals: [] }), []);
    assert.deepEqual(seedKeywordsFromMap(null), []);

    const message = buildUserMessage({
        profile,
        existingPages: [],
        gscQueries: [],
        clientDomain: 'northside.example',
        seedKeywords: keywords,
    });
    assert.match(message, /\*\*Keywords to cover:\*\* roof repair, emergency plumber/);
    assert.match(message, /Do not invent monthly searches or difficulty/);

    const untouched = buildUserMessage({
        profile,
        existingPages: [],
        gscQueries: [],
        clientDomain: 'northside.example',
    });
    assert.equal(untouched.includes('Keywords to cover'), false);
});

test('chosen keywords round-trip on the saved brand profile', () => {
    const stored = profileToStored({ ...profile, keywords: [' Roof repair ', 'roof repair', 'emergency plumber'] }, '2026-11-11T00:00:00.000Z');
    assert.deepEqual(stored.keywords, ['Roof repair', 'emergency plumber']);
    const read = profileFromStored(stored);
    assert.deepEqual(read?.keywords, ['Roof repair', 'emergency plumber']);
    assert.deepEqual(profileFromStored({ brand_name: 'Northside' })?.keywords, []);
    assert.equal(profileFromStored(null), null);
});

test('generation reads optional keywords and still accepts a request without them', () => {
    const generate = readFileSync(new URL('../../app/api/topical-map/generate/route.ts', import.meta.url), 'utf8');
    const architect = readFileSync(new URL('../../app/api/topical-map/generate-architect/route.ts', import.meta.url), 'utf8');
    assert.match(generate, /normalizeSeedKeywords\(body\?\.keywords\)/);
    assert.match(generate, /seedInputWithKeywords\(/);
    assert.match(architect, /seed_input/);
    assert.match(architect, /seedKeywords: seedKeywordsFromMap\(mapRow\.seed_input\)/);
});
