import test from 'node:test';
import assert from 'node:assert/strict';

import {
    existingPagesLine,
    ideaCoversSearch,
    mapCheck,
    mapCheckSummary,
    missedEmpty,
    missedIntro,
    missedMore,
    missedTimes,
    missedWhere,
    mixLine,
    productionHost,
    readStoredMix,
    repeatsLine,
    repeatsRemoved,
    seedOnlyLine,
    type MapCheckIdea,
} from './map-check.ts';
import type { ReviewEvidence, SearchGroup } from './review.ts';

function idea(id: string, overrides: Partial<MapCheckIdea> = {}): MapCheckIdea {
    return { id, title: `Idea ${id}`, targetQuery: `search ${id}`, action: 'create', pageType: 'service', ...overrides };
}

function group(query: string, impressions: number, overrides: Partial<SearchGroup> = {}): SearchGroup {
    return { query, variants: [], impressions, position: 30, page: null, pagePosition: null, ...overrides };
}

function evidence(groups: SearchGroup[], extra: Partial<ReviewEvidence> = {}): ReviewEvidence {
    return { connected: true, days: 28, queries: [], groups, ...extra };
}

test('an idea covers a search with the same intent, not just the same words', () => {
    const turf = idea('a', { targetQuery: 'artificial turf installation' });
    assert.equal(ideaCoversSearch(turf, group('artificial grass installers', 10)), true);
    assert.equal(ideaCoversSearch(turf, group('synthetic grass', 10)), true);
    // A city is its own page, as in the duplicate gate.
    assert.equal(ideaCoversSearch(turf, group('artificial turf temecula', 10)), false);
    assert.equal(ideaCoversSearch(idea('b', { targetQuery: 'pavers temecula' }), group('hardscape contractor', 10)), false);
});

test('specialty modifiers and places must match before shared words count', () => {
    const oc = idea('oc', { targetQuery: 'artificial grass installation Orange County', title: 'Artificial Grass Installation in Orange County', action: 'improve', matchedUrl: 'https://www.example.com/orange-county-ca/' });
    const ocPage = { page: 'https://www.example.com/orange-county-ca/', pagePosition: 12 };
    // The real false covers from the Ecoworkz review: turf reads as grass, but pet/dog and playground do not.
    assert.equal(ideaCoversSearch(oc, group('pet turf installation in orange county', 48, ocPage)), false);
    assert.equal(ideaCoversSearch(oc, group('synthetic turf for dogs orange county', 90, ocPage)), false);
    assert.equal(ideaCoversSearch(oc, group('playground turf orange county ca', 39, ocPage)), false);
    assert.equal(ideaCoversSearch(oc, group('artificial turf orange county', 300, ocPage)), true);
    assert.equal(ideaCoversSearch(oc, group('artificial grass installation', 300)), false);
    // With modifiers and places agreeing, a close rewording is still covered.
    assert.equal(ideaCoversSearch(oc, group('synthetic grass landscapes installation orange county', 32)), true);
    assert.equal(ideaCoversSearch(idea('r', { targetQuery: 'outdoor remodeling Orange County' }), group('exterior remodeling orange county', 38)), true);

    const commercial = group('commercial artificial grass installation', 120);
    assert.equal(ideaCoversSearch(idea('a', { targetQuery: 'artificial grass installation' }), commercial), false);
    assert.equal(ideaCoversSearch(idea('b', { targetQuery: 'commercial artificial turf', title: 'Commercial Artificial Turf' }), commercial), true);
    assert.equal(ideaCoversSearch(idea('c', { targetQuery: 'artificial turf installation' }), group('putting green turf', 50)), false);
    assert.equal(ideaCoversSearch(idea('d', { targetQuery: 'artificial grass cost' }), group('artificial grass', 50)), false);
    assert.equal(ideaCoversSearch(idea('e', { targetQuery: 'pavers vs concrete' }), group('pavers', 50)), false);
});

test('pages on another host, such as a staging copy, are never shown', () => {
    const check = mapCheck({
        ideas: [idea('a', { action: 'improve', matchedUrl: 'https://www.example.com/pavers/' })],
        evidence: evidence([
            group('outdoor kitchens', 300, { page: 'https://www.example.com/kitchens/', pagePosition: 30 }),
            group('artificial grass design', 114, { position: 47, page: 'https://staging.example.com/areas/', pagePosition: 47 }),
            // A staging page in the top 3 does not hide the search either.
            group('fire pits', 90, { position: 2, page: 'https://staging.example.com/fire-pits/', pagePosition: 2 }),
        ]),
    });
    assert.equal(productionHost(['https://www.example.com/a', 'https://example.com/b', 'https://staging.example.com/c']), 'example.com');
    assert.deepEqual(check.missed.map(search => [search.query, search.page]), [
        ['outdoor kitchens', 'https://www.example.com/kitchens/'],
        ['artificial grass design', null],
        ['fire pits', null],
    ]);
    assert.equal(missedWhere(check.missed[1]), 'Spot 47 in Google');
});

test('the title, the cited search and the page Google shows also count as covering', () => {
    assert.equal(ideaCoversSearch(idea('a', { title: 'Pet Turf for Dogs', targetQuery: 'dog friendly yard' }), group('pet turf dog', 10)), true);
    assert.equal(ideaCoversSearch(
        idea('b', { targetQuery: 'turf company temecula', demandQuery: 'temecula artificial grass' }),
        group('artificial turf temecula', 10),
    ), true);
    const improve = idea('c', { action: 'improve', targetQuery: 'golf at home', matchedUrl: 'https://example.com/putting-greens/' });
    assert.equal(ideaCoversSearch(improve, group('backyard putting green', 10, { page: 'https://www.example.com/putting-greens', pagePosition: 15 })), true);
    assert.equal(ideaCoversSearch(improve, group('backyard putting green', 10, { page: 'https://example.com/putting-greens/', pagePosition: 40 })), false);
});

test('lists the biggest searches no idea covers, leaving out brand and already-top-3 searches', () => {
    const ideas = [
        idea('turf', { targetQuery: 'artificial turf installation' }),
        idea('pets', { targetQuery: 'pet turf temecula' }),
        idea('greens', { action: 'improve', targetQuery: 'golf green', matchedUrl: 'https://example.com/putting-greens/' }),
    ];
    const check = mapCheck({
        ideas,
        brandName: 'Ecoworkz',
        evidence: evidence([
            group('hardscape contractor', 4498, { position: 52, page: 'https://example.com/', pagePosition: 52 }),
            group('artificial grass installation', 1200),
            group('ecoworkz turf', 900),
            group('artificial grass orange county', 816),
            group('artificial turf temecula', 666, { position: 9, page: 'https://example.com/temecula-ca/', pagePosition: 9 }),
            group('pet turf', 570),
            group('putting green', 466, { page: 'https://example.com/putting-greens/', pagePosition: 12 }),
            group('synthetic turf corona', 300, { position: 2, page: 'https://example.com/corona/', pagePosition: 2 }),
            group('playground turf', 298),
            group('near me', 50),
        ]),
    });
    assert.deepEqual(check.missed.map(search => [search.query, search.impressions]), [
        ['hardscape contractor', 4498],
        ['artificial grass orange county', 816],
        ['artificial turf temecula', 666],
        ['pet turf', 570],
        ['playground turf', 298],
    ]);
    assert.equal(check.missedTotal, 5);
    // Brand, top-3 and no-meaning searches are not checked.
    assert.equal(check.searchesChecked, 7);
    const capped = mapCheck({ ideas, evidence: evidence([group('fire pits', 5), group('outdoor kitchens', 4)]), limit: 1 });
    assert.deepEqual([capped.missed.length, capped.missedTotal], [1, 2]);
});

test('stored page-mix records supply cited searches, seed-only flags and page types', () => {
    const metadata = {
        duplicate_gate: { duplicate_ideas_dropped: 2 },
        page_mix: {
            dropped_duplicate_query: 3,
            records: {
                a: { page_type: 'service_city', seed_only: false, demand_query: 'temecula artificial grass', demand_impressions: 666 },
                b: { page_type: 'faq', seed_only: true, demand_query: null },
                c: { page_type: 'nonsense', seed_only: 'yes' },
            },
        },
    };
    const stored = readStoredMix(metadata);
    assert.deepEqual(stored.get('a'), { kind: 'service_city', seedOnly: false, demandQuery: 'temecula artificial grass' });
    assert.deepEqual(stored.get('c'), { kind: null, seedOnly: null, demandQuery: null });
    assert.equal(repeatsRemoved(metadata), 5);

    const check = mapCheck({
        ideas: [
            idea('a', { targetQuery: 'turf company temecula', pageType: 'landing' }),
            idea('b', { pageType: 'faq' }),
            idea('c', { pageType: 'blog_post' }),
            idea('d', { pageType: 'guide', contentCategory: 'Cost guide', action: 'keep', matchedUrl: 'https://example.com/cost/' }),
        ],
        evidence: evidence([group('artificial turf temecula', 666)]),
        generationMetadata: metadata,
    });
    assert.equal(check.missedTotal, 0);
    assert.deepEqual(check.seedOnly, { count: 1, of: 2, source: 'map' });
    assert.equal(check.existingPages, 1);
    assert.equal(check.articles, 3);
    assert.deepEqual(check.mix, [
        { label: 'Article', count: 1 },
        { label: 'Buyer question', count: 1 },
        { label: 'Cost guide', count: 1 },
        { label: 'Service in a city', count: 1 },
    ]);
});

test('older maps: no saved counts, seed-only worked out from the last 28 days', () => {
    const ideas = [idea('a', { targetQuery: 'Pet Turf' }), idea('b'), idea('c', { pageType: 'blog_post' })];
    const check = mapCheck({
        ideas,
        evidence: evidence([], { queries: [{ query: 'pet turf', impressions: 570, clicks: 1, position: 20, pages: [], competing: false }] }),
        generationMetadata: { stages_completed: ['architect'] },
    });
    assert.equal(check.repeatsRemoved, null);
    assert.deepEqual(check.seedOnly, { count: 2, of: 3, source: 'recent' });
    assert.deepEqual(check.mix, [{ label: 'Service or location page', count: 2 }, { label: 'Article', count: 1 }]);

    const offline = mapCheck({ ideas, evidence: { connected: false, days: 0, queries: [] } });
    assert.equal(offline.seedOnly, null);
    assert.deepEqual(offline.missed, []);
    // A response from before groups were sent is treated as "nothing to check".
    assert.equal(mapCheck({ ideas, evidence: { connected: true, days: 28, queries: [] } }).searchesChecked, 0);
});

test('client-facing copy is plain English with real numbers', () => {
    const check = mapCheck({
        ideas: [idea('a', { pageType: 'faq' }), idea('b'), idea('c', { action: 'improve', matchedUrl: 'https://example.com/x/' })],
        evidence: evidence([
            group('hardscape contractor', 4498, { position: 52.4, page: 'https://example.com/', pagePosition: 52 }),
            group('pet turf', 570, { position: 31, page: 'https://example.com/pets/', pagePosition: 31 }),
            group('playground turf', 1, { position: null }),
        ]),
        generationMetadata: { duplicate_gate: { duplicate_ideas_dropped: 1 }, page_mix: { dropped_duplicate_query: 0, records: { a: { page_type: 'faq', seed_only: true }, b: { page_type: 'service', seed_only: false } } } },
        limit: 2,
    });
    assert.equal(mapCheckSummary(check), '3 searches with no idea · 1 repeat idea removed · 1 of 3 ideas are articles');
    assert.match(missedIntro(check), /^Searches where your site showed up in Google in the last 28 days that no idea in this map covers, biggest first\./);
    assert.equal(missedTimes(check.missed[0]), 'Showed up 4,498 times in Google');
    assert.equal(missedWhere(check.missed[0]), 'Spot 52 in Google, mostly your home page');
    assert.equal(missedWhere(check.missed[1]), 'Spot 31 in Google, mostly /pets/');
    assert.equal(missedWhere({ query: 'x', impressions: 1, position: null, page: null }), null);
    assert.equal(missedTimes({ query: 'x', impressions: 1, position: null, page: null }), 'Showed up 1 time in Google');
    assert.equal(missedMore(check), 'Showing the top 2 of 3.');
    assert.deepEqual(repeatsLine(check), { label: '1 repeat idea removed before saving', detail: 'Each had the same main search, or the same page, as another idea.' });
    assert.equal(existingPagesLine(check).label, '1 idea matches a page you already have');
    assert.equal(seedOnlyLine(check)?.label, '1 of 2 ideas has no Google searches behind it');
    assert.deepEqual(mixLine(check), {
        label: '1 of 3 ideas is an article (33%)',
        detail: 'The rest are service and location pages. We aim for no more than 30% articles.',
    });

    const old = mapCheck({ ideas: [idea('a'), idea('b')], evidence: evidence([]) });
    assert.equal(repeatsLine(old).label, 'Repeat ideas removed: not recorded');
    assert.equal(seedOnlyLine(old)?.label, '2 of 2 ideas got no Google searches in the last 28 days');
    assert.equal(missedEmpty(old), 'Your site did not show up for any other searches in the last 28 days.');
    assert.equal(missedIntro({ ...old, connected: false }), 'Google Search Console is not connected, so we cannot check which searches the map missed.');
    for (const text of [mapCheckSummary(check), missedIntro(check), seedOnlyLine(check)?.detail ?? '', mixLine(check)?.detail ?? '']) {
        assert.doesNotMatch(text, /\b(GSC|SERP|cluster|impressions?)\b/i);
    }
});
