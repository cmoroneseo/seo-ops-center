import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    aggregatePagePerformance,
    DECLINE_MIN_DROP,
    DECLINE_MIN_PRIOR_CLICKS,
    DECLINE_MIN_PRIOR_IMPRESSIONS,
    expectedCtr,
    isMoneyPage,
    LOW_CTR_MIN_IMPRESSIONS,
    mainCluster,
    matchedPageVerdict,
    NOT_IN_GOOGLE_REASON,
    PERIOD_MIN_DAYS,
    queriesByPage,
    refreshCandidates,
    refreshRead,
    refreshReason,
    REFRESH_IDEAS_MAX,
    STRIKING_MAX_POSITION,
    STRIKING_MIN_IMPRESSIONS,
    STRIKING_MIN_POSITION,
    THIN_MAX_WORDS,
    type PagePerformance,
    type RefreshInput,
} from './page-performance.ts';

const url = 'https://ecoworkz.com/corona-ca/';

function perf(recent: [number, number, number | null], prior: [number, number, number | null] = [0, 0, null]): PagePerformance {
    return {
        url,
        recent: { clicks: recent[0], impressions: recent[1], position: recent[2] },
        prior: { clicks: prior[0], impressions: prior[1], position: prior[2] },
    };
}

function input(overrides: Partial<RefreshInput> = {}): RefreshInput {
    return { url, performance: null, recentDays: 90, priorDays: 90, cluster: null, clusterDays: 28, wordCount: 1500, moneyPage: true, ...overrides };
}

describe('aggregatePagePerformance', () => {
    it('splits stored days into the last 90 and the 90 before, newest day first', () => {
        const days = [
            { id: 'd0', date: '2026-11-01' },
            { id: 'd89', date: '2026-08-04' },
            { id: 'd90', date: '2026-08-03' },
            { id: 'd179', date: '2026-05-06' },
            { id: 'd180', date: '2026-05-05' },
        ];
        const rows = [
            { day_id: 'd0', page: 'https://www.ecoworkz.com/corona-ca/', clicks: 5, impressions: 100, position: 10 },
            { day_id: 'd89', page: 'https://ecoworkz.com/corona-ca', clicks: 5, impressions: 300, position: 20 },
            { day_id: 'd90', page: url, clicks: 7, impressions: 50, position: 4 },
            { day_id: 'd179', page: url, clicks: 3, impressions: 50, position: 6 },
            { day_id: 'd180', page: url, clicks: 99, impressions: 999, position: 1 },
            { day_id: 'unknown', page: url, clicks: 99, impressions: 999, position: 1 },
        ];
        const read = aggregatePagePerformance(rows, days);
        assert.equal(read.recentDays, 2);
        assert.equal(read.priorDays, 2);
        assert.equal(read.pages.size, 1);
        const page = [...read.pages.values()][0];
        assert.deepEqual(page.recent, { clicks: 10, impressions: 400, position: 17.5 });
        assert.deepEqual(page.prior, { clicks: 10, impressions: 100, position: 5 });
    });

    it('is empty without stored days', () => {
        assert.equal(aggregatePagePerformance([{ day_id: 'x', page: url, clicks: 1, impressions: 1, position: 1 }], []).pages.size, 0);
    });
});

describe('expectedCtr', () => {
    it('follows the position bands and stops past spot 20', () => {
        assert.equal(expectedCtr(1), 0.28);
        assert.equal(expectedCtr(6.4), 0.035);
        assert.equal(expectedCtr(9), 0.025);
        assert.equal(expectedCtr(20), 0.01);
        assert.equal(expectedCtr(21), null);
        assert.equal(expectedCtr(null), null);
    });
});

describe('signal (a): striking distance', () => {
    const cluster = (position: number, impressions: number) => ({ query: 'artificial grass corona', position, impressions });

    it('fires for spots 8 to 30 with enough impressions', () => {
        assert.deepEqual(refreshRead(input({ cluster: cluster(14, STRIKING_MIN_IMPRESSIONS) })).signals, ['striking_distance']);
        assert.deepEqual(refreshRead(input({ cluster: cluster(STRIKING_MIN_POSITION, 200) })).signals, ['striking_distance']);
        assert.deepEqual(refreshRead(input({ cluster: cluster(STRIKING_MAX_POSITION, 200) })).signals, ['striking_distance']);
    });

    it('does not fire on page 1 top spots, past spot 30, or with too few impressions', () => {
        assert.deepEqual(refreshRead(input({ cluster: cluster(7.4, 500) })).signals, []);
        assert.deepEqual(refreshRead(input({ cluster: cluster(31, 500) })).signals, []);
        assert.deepEqual(refreshRead(input({ cluster: cluster(14, STRIKING_MIN_IMPRESSIONS - 1) })).signals, []);
    });

    it('scales impressions to 28 days when the window is shorter', () => {
        assert.deepEqual(refreshRead(input({ cluster: cluster(14, 25), clusterDays: 14 })).signals, ['striking_distance']);
    });

    it('falls back to the page-level spot over 90 days', () => {
        const read = refreshRead(input({ performance: perf([2, 300, 12], [2, 300, 12]) }));
        assert.deepEqual(read.signals, ['striking_distance']);
        assert.equal(read.numbers.query, null);
    });
});

describe('signal (b): decline', () => {
    it('fires at a 30% drop in impressions or clicks', () => {
        const impressions = refreshRead(input({ performance: perf([30, 580, 4], [30, 1000, 4]) }));
        assert.deepEqual(impressions.signals, ['decline']);
        assert.ok(Math.abs((impressions.numbers.impressionsChange ?? 0) + 0.42) < 1e-9);
        // 900 impressions keeps the low click-through check out of it.
        const clicks = refreshRead(input({ performance: perf([14, 900, 4], [DECLINE_MIN_PRIOR_CLICKS, 1000, 4]) }));
        assert.deepEqual(clicks.signals, ['decline']);
    });

    it('does not fire just under the drop', () => {
        const drop = 1 - DECLINE_MIN_DROP + 0.01;
        assert.deepEqual(refreshRead(input({ performance: perf([100, Math.round(1000 * drop), 4], [100, 1000, 4]) })).signals, []);
    });

    it('ignores small pages', () => {
        assert.deepEqual(refreshRead(input({ performance: perf([5, 100, 4], [DECLINE_MIN_PRIOR_CLICKS - 1, DECLINE_MIN_PRIOR_IMPRESSIONS - 1, 4]) })).signals, []);
    });

    it('needs enough stored days in both periods', () => {
        assert.deepEqual(refreshRead(input({ priorDays: PERIOD_MIN_DAYS - 1, performance: perf([30, 500, 4], [30, 1000, 4]) })).signals, []);
    });
});

describe('signal (c): low click-through', () => {
    it('fires when clicks are under half the usual rate for the spot', () => {
        // Spot 3 usually gets 10%; 40 clicks on 2,000 is 2%.
        const read = refreshRead(input({ performance: perf([40, 2000, 3], [40, 2000, 3]) }));
        assert.deepEqual(read.signals, ['low_ctr']);
        assert.equal(read.numbers.expectedCtr, 0.1);
    });

    it('does not fire at half the usual rate or with few impressions', () => {
        assert.deepEqual(refreshRead(input({ performance: perf([100, 2000, 3], [100, 2000, 3]) })).signals, []);
        assert.deepEqual(refreshRead(input({ performance: perf([0, LOW_CTR_MIN_IMPRESSIONS - 1, 3], [0, 900, 3]) })).signals, []);
    });
});

describe('signal (d): thin', () => {
    it('fires for a short money page only', () => {
        assert.deepEqual(refreshRead(input({ wordCount: THIN_MAX_WORDS - 1 })).signals, ['thin']);
        assert.deepEqual(refreshRead(input({ wordCount: THIN_MAX_WORDS })).signals, []);
        assert.deepEqual(refreshRead(input({ wordCount: 350, moneyPage: false })).signals, []);
    });

    it('reads money pages from the page type, else from the URL', () => {
        assert.equal(isMoneyPage('/x', 'city'), true);
        assert.equal(isMoneyPage('/x', 'blog_post'), false);
        assert.equal(isMoneyPage('https://ecoworkz.com/blog/pavers-vs-concrete/'), false);
        assert.equal(isMoneyPage('https://ecoworkz.com/contact-us/'), false);
        assert.equal(isMoneyPage('https://ecoworkz.com/corona-ca/'), true);
    });
});

describe('refreshReason', () => {
    it('reads as plain English with the numbers', () => {
        const read = refreshRead(input({
            cluster: { query: 'artificial grass corona', position: 14.2, impressions: 300 },
            performance: perf([30, 580, 14], [30, 1000, 12]),
        }));
        assert.equal(
            refreshReason(read),
            'Ranks around spot 14 in Google for “artificial grass corona”; showing up in 42% fewer searches vs the previous 3 months',
        );
    });

    it('names clicks and low click-through and thin pages', () => {
        const read = refreshRead(input({ performance: perf([40, 2000, 3], [80, 2000, 3]), wordCount: 420 }));
        assert.deepEqual(read.signals, ['decline', 'low_ctr', 'thin']);
        assert.equal(
            refreshReason(read),
            'Ranks around spot 3 in Google; clicks down 50% vs the previous 3 months; seen in 2,000 searches in the last 3 months but clicked only 40 times, well below normal for that spot; only 420 words, short for a service page',
        );
    });
});

describe('matchedPageVerdict', () => {
    const cluster = (position: number) => ({ query: 'artificial grass corona', position, impressions: 10 });

    it('keeps a page-1 page with no signals (Already live)', () => {
        assert.deepEqual(matchedPageVerdict(refreshRead(input({ cluster: cluster(4) })), true), { action: 'keep' });
    });

    it('improves a page below page 1 even without a signal', () => {
        const verdict = matchedPageVerdict(refreshRead(input({ cluster: cluster(52) })), true);
        assert.equal(verdict?.action, 'improve');
        assert.equal(verdict?.action === 'improve' && verdict.reason, 'Ranks around spot 52 in Google for “artificial grass corona”, below page 1');
    });

    it('improves a page with any signal, with the reason', () => {
        const verdict = matchedPageVerdict(refreshRead(input({ cluster: { ...cluster(14), impressions: 200 } })), true);
        assert.deepEqual(verdict, {
            action: 'improve',
            reason: 'Ranks around spot 14 in Google for “artificial grass corona”',
            signals: ['striking_distance'],
        });
    });

    it('improves a page Google never shows when Search Console is connected', () => {
        assert.deepEqual(matchedPageVerdict(refreshRead(input()), true), { action: 'improve', reason: NOT_IN_GOOGLE_REASON, signals: [] });
    });

    it('defers to the content check without Search Console, unless the page is thin', () => {
        assert.equal(matchedPageVerdict(refreshRead(input()), false), null);
        assert.equal(matchedPageVerdict(refreshRead(input({ wordCount: 400 })), false)?.action, 'improve');
    });
});

describe('queriesByPage and mainCluster', () => {
    const rows = [
        { query: 'artificial grass corona', page: url, clicks: 1, impressions: 300, position: 14 },
        { query: 'turf corona', page: 'https://www.ecoworkz.com/corona-ca', clicks: 0, impressions: 50, position: 9 },
        { query: 'pavers', page: 'https://ecoworkz.com/pavers/', clicks: 3, impressions: 90, position: 6 },
    ];

    it('groups by page and prefers the idea target search', () => {
        const byPage = queriesByPage(rows);
        const corona = byPage.get('ecoworkz.com/corona-ca');
        assert.equal(corona?.length, 2);
        assert.equal(mainCluster(corona)?.query, 'artificial grass corona');
        assert.equal(mainCluster(corona, 'Turf  Corona')?.query, 'turf corona');
        assert.equal(mainCluster(undefined), null);
    });
});

describe('refreshCandidates', () => {
    const page = (path: string, recentImpressions: number, priorImpressions: number, signal = true) => ({
        url: `https://ecoworkz.com${path}`,
        title: path,
        read: refreshRead(input({
            url: `https://ecoworkz.com${path}`,
            performance: signal
                ? { url: path, recent: { clicks: 0, impressions: recentImpressions, position: 14 }, prior: { clicks: 0, impressions: priorImpressions, position: 2 } }
                : { url: path, recent: { clicks: 900, impressions: recentImpressions, position: 2 }, prior: { clicks: 900, impressions: priorImpressions, position: 2 } },
        })),
    });

    it('ranks unmatched pages with signals by impressions at stake and caps the list', () => {
        const pages = [
            page('/a/', 400, 2000),
            page('/b/', 900, 100),
            page('/matched/', 5000, 5000),
            page('/', 9000, 9000),
            page('/contact-us/', 8000, 8000),
            page('/galleries/', 7000, 7000),
            page('/galleries/pavers-gallery/', 6000, 6000),
            page('/book/?rwg_token=abc', 5500, 5500),
            page('/quiet/', 3000, 3000, false),
            ...Array.from({ length: 12 }, (_, i) => page(`/extra-${i}/`, 200 + i, 0)),
        ];
        const result = refreshCandidates(pages, new Set(['https://www.ecoworkz.com/matched']));
        assert.equal(result.length, REFRESH_IDEAS_MAX);
        assert.deepEqual(result.slice(0, 3).map(c => c.title), ['/a/', '/b/', '/extra-11/']);
        assert.equal(result[0].impressionsAtStake, 2000);
        assert.match(result[0].reason, /fewer searches vs the previous 3 months/);
        assert.equal(result.some(c => ['/', '/contact-us/', '/galleries/', '/galleries/pavers-gallery/', '/book/?rwg_token=abc', '/matched/', '/quiet/']
            .includes(c.title ?? '')), false);
    });
});
