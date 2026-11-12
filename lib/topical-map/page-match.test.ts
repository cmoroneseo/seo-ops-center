import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    brandTokens,
    dedupeIdeas,
    GSC_MATCH_MAX_POSITION,
    intentKey,
    matchIdeaToPage,
    pageKey,
    significantTokens,
    urlPath,
} from './page-match.ts';

const site = 'https://www.ecoworkz.com';
const brand = brandTokens('Ecoworkz', 'ecoworkz.com');

const pages = [
    { pageId: 'corona', normalizedUrl: `${site}/corona-ca/`, title: 'Corona, CA | Ecoworkz', h1s: ['Artificial Grass Installation in Corona'] },
    { pageId: 'pavers', normalizedUrl: `${site}/pavers/`, title: 'Paver Installation | Ecoworkz', h1s: ['Pavers'] },
    { pageId: 'vs', normalizedUrl: `${site}/blog/pavers-vs-concrete/`, title: 'Pavers vs Concrete: Which Is Better?', h1s: ['Pavers vs Concrete'] },
    { pageId: 'home', normalizedUrl: `${site}/`, title: 'Ecoworkz | Artificial Grass, Pavers & Concrete in Orange County', h1s: ['Artificial Grass Installation'] },
    { pageId: 'grass', normalizedUrl: `${site}/artificial-grass/`, title: 'Artificial Grass Installation | Ecoworkz', h1s: ['Artificial Turf'] },
];

describe('significantTokens', () => {
    it('drops generic words, the brand and plurals, and folds turf into grass', () => {
        assert.deepEqual(significantTokens('Corona Artificial Turf Installation Services', brand), ['corona', 'artificial', 'grass']);
        assert.deepEqual(significantTokens('Ecoworkz pavers near me CA'), ['ecoworkz', 'paver']);
        assert.deepEqual(significantTokens('Ecoworkz pavers near me CA', brand), ['paver']);
        assert.deepEqual(significantTokens('Synthetic lawn for dogs'), ['artificial', 'grass', 'dog']);
    });

    it('keeps grass whole and keeps service words that change intent', () => {
        assert.deepEqual(significantTokens('putting greens'), ['putting', 'green']);
        assert.deepEqual(significantTokens('artificial grass cost'), ['artificial', 'grass', 'cost']);
    });
});

describe('intentKey', () => {
    it('gives the same key to reworded searches with the same intent', () => {
        assert.equal(intentKey('artificial turf corona'), intentKey('Corona artificial grass installation'));
        assert.notEqual(intentKey('pavers corona'), intentKey('concrete corona'));
    });
});

describe('urlPath and pageKey', () => {
    it('ignore trailing slashes, case and www', () => {
        assert.equal(urlPath('/Corona-CA/'), '/corona-ca');
        assert.equal(urlPath(`${site}/`), '/');
        assert.equal(pageKey(`${site}/corona-ca/`), pageKey('https://ecoworkz.com/corona-ca'));
    });
});

describe('matchIdeaToPage', () => {
    it("matches 'Corona artificial turf installation' to /corona-ca/", () => {
        const match = matchIdeaToPage(
            { targetQuery: 'artificial turf installation corona', title: 'Corona Artificial Turf Installation' },
            pages, [], brand,
        );
        assert.equal(match?.page?.pageId, 'corona');
        assert.equal(match?.via, 'tokens');
    });

    it('does not match a different city to a city page', () => {
        const match = matchIdeaToPage(
            { targetQuery: 'artificial grass temecula', title: 'Artificial Grass Installation in Temecula' },
            pages, [], brand,
        );
        assert.equal(match, null);
    });

    it('does not match a generic service idea to a city page', () => {
        const match = matchIdeaToPage({ targetQuery: 'artificial grass installation', title: 'Artificial Grass Installation' }, pages, [], brand);
        assert.equal(match?.page?.pageId, 'grass');
    });

    it('keeps pavers, concrete and the pavers-vs-concrete article apart', () => {
        const pavers = matchIdeaToPage({ targetQuery: 'paver installation', title: 'Paver Installation' }, pages, [], brand);
        assert.equal(pavers?.page?.pageId, 'pavers');
        const concrete = matchIdeaToPage({ targetQuery: 'concrete patio contractor', title: 'Concrete Patios' }, pages, [], brand);
        assert.equal(concrete, null);
        const versus = matchIdeaToPage({ targetQuery: 'pavers vs concrete', title: 'Pavers or Concrete: Which to Choose' }, pages, [], brand);
        assert.equal(versus?.page?.pageId, 'vs');
        const coronaPavers = matchIdeaToPage({ targetQuery: 'pavers corona', title: 'Paver Installation in Corona' }, pages, [], brand);
        assert.notEqual(coronaPavers?.page?.pageId, 'corona');
        assert.notEqual(coronaPavers?.page?.pageId, 'vs');
    });

    it('a sub-service on a city page is a new page, not a duplicate', () => {
        const match = matchIdeaToPage({ targetQuery: 'pet turf corona', title: 'Pet Turf in Corona' }, pages, [], brand);
        assert.equal(match, null);
    });

    it('never matches the home page by words alone', () => {
        const match = matchIdeaToPage(
            { targetQuery: 'artificial grass pavers concrete orange county', title: 'Orange County Landscaping' },
            pages.filter(page => page.pageId === 'home'), [], brand,
        );
        assert.equal(match, null);
    });

    it('matches the URL the generator suggested, relative or absolute', () => {
        const match = matchIdeaToPage({ targetQuery: 'x', title: 'Y', suggestedUrl: '/Corona-CA' }, pages, [], brand);
        assert.equal(match?.page?.pageId, 'corona');
        assert.equal(match?.via, 'url');
    });

    it('matches the page Google already shows for the target search, by intent', () => {
        const match = matchIdeaToPage(
            { targetQuery: 'synthetic turf corona ca', title: 'Something Else Entirely' },
            pages,
            [{ query: 'artificial grass corona', pageUrl: 'https://ecoworkz.com/corona-ca', position: 14, impressions: 300 }],
            brand,
        );
        assert.equal(match?.page?.pageId, 'corona');
        assert.equal(match?.via, 'gsc');
    });

    it('ignores a Search Console page past spot 20 or the home page', () => {
        const far = matchIdeaToPage(
            { targetQuery: 'hardscape contractor', title: 'Hardscape Contractor' },
            pages,
            [
                { query: 'hardscape contractor', pageUrl: `${site}/pavers/`, position: GSC_MATCH_MAX_POSITION + 32, impressions: 4498 },
                { query: 'hardscape contractor', pageUrl: `${site}/`, position: 5, impressions: 100 },
            ],
            brand,
        );
        assert.equal(far, null);
    });

    it('keeps a Search Console page that was never crawled as the matched URL', () => {
        const match = matchIdeaToPage(
            { targetQuery: 'putting greens', title: 'Putting Greens' },
            pages,
            [{ query: 'putting green', pageUrl: `${site}/putting-greens/`, position: 9, impressions: 466 }],
            brand,
        );
        assert.equal(match?.page, undefined);
        assert.equal(match?.url, `${site}/putting-greens/`);
    });

    it('uses supporting searches last', () => {
        const match = matchIdeaToPage(
            { targetQuery: 'backyard makeover ideas', title: 'Backyard Makeover Ideas', supportingQueries: ['pavers vs concrete'] },
            pages,
            [{ query: 'pavers vs concrete', pageUrl: `${site}/blog/pavers-vs-concrete/`, position: 6, impressions: 120 }],
            brand,
        );
        assert.equal(match?.page?.pageId, 'vs');
    });
});

describe('dedupeIdeas', () => {
    it('keeps the first idea per search intent and per matched page', () => {
        const result = dedupeIdeas([
            { targetQuery: 'artificial grass corona', matchedUrl: `${site}/corona-ca/` },
            { targetQuery: 'Corona artificial turf' },
            { targetQuery: 'pavers corona' },
            { targetQuery: 'concrete corona' },
            { targetQuery: 'synthetic grass corona ca installation', matchedUrl: null },
            { targetQuery: 'corona yard', matchedUrl: 'https://ecoworkz.com/corona-ca' },
        ], brand);
        assert.deepEqual(result.keep, [0, 2, 3]);
        assert.deepEqual([...result.duplicateOf], [[1, 0], [4, 0], [5, 0]]);
    });
});
