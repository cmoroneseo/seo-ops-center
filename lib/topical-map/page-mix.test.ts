import test from 'node:test';
import assert from 'node:assert/strict';

import type { ArchitectGscCluster } from './architect-gsc.ts';
import { clusterKey } from './architect-gsc.ts';
import {
    ARTICLE_KINDS,
    ARTICLE_MIN_ALLOWED,
    maxWithinShare,
    namesService,
    PAGE_KIND_LABEL,
    PAGE_KINDS,
    pageKindOf,
    servicePageNames,
    STORED_PAGE_TYPE,
    storedPageType,
    validatePageMix,
    type MixInput,
} from './page-mix.ts';

const ignore = new Set(['ecoworkz']);

function cluster(query: string, impressions: number): ArchitectGscCluster {
    return { query, clicks: 0, impressions, position: 20, variants: [], key: clusterKey(query, ignore) };
}

const clusters = [
    cluster('hardscape contractor', 4498),
    cluster('artificial turf temecula', 666),
    cluster('pet turf', 570),
    cluster('putting greens', 466),
    cluster('playground turf', 298),
    cluster('artificial grass orange county', 816),
    cluster('artificial turf cost', 120),
    cluster('turf vs real grass', 90),
];

/** Distinct words: intentKey drops digits, so numbered names would all be one search. */
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar'];

const money = (targetQuery: string, extra: Partial<MixInput> = {}): MixInput =>
    ({ pageType: 'service', targetQuery, demandQuery: targetQuery, buildPhase: 1, ...extra });
const article = (targetQuery: string, pageType = 'faq', extra: Partial<MixInput> = {}): MixInput =>
    ({ pageType, targetQuery, buildPhase: 2, ...extra });

test('every page kind maps onto a page type the database accepts', () => {
    const allowed = new Set(['pillar', 'service', 'landing', 'product', 'collection', 'city', 'blog_post', 'guide',
        'faq', 'resource_center', 'knowledge_base', 'homepage', 'comparison', 'case_study', 'other']);
    for (const kind of PAGE_KINDS) {
        assert.ok(allowed.has(STORED_PAGE_TYPE[kind]), kind);
        assert.ok(PAGE_KIND_LABEL[kind].length > 0);
        assert.equal(/_/.test(PAGE_KIND_LABEL[kind]), false, 'labels are plain English');
    }
    assert.equal(STORED_PAGE_TYPE.sub_service, 'service');
    assert.equal(STORED_PAGE_TYPE.service_city, 'landing');
    assert.equal(STORED_PAGE_TYPE.city, 'city');
    assert.equal(STORED_PAGE_TYPE.cost, 'guide');
    // A buyer question is an article for PR 1's matcher; only an FAQ page is stored as 'faq'.
    assert.equal(STORED_PAGE_TYPE.faq, 'blog_post');
    assert.equal(storedPageType('faq', 'Does artificial turf get hot?'), 'blog_post');
    assert.equal(storedPageType('faq', 'Artificial Grass FAQ: Maintenance, Heat, Pets'), 'faq');
    assert.equal(storedPageType('cost', 'Artificial Grass FAQ'), 'guide');
    assert.equal(STORED_PAGE_TYPE.local_resource, 'resource_center');
});

test('loose page types read as the closest kind; unknown ones count as articles', () => {
    assert.equal(pageKindOf('sub_service'), 'sub_service');
    assert.equal(pageKindOf('Service City'), 'service_city');
    assert.equal(pageKindOf('service-city'), 'service_city');
    assert.equal(pageKindOf('question'), 'faq');
    assert.equal(pageKindOf('pillar'), 'service');
    assert.equal(pageKindOf('resource_center'), 'local_resource');
    assert.equal(pageKindOf('blog_post'), 'faq');
    assert.equal(pageKindOf(undefined), 'faq');
    assert.ok(ARTICLE_KINDS.has(pageKindOf('guide')));
});

test('blog_post and guide are articles sorted by their words', () => {
    assert.equal(pageKindOf('guide', 'How Much Does Artificial Grass Cost to Install in Southern California?'), 'cost');
    assert.equal(pageKindOf('blog_post', 'Pavers vs Concrete Patio in Southern California'), 'comparison');
    assert.equal(pageKindOf('blog_post', 'Artificial Turf vs Natural Grass Cost'), 'comparison');
    assert.equal(pageKindOf('blog_post', 'Southern California Water Rebates for Lawn Removal'), 'local_resource');
    assert.equal(pageKindOf('guide', 'How to Finance a Backyard Remodel'), 'faq');
    assert.equal(pageKindOf('case_study', 'Corona backyard'), 'faq');
    // A typed kind is never re-sorted by its words.
    assert.equal(pageKindOf('service', 'Artificial turf cost'), 'service');
    assert.equal(pageKindOf('faq', 'Artificial turf cost'), 'faq');
});

test('share caps never round a small map down to nothing', () => {
    assert.equal(maxWithinShare(7, 0.3), 3);
    assert.equal(maxWithinShare(14, 0.3), 6);
    assert.equal(maxWithinShare(10, 0.3), 4);
    assert.equal(maxWithinShare(12, 0.2), 3);
    // The raw share math floors to 0; the caps use a minimum.
    assert.equal(maxWithinShare(3, 0.2), 0);
    assert.equal(maxWithinShare(1, 0.3, ARTICLE_MIN_ALLOWED), 2);
    assert.equal(maxWithinShare(2, 0.3, ARTICLE_MIN_ALLOWED), 2);
    assert.equal(maxWithinShare(14, 0.3, ARTICLE_MIN_ALLOWED), 6);

    const result = validatePageMix([
        money('pet turf'),
        money('putting greens'),
        article('artificial turf cost', 'cost'),
        article('turf vs real grass', 'comparison'),
        article('does turf get hot'),
    ], [...clusters, cluster('does turf get hot', 40)], ignore);
    assert.equal(result.summary.articles, 2, '2 money pages still keep 2 articles');
    assert.deepEqual(result.dropped, [{ index: 4, reason: 'article_cap' }]);
});

test('children of a dropped idea move to the nearest kept ancestor', () => {
    const ideas: MixInput[] = [
        money('hardscape contractor'),                                                  // 0 kept
        money('alpha hardscape', { demandQuery: null, parentIndex: 0, buildPhase: 3 }), // 1 no demand, dropped
        money('pet turf', { parentIndex: 1 }),                                          // 2 kept, parent 1 dropped -> 0
        money('putting greens', { parentIndex: 4 }),                                    // 3 kept, parent 4 is a duplicate of 2 -> 2
        money('Pet turf near me', { parentIndex: 1 }),                                  // 4 duplicate of 2
        money('bravo hardscape', { demandQuery: null, buildPhase: 3 }),                 // 5 no demand, top level, dropped
        money('playground turf', { parentIndex: 5 }),                                   // 6 kept, no kept ancestor -> top level
        money('artificial turf temecula', { parentIndex: 0 }),                          // 7 kept, parent kept
        money('charlie hardscape', { demandQuery: null }),                              // 8 no demand, dropped
    ];
    const result = validatePageMix(ideas, clusters, ignore);
    const parentOf = (index: number) => result.kept.find(item => item.index === index)?.parentIndex;
    assert.deepEqual(result.dropped.map(d => d.index), [1, 4, 5, 8]);
    assert.equal(parentOf(2), 0);
    assert.equal(parentOf(3), 2);
    assert.equal(parentOf(6), null);
    assert.equal(parentOf(7), 0);
    assert.equal(parentOf(0), null);
    assert.equal(result.summary.reattached_children, 3);
});

test('service pages for services the business sells are kept without demand; other ideas without demand are dropped', () => {
    const services = ['artificial grass/turf installation', 'pavers/hardscape', 'masonry', 'outdoor kitchens', 'fire pits',
        'outdoor living spaces', 'landscaping/backyard remodel', 'commercial landscaping'];
    const ideas: MixInput[] = [
        money('hardscape contractor'),
        money('pet turf'),
        money('masonry contractors', { title: 'Masonry & Outdoor Structure Contractors', demandQuery: null }),
        money('outdoor kitchen installation', { title: 'Outdoor Kitchen & BBQ Island Installation', demandQuery: null }),
        money('fire pit installation orange county', { title: 'Fire Pit Installation in Orange County', demandQuery: null }),
        money('outdoor living space contractor', { title: 'Outdoor Living Space Contractor in the Inland Empire', demandQuery: null }),
        money('commercial landscape contractor', { pageType: 'sub_service', demandQuery: null }),
        // Not services they sell, or not service pages: dropped.
        money('pool builder', { demandQuery: null }),
        money('solar panels', { demandQuery: null }),
        money('fire pit ideas', { pageType: 'service_city', demandQuery: null }),
        article('outdoor kitchen layout ideas', 'faq', { demandQuery: null }),
    ];
    const result = validatePageMix(ideas, clusters, ignore, { services });
    const kept = new Set(result.kept.map(item => item.index));
    for (const index of [2, 3, 4, 5, 6]) {
        assert.ok(kept.has(index), `#${index} is a service they sell`);
        assert.equal(result.kept.find(item => item.index === index)?.profileService, true);
    }
    assert.equal(result.summary.seed_only_profile_services, 5);
    // Before, a 20% share of these was kept; now none is.
    assert.deepEqual(result.dropped.map(d => [d.index, d.reason]), [[7, 'no_demand'], [8, 'no_demand'], [9, 'no_demand'], [10, 'no_demand']]);
    assert.equal(result.summary.dropped_no_demand, 4);
    assert.equal(result.summary.demand_required, true);

    // Without a services list nothing is exempt.
    const plain = validatePageMix(ideas, clusters, ignore);
    assert.equal(plain.summary.seed_only_profile_services, 0);
    assert.equal(plain.kept.length < result.kept.length, true);
});

test('service names come from the site\'s own service pages, read the way PR 1 reads them', () => {
    const site = 'https://www.ecoworkz.net';
    const page = (path: string, title = '') => ({ normalizedUrl: `${site}${path}`, title, h1s: [] });
    const names = servicePageNames([
        page('/'),
        page('/our-services/'),
        page('/our-services/masonry-contractors/', 'Masonry Contractors in Corona | Ecoworkz'),
        page('/our-services/pet-turf/'),
        page('/corona-ca/', 'Corona Hardscape Contractor'),
        page('/pavers-vs-concrete-patio-southern-ca/'),
        page('/galleries/pavers-gallery/'),
    ], new Set(['ecoworkz']));
    assert.deepEqual(names, ['masonry contractors', 'pet turf']);
});

test('a service name needs most of its words', () => {
    assert.equal(namesService('Outdoor Kitchen & BBQ Island', [['outdoor', 'kitchen']]), true);
    assert.equal(namesService('Outdoor lighting', [['outdoor', 'kitchen']]), false);
    assert.equal(namesService('Masonry walls', [['masonry']]), true);
});

test('a repeated primary search keeps only the first idea', () => {
    const result = validatePageMix([
        money('artificial turf temecula'),
        // Same search reworded. "...installation" would be a different search (PR 1's intentKey).
        money('Temecula artificial grass near me', { pageType: 'service_city' }),
        money('pet turf'),
    ], clusters, ignore);
    assert.deepEqual(result.kept.map(item => item.index), [0, 2]);
    assert.deepEqual(result.dropped, [{ index: 1, reason: 'duplicate_query' }]);
    assert.equal(result.summary.dropped_duplicate_query, 1);
});

test('articles are trimmed to 30%, weakest first', () => {
    const ideas = [
        money('hardscape contractor'),
        money('artificial turf temecula', { pageType: 'service_city' }),
        money('pet turf', { pageType: 'sub_service' }),
        money('putting greens', { pageType: 'sub_service' }),
        money('playground turf', { pageType: 'sub_service' }),
        money('artificial grass orange county', { pageType: 'service_city' }),
        money('hardscape contractor riverside', { pageType: 'service_city', demandQuery: 'hardscape contractor' }),
        article('artificial turf cost', 'cost'),
        article('turf vs real grass', 'comparison'),
        article('does turf get hot'),
        article('how long does turf last'),
        article('turf rebates riverside county', 'local_resource'),
    ];
    const withArticles = [...clusters, cluster('does turf get hot', 40), cluster('how long does turf last', 30), cluster('turf rebates riverside county', 20)];
    const result = validatePageMix(ideas, withArticles, ignore);
    // 7 money pages allow 3 articles: the three with the most demand stay.
    assert.equal(result.summary.articles, 3);
    assert.deepEqual(result.kept.filter(item => ARTICLE_KINDS.has(item.kind)).map(item => item.index), [7, 8, 9]);
    assert.equal(result.summary.dropped_article_cap, 2);
    assert.ok(result.summary.articles / result.summary.kept <= 0.3);
    // The cost idea is stored as a guide and labelled in plain English.
    const cost = result.kept.find(item => item.index === 7);
    assert.equal(cost?.storedType, 'guide');
    assert.equal(cost?.label, 'Cost guide');
});

test('ideas with no Search Console search are dropped and cited demand uses measured numbers', () => {
    const ideas = [
        money('hardscape contractor'),
        money('pet turf', { pageType: 'sub_service', demandQuery: 'pet turf' }),
        money('putting greens', { pageType: 'sub_service', demandQuery: null }),
        money('playground turf', { pageType: 'sub_service', demandQuery: null, supportingQueries: ['playground turf'] }),
        money('artificial turf temecula', { pageType: 'service_city' }),
        money('commercial turf', { demandQuery: 'commercial turf' }),
        money('turf for schools', { demandQuery: null, buildPhase: 3 }),
        money('turf for hoa', { demandQuery: null, buildPhase: 2 }),
    ];
    const result = validatePageMix(ideas, clusters, ignore);
    // Ideas 2 and 3 are matched to Search Console from their own searches.
    assert.equal(result.kept.find(item => item.index === 2)?.seedOnly, false);
    assert.deepEqual(result.kept.find(item => item.index === 0)?.demand, { query: 'hardscape contractor', impressions: 4498 });
    // "commercial turf" cited a search Search Console does not have.
    assert.equal(result.summary.relabeled_seed_only, 1);
    // Before, a 20% share of seed-only ideas was kept; now none is.
    assert.equal(result.summary.seed_only, 0);
    assert.deepEqual(result.dropped, [{ index: 5, reason: 'no_demand' }, { index: 6, reason: 'no_demand' }, { index: 7, reason: 'no_demand' }]);
    assert.equal(result.summary.dropped_no_demand, 3);
});

test('the demand rule and the article cap hold together', () => {
    const ideas: MixInput[] = [
        money('hardscape contractor'),
        money('pet turf'),
        money('putting greens'),
        money('playground turf'),
        ...WORDS.slice(0, 6).map(word => money(`${word} service`, { demandQuery: null })),
        ...WORDS.slice(6, 12).map(word => article(`${word} question`)),
        article('artificial turf cost', 'cost'),
    ];
    const { summary } = validatePageMix(ideas, clusters, ignore);
    assert.ok(summary.articles / summary.kept <= 0.3, JSON.stringify(summary));
    assert.equal(summary.seed_only, 0, JSON.stringify(summary));
    assert.equal(summary.kept + summary.dropped_article_cap + summary.dropped_no_demand, ideas.length);
});

test('without Search Console data every idea is seed-only and is kept', () => {
    const result = validatePageMix([money('pet turf'), money('putting greens'), money('hardscape'), article('artificial turf cost', 'cost')], [], ignore);
    assert.equal(result.kept.length, 4);
    assert.equal(result.summary.seed_only, 4);
    assert.equal(result.summary.demand_required, false);
    assert.equal(result.summary.dropped_no_demand, 0);
});

test('a service page aimed at a search with no demand of its own takes the search its demand comes from', () => {
    // Ecoworkz #11: "hardscape contractors southern california" has no search group; it cited "hardscaping services".
    const result = validatePageMix([
        money('hardscape contractors southern california', { title: 'Hardscape Contractor in Southern California', demandQuery: 'hardscaping services', supportingQueries: ['hardscape company'] }),
        // Its own search has a group: unchanged.
        money('pet turf installation', { pageType: 'sub_service', demandQuery: 'pet turf' }),
        // A city page is never re-aimed (the page plan decides whether it stays).
        money('turf installation riverside', { pageType: 'service_city', demandQuery: 'artificial turf temecula' }),
    ], [...clusters, cluster('hardscaping services', 11968)], ignore);
    const [hardscape, pet, city] = result.kept;
    assert.equal(hardscape.targetQuery, 'hardscaping services');
    assert.deepEqual(hardscape.supportingQueries, ['hardscape contractors southern california', 'hardscape company']);
    assert.equal(pet.targetQuery, 'pet turf installation');
    assert.equal(city.targetQuery, 'turf installation riverside');
    assert.equal(result.summary.retargeted_to_demand, 1);

    // Not when another idea already has that search.
    const taken = validatePageMix([
        money('hardscaping services'),
        money('hardscape contractors southern california', { demandQuery: 'hardscaping services' }),
    ], [...clusters, cluster('hardscaping services', 11968)], ignore);
    assert.deepEqual(taken.kept.map(item => item.targetQuery), ['hardscaping services', 'hardscape contractors southern california']);
});

test('supporting searches are de-duplicated, exclude the primary search and stop at ten', () => {
    const supporting = ['pet turf', 'pet turfs', 'dog turf', 'Dog Turf ', 'artificial pet grass', ...WORDS.map(word => `pet turf ${word}`)];
    const [item] = validatePageMix([money('pet turf', { supportingQueries: supporting })], clusters, ignore).kept;
    assert.equal(item.supportingQueries.length, 10);
    assert.equal(item.supportingQueries[0], 'dog turf');
    assert.equal(item.supportingQueries.includes('artificial pet grass'), false, '"artificial pet grass" is the same search as "pet turf"');
});

test('an all-article map is not wiped out', () => {
    const result = validatePageMix([article('artificial turf cost', 'cost'), article('turf vs real grass', 'comparison')], clusters, ignore);
    assert.equal(result.kept.length, 2);
    assert.equal(result.summary.dropped_article_cap, 0);
});
