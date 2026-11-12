import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    determineAction,
    duplicateGateSummary,
    readRefreshReasons,
    reconcileRecord,
    type ReconcileContext,
} from './reconcile.ts';
import { queriesByPage } from './page-performance.ts';

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

    it('pavers and concrete ideas in the same city stay new pages', () => {
        assert.equal(reconcileRecord({ targetQuery: 'pavers corona', title: 'Pavers in Corona' }, [corona], [], ctx(3, 300)).action, 'create');
        assert.equal(reconcileRecord({ targetQuery: 'concrete corona', title: 'Concrete in Corona' }, [corona], [], ctx(3, 300)).action, 'create');
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
