import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    brandTokens,
    dedupeIdeas,
    GSC_MATCH_MAX_POSITION,
    GSC_MATCH_MIN_IMPRESSIONS,
    ideaKind,
    intentKey,
    isBrandSearch,
    isUtilityPage,
    learnPlaces,
    matchIdeaToPage,
    pageKey,
    placesInText,
    readText,
    significantTokens,
    urlPath,
    type MatchablePage,
} from './page-match.ts';

const brand = brandTokens('Acme', 'acme.com');

/** A generic home-services site: services under /services/, articles at the root. */
const site = 'https://www.acme.com';
const page = (path: string, title: string, h1 = title): MatchablePage & { pageId: string } =>
    ({ pageId: path, normalizedUrl: `${site}${path}`, title, h1s: [h1] });
const pages = [
    page('/', 'Acme | Artificial Grass, Pavers & Concrete in Orange County', 'Artificial Grass Installation'),
    page('/services/artificial-grass/', 'Artificial Grass Installation | Acme'),
    page('/services/pavers/', 'Paver Installation | Acme', 'Pavers'),
    page('/services/pavers/driveway-pavers/', 'Driveway Pavers | Acme'),
    page('/services/pet-turf/', 'Pet Turf Installation | Acme', 'Pet-Safe Artificial Turf'),
    page('/corona-ca/', 'Corona Hardscape Contractor | Pavers & Turf | Acme', 'Corona Hardscape Contractor'),
    page('/areas/riverside-county/', 'Riverside County Outdoor Living Contractor | Acme'),
    page('/riverside-ca/', 'Riverside Hardscape Contractor | Acme'),
    page('/pavers-vs-concrete-patio/', 'Pavers vs. Concrete Patio: Which Is Better?'),
    page('/artificial-grass-backyard-worth-it/', 'Artificial Grass for Your Backyard: Is It Worth It?'),
    page('/commercial-turf-guide/', 'Commercial Turf: A Property Manager’s Guide'),
    page('/about-us/faqs/', 'Landscape & Artificial Grass FAQs', 'Got Questions?'),
    page('/galleries/pavers-gallery/', 'Paver Gallery | Acme'),
];
const idea = (targetQuery: string, title: string, pageType?: string) => ({ targetQuery, title, pageType });
const matched = (result: ReturnType<typeof matchIdeaToPage>) => (result ? urlPath(result.url) : null);

describe('significantTokens', () => {
    it('folds plurals and -ing/-e endings, reads turf as artificial grass and drops generic words and the brand', () => {
        assert.deepEqual(significantTokens('Corona Artificial Turf Installation Services', brand), ['corona', 'artificial', 'grass']);
        assert.deepEqual(significantTokens('Acme pavers near me CA', brand), ['paver']);
        assert.deepEqual(significantTokens('landscaping'), significantTokens('landscape'));
        assert.deepEqual(significantTokens('Synthetic lawn for dogs'), ['artificial', 'grass', 'dog']);
    });
});

describe('intentKey (finding 2: installation is not collapsed)', () => {
    it('keeps service words, so a service search and a topic search stay different', () => {
        assert.notEqual(intentKey('artificial grass installation southern california'), intentKey('artificial turf southern california'));
        assert.notEqual(intentKey('hardscaping services'), intentKey('hardscaping'));
    });

    it('still reads reworded searches as one: turf/grass, word order, near me, ca, brand', () => {
        assert.equal(intentKey('artificial turf installation corona ca', brand), intentKey('Acme corona artificial grass installation near me', brand));
    });
});

describe('isUtilityPage (finding 2 and 3)', () => {
    it('treats galleries, portfolio, contact, booking, category and date archives as utility pages', () => {
        for (const path of ['/galleries/', '/galleries/pavers-gallery/', '/gallery/', '/portfolio/x/', '/contact-us/', '/book/?rwg_token=abc',
            '/book-now/', '/category/pavers/', '/2023/05/old-post/', '/testimonials-reviews/', '/thank-you/', '/financing/']) {
            assert.equal(isUtilityPage(`${site}${path}`), true, path);
        }
    });

    it('treats any query-string URL as a utility URL', () => {
        assert.equal(isUtilityPage(`${site}/services/pavers/?ref=gbp`), true);
    });

    it('keeps real pages that merely start with a similar word', () => {
        for (const path of ['/financing-outdoor-renovations/', '/services/pavers/', '/corona-ca/', '/faqs/']) {
            assert.equal(isUtilityPage(`${site}${path}`), false, path);
        }
    });
});

describe('places', () => {
    it('learns cities and counties from the site’s own URLs and titles', () => {
        const places = learnPlaces([
            page('/corona-ca/', 'Corona'),
            page('/areas/orange-county-ca/', 'Outdoor Construction in Orange County, CA'),
            page('/areas/riverside-county/', 'Riverside County'),
            page('/yorba-linda-ca/', 'Yorba Linda'),
            page('/paver-stone-installation-guide-corona-ca/', 'Paver Stone Guide'),
            page('/areas/san-bernardino/', 'Artificial Grass in San Bernardino County'),
        ]);
        assert.deepEqual([...places].sort(), ['corona', 'orange county', 'riverside county', 'san bernardino county', 'yorba linda']);
    });

    it('reads "X County" and "X, CA" in text', () => {
        assert.deepEqual(placesInText('Serving San Bernardino Counties and Temecula, CA'), ['san bernardino county', 'temecula']);
    });
});

describe('ideaKind', () => {
    it('reads the page type, else the wording', () => {
        assert.equal(ideaKind(idea('pavers', 'Pavers', 'service')), 'money');
        assert.equal(ideaKind(idea('pavers', 'Pavers', 'blog_post')), 'article');
        assert.equal(ideaKind(idea('turf faq', 'Turf FAQ')), 'faq');
        assert.equal(ideaKind(idea('how much does turf cost', 'How Much Does Turf Cost?')), 'article');
        assert.equal(ideaKind(idea('pavers vs concrete', 'Pavers or Concrete')), 'article');
        assert.equal(ideaKind(idea('paver installation', 'Paver Installation')), 'money');
    });
});

describe('matchIdeaToPage: page type and intent must agree (finding 1)', () => {
    it('a cost guide, a worth-it article and an FAQ never match the service page', () => {
        assert.equal(matched(matchIdeaToPage(idea('how much does artificial grass cost', 'How Much Does Artificial Grass Cost?', 'guide'), pages, [], brand)), null);
        assert.equal(matched(matchIdeaToPage(idea('is artificial grass worth it', 'Is Artificial Grass Worth It?', 'blog_post'), pages, [], brand)), '/artificial-grass-backyard-worth-it');
        assert.equal(matched(matchIdeaToPage(idea('artificial grass maintenance', 'Artificial Grass FAQ', 'faq'), pages, [], brand)), '/about-us/faqs');
    });

    it('a service idea matches the service page, not an article about it', () => {
        assert.equal(matched(matchIdeaToPage(idea('artificial grass installation', 'Artificial Grass Installation', 'service'), pages, [], brand)), '/services/artificial-grass');
    });

    it('commercial and residential are different', () => {
        assert.equal(matched(matchIdeaToPage(idea('commercial artificial turf installation', 'Commercial Artificial Turf', 'service'), pages, [], brand)), null);
        assert.equal(matched(matchIdeaToPage(idea('commercial turf guide', 'Commercial Turf: What Property Managers Should Know', 'guide'), pages, [], brand)), '/commercial-turf-guide');
    });

    it('pet, cost and "vs" are modifiers too', () => {
        assert.equal(matched(matchIdeaToPage(idea('pet turf installation', 'Pet Turf', 'service'), pages, [], brand)), '/services/pet-turf');
        assert.equal(matched(matchIdeaToPage(idea('pet turf corona', 'Pet Turf in Corona', 'service'), pages, [], brand)), null);
        assert.equal(matched(matchIdeaToPage(idea('pavers vs concrete patio', 'Pavers vs Concrete', 'blog_post'), pages, [], brand)), '/pavers-vs-concrete-patio');
        assert.equal(matched(matchIdeaToPage(idea('concrete patio ideas', 'Concrete Patio Ideas', 'blog_post'), pages, [], brand)), null);
    });

    it('putting greens and playgrounds are modifiers too', () => {
        assert.deepEqual([...readText('backyard putting greens', new Set(), brand).flags], ['putting_green']);
        assert.deepEqual([...readText('golf turf', new Set(), brand).flags], ['putting_green']);
        assert.deepEqual([...readText('playground grass orange county', new Set(['orange county']), brand).flags], ['playground']);
        assert.deepEqual([...readText('artificial turf orange county', new Set(['orange county']), brand).flags], []);
    });

    it('city and county must match when the idea names one', () => {
        assert.equal(matched(matchIdeaToPage(idea('artificial turf installation corona ca', 'Corona Artificial Turf Installation', 'service'), pages, [], brand)), '/corona-ca');
        assert.equal(matched(matchIdeaToPage(idea('landscape contractors in corona', 'Landscape Contractors in Corona', 'service'), pages, [], brand)), '/corona-ca');
        assert.equal(matched(matchIdeaToPage(idea('artificial grass temecula', 'Artificial Grass in Temecula, CA', 'service'), pages, [], brand)), null);
        assert.equal(matched(matchIdeaToPage(idea('backyard remodel riverside county', 'Backyard Remodel in Riverside County', 'service'), pages, [], brand)), '/areas/riverside-county');
        assert.equal(matched(matchIdeaToPage(idea('artificial grass orange county', 'Artificial Grass in Orange County', 'service'), pages, [], brand)), null);
    });

    it('a city page needs the specific service on it; all-round work is enough', () => {
        assert.equal(matched(matchIdeaToPage(idea('fire pit installation corona', 'Fire Pits in Corona', 'service'), pages, [], brand)), null);
        assert.equal(matched(matchIdeaToPage(idea('corona backyard remodel', 'Corona Backyard Remodel', 'landing'), pages, [], brand)), '/corona-ca');
    });

    it('an idea with no city never matches a city page', () => {
        assert.equal(matched(matchIdeaToPage(idea('hardscape contractor', 'Hardscape Contractor', 'service'), pages, [], brand)), null);
    });

    it('prefers the most specific path, not the shortest', () => {
        assert.equal(matched(matchIdeaToPage(idea('driveway pavers', 'Driveway Pavers', 'service'), pages, [], brand)), '/services/pavers/driveway-pavers');
        assert.equal(matched(matchIdeaToPage(idea('paver installation', 'Paver Installation', 'service'), pages, [], brand)), '/services/pavers');
    });

    it('never matches the home page or a utility page by words', () => {
        assert.equal(matched(matchIdeaToPage(idea('paver gallery', 'Paver Gallery', 'service'), pages, [], brand)), null);
        assert.equal(
            matched(matchIdeaToPage(idea('artificial grass pavers concrete orange county', 'Orange County Landscaping', 'pillar'), [pages[0]], [], brand)),
            null,
        );
    });

    it('matches the URL the generator suggested, relative or absolute', () => {
        const result = matchIdeaToPage(idea('x', 'Y'), pages, [], brand);
        assert.equal(result, null);
        const byUrl = matchIdeaToPage({ ...idea('x', 'Y'), suggestedUrl: '/Corona-CA' }, pages, [], brand);
        assert.equal(byUrl?.page?.pageId, '/corona-ca/');
        assert.equal(byUrl?.via, 'url');
    });
});

describe('matchIdeaToPage: Search Console pages (finding 2)', () => {
    const hit = (query: string, path: string, impressions = 300, position = 9, host = site) =>
        ({ query, pageUrl: `${host}${path}`, impressions, position });

    it('matches the page Google already shows for the same search', () => {
        const result = matchIdeaToPage(idea('synthetic turf corona ca', 'Something Else', 'service'), pages, [hit('artificial grass corona', '/corona-ca/')], brand);
        assert.equal(result?.via, 'gsc');
        assert.equal(matched(result), '/corona-ca');
    });

    it('needs the same search: installation is not dropped', () => {
        const result = matchIdeaToPage(idea('artificial grass installation', 'Artificial Grass Installation', 'service'), pages,
            [hit('artificial grass', '/artificial-grass-backyard-worth-it/')], brand);
        assert.equal(result?.via, 'tokens');
        assert.equal(matched(result), '/services/artificial-grass');
    });

    it('ignores pages under the impression floor or past spot 20', () => {
        const ideaX = idea('putting greens', 'Putting Greens', 'service');
        assert.equal(matchIdeaToPage(ideaX, pages, [hit('putting green', '/services/putting-greens/', GSC_MATCH_MIN_IMPRESSIONS - 1)], brand), null);
        assert.equal(matchIdeaToPage(ideaX, pages, [hit('putting green', '/services/putting-greens/', 500, GSC_MATCH_MAX_POSITION + 1)], brand), null);
        assert.equal(matchIdeaToPage(ideaX, pages, [hit('putting green', '/services/putting-greens/', GSC_MATCH_MIN_IMPRESSIONS)], brand)?.url, `${site}/services/putting-greens/`);
    });

    it('never attaches a URL off the site’s own host (staging)', () => {
        const result = matchIdeaToPage(idea('paver installation orange county', 'Pavers in Orange County', 'service'), pages,
            [hit('paver installation orange county', '/areas/orange-county/', 900, 5, 'https://staging.acme.com')], brand);
        assert.equal(result, null);
    });

    it('never attaches a query-string, booking or home URL', () => {
        const ideaX = idea('landscaping contractor near me', 'Landscaping Contractor', 'service');
        assert.equal(matchIdeaToPage(ideaX, pages, [hit('landscaping contractor', '/book/?rwg_token=abc', 900, 1)], brand), null);
        assert.equal(matchIdeaToPage(ideaX, pages, [hit('landscaping contractor', '/', 900, 1)], brand), null);
    });

    it('skips a ranking page of the wrong kind and takes the next one', () => {
        const result = matchIdeaToPage(idea('artificial grass installation', 'Artificial Grass Installation', 'service'), pages, [
            hit('artificial grass installation', '/artificial-grass-backyard-worth-it/', 900, 4),
            hit('artificial grass installation', '/services/artificial-grass/', 100, 12),
        ], brand);
        assert.equal(result?.via, 'gsc');
        assert.equal(matched(result), '/services/artificial-grass');
    });

    it('a city idea does not attach to a page with no city, even if it ranks', () => {
        const result = matchIdeaToPage(idea('artificial grass installation orange county', 'Artificial Grass in Orange County', 'service'), pages,
            [hit('artificial grass installation orange county', '/services/artificial-grass/', 400, 19)], brand);
        assert.equal(result, null);
    });

    it('uses supporting searches last', () => {
        const result = matchIdeaToPage(
            { ...idea('backyard makeover ideas', 'Backyard Makeover Ideas', 'blog_post'), supportingQueries: ['pavers vs concrete'] },
            pages, [hit('pavers vs concrete', '/pavers-vs-concrete-patio/')], brand,
        );
        assert.equal(result, null, 'a comparison page is not a match for an idea that is not a comparison');
        const ok = matchIdeaToPage(
            { ...idea('backyard makeover ideas', 'Backyard Makeover Ideas', 'blog_post'), supportingQueries: ['is turf worth it'] },
            pages, [hit('is turf worth it', '/artificial-grass-backyard-worth-it/')], brand,
        );
        assert.equal(matched(ok), '/artificial-grass-backyard-worth-it');
    });
});

describe('urlPath and pageKey', () => {
    it('ignore trailing slashes, case and www', () => {
        assert.equal(urlPath('/Corona-CA/'), '/corona-ca');
        assert.equal(urlPath(`${site}/`), '/');
        assert.equal(pageKey(`${site}/corona-ca/`), pageKey('https://acme.com/corona-ca'));
    });
});

describe('dedupeIdeas (finding 1: same-page dedupe only within a page type)', () => {
    const corona = `${site}/corona-ca/`;

    it('drops a later idea with the same search', () => {
        const result = dedupeIdeas([
            { targetQuery: 'artificial grass corona ca', pageType: 'service' },
            { targetQuery: 'Corona artificial turf near me', pageType: 'blog_post' },
        ], brand);
        assert.deepEqual([...result.duplicateOf], [[1, 0]]);
    });

    it('keeps ideas of a different page type that point at the same page', () => {
        const result = dedupeIdeas([
            { targetQuery: 'artificial grass installation', matchedUrl: `${site}/services/artificial-grass/`, pageType: 'service' },
            { targetQuery: 'artificial grass installation cost', matchedUrl: `${site}/services/artificial-grass/`, pageType: 'guide' },
            { targetQuery: 'artificial grass installation process', matchedUrl: `${site}/services/artificial-grass/`, pageType: 'pillar' },
        ], brand);
        assert.equal(result.duplicateOf.size, 0);
    });

    it('keeps two different articles that point at one post', () => {
        const result = dedupeIdeas([
            { targetQuery: 'fire pit design ideas', matchedUrl: `${site}/fire-pit-design/`, pageType: 'blog_post' },
            { targetQuery: 'fire pit for covered patio', matchedUrl: `${site}/fire-pit-design/`, pageType: 'blog_post' },
        ], brand);
        assert.equal(result.duplicateOf.size, 0);
    });

    it('drops a same-type idea on the same page when most of its words overlap', () => {
        const result = dedupeIdeas([
            { targetQuery: 'backyard remodel orange county', matchedUrl: `${site}/orange-county-ca/`, pageType: 'service' },
            { targetQuery: 'outdoor remodeling orange county', matchedUrl: `${site}/orange-county-ca`, pageType: 'service' },
            { targetQuery: 'turf installation corona', matchedUrl: corona, pageType: 'service' },
            { targetQuery: 'landscape contractors corona', matchedUrl: corona, pageType: 'service' },
        ], brand);
        assert.deepEqual([...result.duplicateOf], [[1, 0]]);
        assert.deepEqual(result.keep, [0, 2, 3]);
    });
});

describe('isBrandSearch', () => {
    it('is a search with every word of the brand name or of the domain name', () => {
        assert.equal(isBrandSearch('acme', 'Acme'), true);
        assert.equal(isBrandSearch('acme turf reviews', 'Acme'), true);
        assert.equal(isBrandSearch('ecoworkz', 'Ecoworkz Inc', 'https://www.ecoworkz.net/'), true);
        assert.equal(isBrandSearch('artificial turf', 'Acme', 'acme.com'), false);
        // A brand made of trade words is only matched in full.
        assert.equal(isBrandSearch('landscaping near me', 'Pacific Landscaping'), false);
        assert.equal(isBrandSearch('anything', '', null), false);
    });
});
