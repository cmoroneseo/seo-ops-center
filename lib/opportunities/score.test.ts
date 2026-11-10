import assert from 'node:assert/strict';
import test from 'node:test';

import type { Candidate, HistoryDay, OverlapCandidate, PageCandidate } from '../gsc/insights';
import type { CannibalizationReport } from '../keyword-tracking/cannibalization';
import {
    MIN_CTR_CURVE_DAYS,
    MIN_CURVE_BUCKET_IMPRESSIONS,
    THIN_WORD_COUNT,
    formatOpportunityLabel,
    formatOpportunityNumber,
    formatOpportunityText,
    opportunityQueue,
    scoreOpportunities,
    type OpportunityCrawlPage,
    type OpportunityCurveRow,
    type ScoreOpportunitiesInput,
} from './score';

function days(count: number, flags: Partial<HistoryDay> = {}): HistoryDay[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `day-${index + 1}`,
        date: `2026-09-${String(index + 1).padStart(2, '0')}`,
        importedAt: '2026-10-01T00:00:00Z',
        pageLimited: false,
        queryLimited: false,
        ...flags,
    }));
}

function candidate(overrides: Partial<Candidate> = {}): Candidate {
    return {
        query: 'patio ideas',
        page: 'https://example.com/patios',
        clicks: 18,
        impressions: 1000,
        position: 8,
        ctr: 0.018,
        observedDays: 12,
        ...overrides,
    };
}

function crawl(overrides: Partial<OpportunityCrawlPage> = {}): OpportunityCrawlPage {
    return {
        url: 'https://example.com/patios',
        isHomepage: false,
        discoverySources: ['sitemap'],
        fetchStatus: 'success',
        statusCode: 200,
        contentType: 'text/html',
        robotsAllowed: true,
        robotsDirectives: [],
        title: 'Patio ideas',
        metaDescription: 'A description.',
        h1s: ['Patio ideas'],
        wordCount: 800,
        inboundInternalLinks: 3,
        ...overrides,
    };
}

function input(overrides: Partial<ScoreOpportunitiesInput> = {}): ScoreOpportunitiesInput {
    return {
        days: days(MIN_CTR_CURVE_DAYS),
        missingDates: [],
        expandedEvidenceAvailable: true,
        queryPageRollups: [],
        pageRollups: [],
        visibilityRollups: [],
        overlapRollups: [],
        gscRows: [],
        gscRowsTruncated: false,
        brand: '',
        pages: [],
        cannibalization: null,
        ...overrides,
    };
}

function curveRows(): OpportunityCurveRow[] {
    return days(MIN_CTR_CURVE_DAYS).map((day, index) => index === 0
        ? { dayId: day.id, position: 3, clicks: 50, impressions: 500 }
        : { dayId: day.id, position: 8, clicks: 2, impressions: 20 });
}

function page(overrides: Partial<PageCandidate> = {}): PageCandidate {
    return {
        page: 'https://example.com/patios',
        clicks: 10,
        impressions: 1000,
        position: 10,
        ctr: 0.01,
        observedDays: 10,
        ...overrides,
    };
}

test('documented thresholds stay explicit', () => {
    assert.equal(MIN_CTR_CURVE_DAYS, 7);
    assert.equal(MIN_CURVE_BUCKET_IMPRESSIONS, 100);
    assert.equal(THIN_WORD_COUNT, 300);
});

test('null values render as an em dash and a real zero stays zero', () => {
    assert.equal(formatOpportunityNumber(null), '—');
    assert.equal(formatOpportunityNumber(undefined), '—');
    assert.equal(formatOpportunityNumber(Number.NaN), '—');
    assert.equal(formatOpportunityNumber(0), '0');
    assert.equal(formatOpportunityNumber(1200), '1,200');
    assert.equal(formatOpportunityLabel(null), '—');
    assert.equal(formatOpportunityLabel('  '), '—');
    assert.equal(formatOpportunityLabel('high'), 'High');
    assert.equal(formatOpportunityText(null), '—');
    assert.equal(formatOpportunityText(''), '—');
    assert.equal(formatOpportunityText(' https://example.com/patios '), 'https://example.com/patios');
});

test('improve ranking scores a near-page-one query from observed impressions and position', () => {
    const row = candidate();
    const [item] = scoreOpportunities(input({ queryPageRollups: [row], gscRows: curveRows() }));
    assert.equal(item?.actionType, 'improve_ranking');
    assert.equal(item?.actionLabel, 'Improve ranking');
    assert.equal(item?.score, 75);
    assert.equal(item?.impact, 'high');
    assert.equal(item?.effort, 'medium');
    assert.equal(item?.page, row.page);
    assert.equal(item?.query, row.query);
    assert.match(item?.evidence ?? '', /position 8\.0/);
    assert.match(item?.evidence ?? '', /1,000 impressions/);
    assert.equal(item?.investigation?.category, 'near_page_one');
    assert.equal(item?.estClicks, 82);
});

test('est. clicks uses the property CTR curve only after the day threshold', () => {
    const ready = candidate({ clicks: 10, impressions: 200, position: 8, observedDays: MIN_CTR_CURVE_DAYS, ctr: 0.05 });
    const scored = scoreOpportunities(input({ queryPageRollups: [ready], gscRows: curveRows() }));
    assert.equal(scored[0]?.estClicks, 10);

    const shortRow = scoreOpportunities(input({
        queryPageRollups: [candidate({ clicks: 10, impressions: 200, position: 8, observedDays: MIN_CTR_CURVE_DAYS - 1, ctr: 0.05 })],
        gscRows: curveRows(),
    }));
    assert.equal(shortRow[0]?.actionType, 'improve_ranking');
    assert.equal(shortRow[0]?.estClicks, null);

    const shortCurve = scoreOpportunities(input({
        days: days(MIN_CTR_CURVE_DAYS - 1),
        queryPageRollups: [ready],
        gscRows: curveRows().slice(0, MIN_CTR_CURVE_DAYS - 1),
    }));
    assert.equal(shortCurve[0]?.estClicks, null);

    const aboveCurve = scoreOpportunities(input({
        queryPageRollups: [candidate({ clicks: 40, impressions: 200, position: 8, observedDays: MIN_CTR_CURVE_DAYS, ctr: 0.2 })],
        gscRows: curveRows(),
    }));
    assert.equal(aboveCurve[0]?.estClicks, null);

    const exact = scoreOpportunities(input({
        queryPageRollups: [candidate({ clicks: 20, impressions: 200, position: 8, observedDays: MIN_CTR_CURVE_DAYS, ctr: 0.1 })],
        gscRows: curveRows(),
    }));
    assert.equal(exact[0]?.estClicks, 0);
    assert.equal(formatOpportunityNumber(exact[0]?.estClicks), '0');
});

test('a thin position bucket and a truncated history do not produce est. clicks', () => {
    const thinBucket = days(MIN_CTR_CURVE_DAYS).map(day => ({
        dayId: day.id, position: 3, clicks: 1, impressions: 10,
    }));
    const row = candidate({ clicks: 10, impressions: 200, position: 8, observedDays: MIN_CTR_CURVE_DAYS, ctr: 0.05 });
    assert.equal(scoreOpportunities(input({ queryPageRollups: [row], gscRows: thinBucket }))[0]?.estClicks, null);
    assert.equal(scoreOpportunities(input({
        queryPageRollups: [row],
        gscRows: curveRows(),
        gscRowsTruncated: true,
    }))[0]?.estClicks, null);
});

test('incomplete query evidence omits search rows and does not score them as zero', () => {
    const items = scoreOpportunities(input({
        days: days(MIN_CTR_CURVE_DAYS, { queryLimited: true }),
        queryPageRollups: [candidate()],
        visibilityRollups: [candidate({ position: 30, impressions: 250, clicks: 2, ctr: 2 / 250, observedDays: 8 })],
        gscRows: curveRows(),
        pages: [crawl({ url: 'https://example.com/guide', title: 'Guide', metaDescription: 'Kept', h1s: [], wordCount: 900 })],
    }));
    assert.equal(items.some(item => item.actionType === 'improve_ranking'), false);
    assert.equal(items.some(item => item.actionType === 'capture_demand'), false);
    assert.equal(items.some(item => item.score == null), false);
    assert.equal(items.filter(item => item.actionType === 'add_h1').length, 1);
    assert.equal(items[0]?.estClicks, null);
});

test('capture demand scores deeper visibility separately from near-page-one', () => {
    const row = candidate({ query: 'patio cost', position: 30, impressions: 250, clicks: 2, ctr: 2 / 250, observedDays: 8 });
    const [item] = scoreOpportunities(input({ visibilityRollups: [row] }));
    assert.equal(item?.actionType, 'capture_demand');
    assert.equal(item?.actionLabel, 'Capture demand');
    assert.equal(item?.score, 53);
    assert.equal(item?.impact, 'medium');
    assert.equal(item?.effort, 'high');
    assert.equal(item?.investigation?.category, 'deeper_visibility');
    assert.match(item?.evidence ?? '', /position 30\.0/);
});

test('add meta description, add H1, thin content, and orphans each score from crawl evidence', () => {
    const items = scoreOpportunities(input({
        pages: [
            crawl({
                url: 'https://example.com/guide',
                title: 'Guide',
                metaDescription: undefined,
                h1s: [],
                wordCount: 120,
                inboundInternalLinks: 0,
            }),
            crawl({ url: 'https://example.com/', isHomepage: true, inboundInternalLinks: 0, wordCount: 900 }),
            crawl({ url: 'https://example.com/privacy-policy', metaDescription: undefined, h1s: [], wordCount: 50, inboundInternalLinks: 0 }),
            crawl({ url: 'https://example.com/failed', fetchStatus: 'failed', statusCode: 500, h1s: [], metaDescription: undefined, wordCount: undefined }),
            crawl({ url: 'https://example.com/full', wordCount: undefined, metaDescription: 'Present', h1s: ['Full'] }),
        ],
    }));
    const byAction = (action: string, url: string) => items.find(item => item.actionType === action && item.page === url);
    const meta = byAction('add_meta_description', 'https://example.com/guide');
    const heading = byAction('add_h1', 'https://example.com/guide');
    const thin = byAction('expand_thin_content', 'https://example.com/guide');
    const orphan = byAction('add_internal_links', 'https://example.com/guide');
    assert.equal(meta?.score, 14);
    assert.equal(meta?.impact, null);
    assert.equal(meta?.effort, 'low');
    assert.equal(meta?.estClicks, null);
    assert.equal(meta?.query, null);
    assert.match(meta?.evidence ?? '', /No meta description/);
    assert.equal(heading?.actionLabel, 'Add H1');
    assert.equal(heading?.score, 16);
    assert.equal(thin?.actionLabel, 'Expand thin content');
    assert.equal(thin?.score, 32);
    assert.equal(thin?.effort, 'high');
    assert.match(thin?.evidence ?? '', /120/);
    assert.equal(orphan?.actionLabel, 'Add internal links');
    assert.equal(orphan?.score, 18);
    assert.equal(orphan?.effort, 'medium');
    assert.equal(items.some(item => item.page === 'https://example.com/' && item.actionType === 'add_internal_links'), false);
    assert.equal(items.some(item => item.page === 'https://example.com/privacy-policy'), false);
    assert.equal(items.some(item => item.page === 'https://example.com/failed'), false);
    assert.equal(items.some(item => item.page === 'https://example.com/full' && item.actionType === 'expand_thin_content'), false);
});

test('rewrite title covers a missing title and a duplicate title, not a unique one', () => {
    const items = scoreOpportunities(input({
        pages: [
            crawl({ url: 'https://example.com/a', title: 'Services' }),
            crawl({ url: 'https://example.com/b', title: ' services ' }),
            crawl({ url: 'https://example.com/c', title: undefined, metaDescription: 'Has a description', h1s: ['Heading'], wordCount: 800 }),
            crawl({ url: 'https://example.com/d', title: 'Unique page' }),
        ],
    }));
    const rewrites = items.filter(item => item.actionType === 'rewrite_title');
    assert.equal(rewrites.length, 3);
    assert.equal(rewrites.every(item => item.score === 28 && item.effort === 'low' && item.investigation == null), true);
    assert.match(rewrites.find(item => item.page === 'https://example.com/a')?.evidence ?? '', /shared by 2/);
    assert.match(rewrites.find(item => item.page === 'https://example.com/c')?.evidence ?? '', /No title was observed/);
    assert.equal(items.some(item => item.page === 'https://example.com/d' && item.actionType === 'rewrite_title'), false);
});

test('resolve overlap scores Search Console overlap and does not duplicate a tracked keyword', () => {
    const overlap: OverlapCandidate = {
        query: 'landscape design',
        clicks: 7,
        impressions: 150,
        position: 12,
        ctr: 7 / 150,
        observedDays: 8,
        pages: [
            candidate({ query: 'landscape design', page: 'https://example.com/design', impressions: 80, clicks: 4, observedDays: 8, ctr: 0.05 }),
            candidate({ query: 'landscape design', page: 'https://example.com/landscaping', impressions: 70, clicks: 3, observedDays: 6, ctr: 3 / 70 }),
        ],
    };
    const cannibalization: CannibalizationReport = {
        tracked: 1,
        affected: 1,
        health: 0,
        keywords: [{
            id: 'k1',
            keyword: 'Landscape Design',
            urls: [
                { url: 'https://example.com/design', clicks: 4, impressions: 80, avgPosition: 11 },
                { url: 'https://example.com/landscaping', clicks: 3, impressions: 70, avgPosition: 14 },
            ],
        }],
    };
    const items = scoreOpportunities(input({ overlapRollups: [overlap], cannibalization }));
    assert.equal(items.length, 1);
    assert.equal(items[0]?.actionType, 'resolve_overlap');
    assert.equal(items[0]?.actionLabel, 'Resolve overlap');
    assert.equal(items[0]?.score, 63);
    assert.equal(items[0]?.impact, 'low');
    assert.equal(items[0]?.effort, 'medium');
    assert.equal(items[0]?.investigation?.category, 'overlapping_urls');
    assert.match(items[0]?.evidence ?? '', /2 URLs/);
    assert.match(items[0]?.evidence ?? '', /Tracked-keyword cannibalization/);
});

test('an unmeasured cannibalization report adds no overlap row', () => {
    const items = scoreOpportunities(input({
        cannibalization: { tracked: 2, affected: null, health: null, keywords: [] },
    }));
    assert.equal(items.length, 0);
});

test('measured cannibalization still scores when Search Console evidence is incomplete', () => {
    const items = scoreOpportunities(input({
        days: days(2, { queryLimited: true }),
        missingDates: ['2026-09-03'],
        cannibalization: {
            tracked: 1,
            affected: 1,
            health: 0,
            keywords: [{
                id: 'k2',
                keyword: 'yard drainage',
                urls: [
                    { url: 'https://example.com/drain', clicks: null, impressions: 40, avgPosition: null },
                    { url: 'https://example.com/yard', clicks: 1, impressions: 30, avgPosition: 9 },
                ],
            }],
        },
    }));
    assert.equal(items.length, 1);
    assert.equal(items[0]?.actionType, 'resolve_overlap');
    assert.equal(items[0]?.investigation, null);
    assert.equal(items[0]?.estClicks, null);
    assert.equal(items[0]?.impact, 'low');
    assert.match(items[0]?.evidence ?? '', /70 combined/);
});

test('page evidence must be complete before crawl rows inherit Search Console demand', () => {
    const pages = [crawl({ url: 'https://example.com/patios', metaDescription: undefined })];
    const rollups = [page()];
    const hidden = scoreOpportunities(input({
        days: days(MIN_CTR_CURVE_DAYS, { pageLimited: true }),
        pages,
        pageRollups: rollups,
    }));
    const metaHidden = hidden.find(item => item.actionType === 'add_meta_description');
    assert.equal(metaHidden?.score, 14);
    assert.equal(metaHidden?.impact, null);
    assert.equal(metaHidden?.evidence.includes('Search Console'), false);

    const shown = scoreOpportunities(input({ pages, pageRollups: rollups }));
    const meta = shown.find(item => item.actionType === 'add_meta_description');
    assert.equal(meta?.score, 44);
    assert.equal(meta?.impact, 'high');
    assert.match(meta?.evidence ?? '', /1,000 impressions/);
});

test('a JavaScript-unresolved crawl still scores and says the crawl did not run JavaScript', () => {
    const [item] = scoreOpportunities(input({
        pages: [crawl({
            url: 'https://example.com/js',
            fetchStatus: 'js_unresolved',
            h1s: [],
            title: 'Rendered later',
            metaDescription: 'Present',
            wordCount: 400,
        })],
    }));
    assert.equal(item?.actionType, 'add_h1');
    assert.match(item?.evidence ?? '', /did not run JavaScript/);
});

test('rows sort by score and every score is an integer from 0 to 100', () => {
    const items = scoreOpportunities(input({
        queryPageRollups: [candidate()],
        pages: [crawl({ url: 'https://example.com/guide', metaDescription: undefined })],
    }));
    assert.deepEqual(items.map(item => item.actionType), ['improve_ranking', 'add_meta_description']);
    assert.equal(items.every(item => Number.isInteger(item.score) && item.score >= 0 && item.score <= 100), true);
});

test('investigation queues reuse open, task-created, and dismissed', () => {
    assert.equal(opportunityQueue(null), 'active');
    assert.equal(opportunityQueue(undefined), 'active');
    assert.equal(opportunityQueue('open'), 'active');
    assert.equal(opportunityQueue('task_created'), 'completed');
    assert.equal(opportunityQueue('dismissed'), 'dismissed');
});
