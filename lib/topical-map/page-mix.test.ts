import test from 'node:test';
import assert from 'node:assert/strict';

import type { ArchitectGscCluster } from './architect-gsc.ts';
import { clusterKey } from './architect-gsc.ts';
import {
    ARTICLE_KINDS,
    maxWithinShare,
    PAGE_KIND_LABEL,
    PAGE_KINDS,
    pageKindOf,
    STORED_PAGE_TYPE,
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
    assert.equal(STORED_PAGE_TYPE.faq, 'faq');
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

test('share caps', () => {
    assert.equal(maxWithinShare(7, 0.3), 3);
    assert.equal(maxWithinShare(14, 0.3), 6);
    assert.equal(maxWithinShare(10, 0.3), 4);
    assert.equal(maxWithinShare(12, 0.2), 3);
    assert.equal(maxWithinShare(3, 0.2), 0);
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
        money('turf', { demandQuery: null }),
        article('artificial turf cost', 'cost'),
        article('turf vs real grass', 'comparison'),
        article('does turf get hot'),
        article('how long does turf last'),
        article('turf rebates riverside county', 'local_resource'),
    ];
    const result = validatePageMix(ideas, clusters, ignore);
    // 7 money pages allow 3 articles. The two with measured demand stay.
    assert.equal(result.summary.articles, 3);
    assert.deepEqual(result.kept.filter(item => ARTICLE_KINDS.has(item.kind)).map(item => item.index).slice(0, 2), [7, 8]);
    assert.equal(result.summary.dropped_article_cap, 2);
    assert.ok(result.summary.articles / result.summary.kept <= 0.3);
    // The cost idea is stored as a guide and labelled in plain English.
    const cost = result.kept.find(item => item.index === 7);
    assert.equal(cost?.storedType, 'guide');
    assert.equal(cost?.label, 'Cost guide');
});

test('seed-only ideas are trimmed to 20% and cited demand uses measured numbers', () => {
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
    // 5 cited ideas allow 1 seed-only idea: the earliest build phase stays.
    assert.equal(result.summary.seed_only, 1);
    assert.deepEqual(result.kept.filter(item => item.seedOnly).map(item => item.index), [5]);
    assert.equal(result.summary.dropped_seed_only_cap, 2);
    assert.ok(result.summary.seed_only / result.summary.kept <= 0.2);
});

test('both caps hold together after trimming', () => {
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
    assert.ok(summary.seed_only / summary.kept <= 0.2, JSON.stringify(summary));
    assert.equal(summary.kept + summary.dropped_article_cap + summary.dropped_seed_only_cap, ideas.length);
});

test('without Search Console data every idea is seed-only and is kept', () => {
    const result = validatePageMix([money('pet turf'), money('putting greens'), money('hardscape'), article('artificial turf cost', 'cost')], [], ignore);
    assert.equal(result.kept.length, 4);
    assert.equal(result.summary.seed_only, 4);
    assert.equal(result.summary.seed_only_cap_applied, false);
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
