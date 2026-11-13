import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    determineAction,
    duplicateGateSummary,
    pageRefreshRead,
    readRefreshReasons,
    reconcileRecord,
    type ReconcileContext,
} from './reconcile.ts';
import { queriesByPage, refreshCandidates } from './page-performance.ts';
import { siteSearchFilter } from './page-match.ts';

describe('reconcileRecord', () => {
    const basePage = {
        pageId: 'page-1',
        normalizedUrl: '/artificial-grass-installation',
        title: 'Artificial Grass Installation in San Diego',
        h1s: ['Artificial Grass Installation'],
        wordCount: 1200,
    };

    it('returns create when no match found', () => {
        const result = reconcileRecord(
            { targetQuery: 'pool remodeling cost', title: 'Pool Remodeling Cost Guide' },
            [],
            [],
        );
        assert.equal(result.action, 'create');
        assert.equal(result.sitePageId, undefined);
    });

    it('matches by exact normalized URL', () => {
        const result = reconcileRecord(
            { targetQuery: 'artificial grass', title: 'Artificial Grass', suggestedUrl: '/artificial-grass-installation' },
            [basePage],
            [],
        );
        assert.equal(result.sitePageId, 'page-1');
        assert.equal(result.matchedUrl, '/artificial-grass-installation');
    });

    it('matches by GSC query overlap', () => {
        const result = reconcileRecord(
            { targetQuery: 'artificial grass installation san diego', title: 'AG Install' },
            [basePage],
            [{ query: 'artificial grass installation san diego', pageUrl: '/artificial-grass-installation' }],
        );
        assert.equal(result.sitePageId, 'page-1');
    });

    it('matches by title substring', () => {
        const result = reconcileRecord(
            { targetQuery: 'grass install', title: 'Artificial Grass Installation' },
            [basePage],
            [],
        );
        assert.equal(result.sitePageId, 'page-1');
    });
});

describe('reconcileRecord with Search Console performance (Ecoworkz-like)', () => {
    const site = 'https://www.ecoworkz.com';
    const corona = {
        pageId: 'corona',
        normalizedUrl: `${site}/corona-ca/`,
        title: 'Corona, CA | Ecoworkz',
        h1s: ['Artificial Grass Installation in Corona'],
        wordCount: 1400,
    };
    const ignoreTokens = new Set(['ecoworkz']);
    const idea = { targetQuery: 'artificial turf installation corona', title: 'Corona Artificial Turf Installation', pageType: 'city' };
    const ctx = (position: number, impressions: number, perf?: { recent: [number, number]; prior: [number, number] }): ReconcileContext => ({
        ignoreTokens,
        gscConnected: true,
        queryDays: 28,
        pageQueries: queriesByPage([{ query: 'artificial grass corona', page: 'https://ecoworkz.com/corona-ca', clicks: 2, impressions, position }]),
        performance: perf
            ? {
                recentDays: 90,
                priorDays: 90,
                pages: new Map([['ecoworkz.com/corona-ca', {
                    url: corona.normalizedUrl,
                    recent: { clicks: perf.recent[0], impressions: perf.recent[1], position },
                    prior: { clicks: perf.prior[0], impressions: perf.prior[1], position },
                }]]),
            }
            : { recentDays: 90, priorDays: 90, pages: new Map() },
    });

    it('a matched page over 300 words on page 2 is Improve, not Already live', () => {
        const result = reconcileRecord(idea, [corona], [], ctx(14, 20));
        assert.equal(result.action, 'improve');
        assert.equal(result.matchedUrl, corona.normalizedUrl);
        assert.equal(result.refresh?.reason, 'Ranks around spot 14 in Google for “artificial grass corona”, below page 1');
    });

    it('a matched page in striking distance that is losing searches is a Refresh with both reasons', () => {
        const result = reconcileRecord(idea, [corona], [], ctx(14, 300, { recent: [30, 580], prior: [30, 1000] }));
        assert.equal(result.action, 'improve');
        assert.deepEqual(result.refresh?.signals, ['striking_distance', 'decline']);
        assert.equal(
            result.refresh?.reason,
            'Ranks around spot 14 in Google for “artificial grass corona”; showing up in 42% fewer searches vs the previous 3 months',
        );
    });

    it('a matched page on page 1 with no signals is Already live', () => {
        const result = reconcileRecord(idea, [corona], [], ctx(3, 300, { recent: [60, 600], prior: [60, 600] }));
        assert.equal(result.action, 'keep');
        assert.equal(result.refresh, undefined);
    });

    it('a short service page is Improve even on page 1', () => {
        const result = reconcileRecord(idea, [{ ...corona, wordCount: 450 }], [], ctx(3, 300));
        assert.equal(result.action, 'improve');
        assert.equal(result.refresh?.reason, 'Only 450 words, short for a service page');
    });

    it('without Search Console the content check decides, as before', () => {
        assert.equal(reconcileRecord(idea, [corona], []).action, 'keep');
        assert.equal(reconcileRecord(idea, [{ ...corona, wordCount: 200 }], []).action, 'replace');
    });

    it('without Search Console a thin service page is Improve, with only the crawl as the reason', () => {
        const result = reconcileRecord(idea, [{ ...corona, wordCount: 450 }], [], { ignoreTokens, gscConnected: false });
        assert.equal(result.action, 'improve');
        assert.deepEqual(result.refresh, { reason: 'Only 450 words, short for a service page', signals: ['thin'] });
    });

    it('pavers and concrete ideas in the same city stay new pages', () => {
        assert.equal(reconcileRecord({ targetQuery: 'pavers corona', title: 'Pavers in Corona' }, [corona], [], ctx(3, 300)).action, 'create');
        assert.equal(reconcileRecord({ targetQuery: 'concrete corona', title: 'Concrete in Corona' }, [corona], [], ctx(3, 300)).action, 'create');
    });
});

describe('refresh reasons skip brand, out-of-area and side-service searches (Ecoworkz-like)', () => {
    const site = 'https://www.ecoworkz.net';
    const crawl = [
        { pageId: 'areas', normalizedUrl: `${site}/areas-serviced-southern-california/`, title: 'Service Areas', h1s: [], wordCount: 900 },
        { pageId: 'yl', normalizedUrl: `${site}/yorba-linda-ca/`, title: 'Yorba Linda Hardscape Contractor | Pavers, Patios', h1s: [], wordCount: 900 },
        { pageId: 'kitchen', normalizedUrl: `${site}/our-services/outdoor-kitchen-installation/`, title: 'Outdoor Kitchen Installation in Southern CA', h1s: [], wordCount: 900 },
    ];
    const row = (path: string, query: string, impressions: number, position: number) => ({ query, page: `${site}${path}`, clicks: 0, impressions, position });
    const ctx = (rows: ReturnType<typeof row>[], decline = false): ReconcileContext => ({
        ignoreTokens: new Set(['ecoworkz']),
        gscConnected: true,
        queryDays: 28,
        pageQueries: queriesByPage(rows),
        performance: {
            recentDays: 90,
            priorDays: 90,
            pages: new Map(decline
                ? [['ecoworkz.net/areas-serviced-southern-california', {
                    url: crawl[0].normalizedUrl,
                    recent: { clicks: 5, impressions: 370, position: 6 },
                    prior: { clicks: 5, impressions: 1000, position: 6 },
                }]]
                : []),
        },
        searchFits: siteSearchFilter(crawl, { brands: ['Ecoworkz', `${site}/`] }),
    });

    it('names the best remaining search, not the brand or a cleaning search', () => {
        const yorba = ctx([row('/yorba-linda-ca/', 'paver cleaning yorba linda ca', 80, 14), row('/yorba-linda-ca/', 'hardscaping services yorba linda', 60, 12)]);
        assert.equal(pageRefreshRead(crawl[1].normalizedUrl, { wordCount: 900 }, yorba).numbers.query, 'hardscaping services yorba linda');
        const kitchen = ctx([
            row('/our-services/outdoor-kitchen-installation/', 'outdoor kitchen installation san luis obispo ca', 80, 26),
            row('/our-services/outdoor-kitchen-installation/', 'outdoor kitchen installation near me', 60, 18),
        ]);
        const result = reconcileRecord(
            { targetQuery: 'outdoor kitchen installation southern california', title: 'Outdoor Kitchen Installation', pageType: 'service' },
            crawl, [], kitchen,
        );
        assert.equal(result.action, 'improve');
        assert.equal(result.refresh?.reason, 'Ranks around spot 18 in Google for “outdoor kitchen installation near me”');
        // Without the filter: the out-of-area search is named.
        const unfiltered = { ...kitchen, searchFits: undefined };
        assert.match(reconcileRecord(
            { targetQuery: 'outdoor kitchen installation southern california', title: 'Outdoor Kitchen Installation', pageType: 'service' },
            crawl, [], unfiltered,
        ).refresh?.reason ?? '', /san luis obispo/);
    });

    it('with only a brand search left, the page’s own numbers speak and no search is named; no other signal, no row', () => {
        const brandOnly = [row('/areas-serviced-southern-california/', 'ecoworkz', 340, 1.5)];
        const read = pageRefreshRead(crawl[0].normalizedUrl, { wordCount: 900 }, ctx(brandOnly, true));
        assert.equal(read.numbers.query, null);
        assert.deepEqual(read.signals, ['decline']);
        const [added] = refreshCandidates([{ url: crawl[0].normalizedUrl, read }], new Set());
        assert.equal(added.reason, 'Showing up in 63% fewer searches vs the previous 3 months');
        assert.equal(added.read.numbers.query, null);

        const quiet = pageRefreshRead(crawl[0].normalizedUrl, { wordCount: 900 }, ctx(brandOnly));
        assert.deepEqual(refreshCandidates([{ url: crawl[0].normalizedUrl, read: quiet }], new Set()), []);
    });

    it('#37: a neighbourhood search at spot 81 is never named; the page’s own decline is the reason', () => {
        const rows = [
            row('/areas-serviced-southern-california/', 'ecoworkz', 34, 1.5),
            row('/areas-serviced-southern-california/', 'mulching & rock services in canyon lake, ca', 11, 76),
            row('/areas-serviced-southern-california/', 'hardscaping contractors rossmoor', 1, 81),
        ];
        const read = pageRefreshRead(crawl[0].normalizedUrl, { wordCount: 900 }, ctx(rows, true));
        assert.equal(read.numbers.query, null);
        assert.equal(refreshCandidates([{ url: crawl[0].normalizedUrl, read }], new Set())[0].reason, 'Showing up in 63% fewer searches vs the previous 3 months');
    });

    it('#23: a town that only appears in the search (Friendswood) is never named', () => {
        const rows = [
            row('/our-services/outdoor-kitchen-installation/', 'outdoor kitchen installation san luis obispo ca', 8, 26),
            row('/our-services/outdoor-kitchen-installation/', 'install outdoor kitchen friendswood', 8, 25),
        ];
        const result = reconcileRecord(
            { targetQuery: 'outdoor kitchen installation southern california', title: 'Outdoor Kitchen Installation', pageType: 'service' },
            crawl, [], { ...ctx(rows), queryDays: 7 },
        );
        assert.equal(result.action, 'improve');
        assert.doesNotMatch(result.refresh?.reason ?? '', /friendswood|san luis obispo/);
    });

    it('a named search needs real demand and a real ranking, not just a fit', () => {
        const page = '/yorba-linda-ca/';
        const pick = (rows: ReturnType<typeof row>[]) => pageRefreshRead(crawl[1].normalizedUrl, { wordCount: 900 }, ctx(rows)).numbers.query;
        // Spot 31 is past the furthest spot the refresh checks treat as reachable.
        assert.equal(pick([row(page, 'hardscaping services yorba linda', 200, 31), row(page, 'pavers yorba linda', 12, 9)]), 'pavers yorba linda');
        // Under 10 searches a month is noise, even for the idea's own search.
        assert.equal(pick([row(page, 'hardscaping services yorba linda', 9, 9)]), null);
        assert.equal(pageRefreshRead(crawl[1].normalizedUrl, { wordCount: 900, targetQuery: 'pavers yorba linda' },
            ctx([row(page, 'pavers yorba linda', 9, 9), row(page, 'hardscaping services yorba linda', 30, 12)])).numbers.query, 'hardscaping services yorba linda');
    });
});

describe('duplicateGateSummary and readRefreshReasons', () => {
    it('counts what the gate caught', () => {
        const summary = duplicateGateSummary([
            { action: 'create' },
            { action: 'improve', matchedUrl: '/a' },
            { action: 'keep', matchedUrl: '/b' },
            { action: 'replace', matchedUrl: '/c' },
        ], 2, 3);
        assert.deepEqual(summary, {
            ideas: 4,
            matched_existing_pages: 3,
            already_live: 1,
            improve: 1,
            replace: 1,
            duplicate_ideas_dropped: 2,
            refresh_pages_added: 3,
        });
    });

    it('reads reasons by record id and skips anything malformed', () => {
        assert.deepEqual(readRefreshReasons({
            refresh_reasons: { r1: { reason: ' Ranks around spot 14 ', signals: [] }, r2: { reason: 4 }, r3: null },
        }), { r1: 'Ranks around spot 14' });
        assert.deepEqual(readRefreshReasons(null), {});
        assert.deepEqual(readRefreshReasons({ refresh_reasons: [] }), {});
    });
});

describe('determineAction', () => {
    it('keeps the word-count boundary used when a matched page is approved later', () => {
        assert.equal(determineAction({ wordCount: 299, title: 'Title', h1s: ['H1'] }, 1000), 'replace');
        assert.equal(determineAction({ wordCount: 300, title: 'Title', h1s: ['H1'] }, 1000), 'improve');
    });

    it('returns replace when word count < 300', () => {
        assert.equal(determineAction({ wordCount: 150, title: 'Some Title', h1s: ['H1'] }, 1000), 'replace');
    });

    it('returns replace when title is missing', () => {
        assert.equal(determineAction({ wordCount: 500, title: undefined, h1s: [] }, 1000), 'replace');
    });

    it('returns improve when word count below target min', () => {
        assert.equal(determineAction({ wordCount: 500, title: 'Title', h1s: ['H1'] }, 1000), 'improve');
    });

    it('returns keep when content is adequate', () => {
        assert.equal(determineAction({ wordCount: 1200, title: 'Title', h1s: ['H1'] }, 1000), 'keep');
    });
});
