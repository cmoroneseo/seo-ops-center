/**
 * Run with: node --import tsx --test lib/keyword-tracking/cannibalization.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { SearchReportingAdmin } from '../search-reporting/load.ts';
import { CannibalizationView, RankingsPanel, RankingsTab } from '../../components/workspace/RankingsTab.tsx';
import {
    CANNIBAL_DEFINITION,
    formatCannibalHealth,
    keywordCannibalization,
    MIN_COMPETING_URLS,
    MIN_URL_IMPRESSIONS,
    type CannibalFact,
} from './cannibalization.ts';
import { GSC_NOT_MEASURABLE, loadTrackedKeywordGsc } from './gsc-read.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const CURRENT = { start: '2026-10-06', end: '2026-11-02' };
const COMPARE = { start: '2026-09-08', end: '2026-10-05' };
const MEG = 'https://www.marketingempiregroup.com';
const GUIDE = `${MEG}/local-seo-service-home-businesses-guide`;

function fact(partial: CannibalFact): CannibalFact {
    return partial;
}

function day(query: string, page: string, impressions: number | null, position: number | null, clicks: number | null, date = '2026-10-20'): CannibalFact {
    return fact({ date, query, page, clicks, impressions, position, grain: 'query_page' });
}

test('Wix viewer fragments collapse, so one guide is not cannibalized', () => {
    const pages = [
        GUIDE,
        `${GUIDE}#viewer-k18i7388`,
        `${GUIDE}#viewer-c2i9v376`,
        `${GUIDE}#viewer-4yv97535`,
        `${GUIDE}#viewer-by4yw494`,
        `${GUIDE}#viewer-fwos0455`,
    ];
    const alone = keywordCannibalization({
        keywords: [{ id: 'guide', keyword: 'SEO for Service Based Business' }],
        current: CURRENT,
        measured: true,
        facts: pages.map((page, index) => day('seo for service based business', page, 40 + index, 8, 0)),
    });
    assert.equal(alone.affected, 0);
    assert.equal(alone.health, 1);
    assert.deepEqual(alone.keywords, []);

    const withCity = keywordCannibalization({
        keywords: [{ id: 'guide', keyword: 'seo for service based business' }],
        current: CURRENT,
        measured: true,
        facts: [
            ...pages.map(page => day('seo for service based business', page, 10, 8, 0)),
            day('seo for service based business', `${MEG}/temecula-ca`, 3, 11, 1),
        ],
    });
    assert.equal(withCity.affected, 1);
    assert.equal(withCity.keywords[0]?.urls.length, 2);
    assert.equal(withCity.keywords[0]?.urls[0]?.url, GUIDE);
    assert.equal(withCity.keywords[0]?.urls[0]?.impressions, 60);
    assert.equal(withCity.keywords.filter(row => row.urls.some(url => url.url.includes('#'))).length, 0);
});

test('marketing agency city pages stay affected, and a paired GBP URL does not', () => {
    assert.equal(MIN_URL_IMPRESSIONS, 1);
    assert.equal(MIN_COMPETING_URLS, 2);

    const agency = keywordCannibalization({
        keywords: [{ id: 'agency', keyword: 'Marketing Agency' }],
        current: CURRENT,
        measured: true,
        facts: [
            day('marketing agency', `${MEG}/?utm_source=google&utm_medium=gbp&utm_id=temecula`, 48, 1.4, 0),
            day('marketing agency', `${MEG}/murrieta-ca`, 45, 12, 0),
            day('marketing agency', `${MEG}/temecula-ca`, 13, 6.2, 0),
            day('marketing agency', `${MEG}/carson-city-marketing?utm_source=google&utm_medium=gbp&utm_campaign=carson_city`, 2, 1, 0),
            day('marketing agency', `${MEG}/murrieta-ca`, 99, 1, 9, '2026-09-15'),
            fact({
                date: '2026-10-20',
                query: 'marketing agency',
                page: `${MEG}/ignored`,
                clicks: 20,
                impressions: 20,
                position: 1,
                grain: 'page',
            }),
        ],
    });
    assert.equal(agency.affected, 1);
    assert.deepEqual(agency.keywords[0]?.urls.map(url => [url.url, url.impressions, url.clicks, url.avgPosition]), [
        [`${MEG}/murrieta-ca`, 45, 0, 12],
        [`${MEG}/temecula-ca`, 13, 0, 6.2],
    ]);
    assert.equal(JSON.stringify(agency).includes('utm_'), false);
    assert.equal(JSON.stringify(agency).includes(`${MEG}/"`), false);

    const paired = keywordCannibalization({
        keywords: [{ id: 'home', keyword: 'marketing empire group' }],
        current: CURRENT,
        measured: true,
        facts: [
            day('marketing empire group', `${MEG}/`, 6, 4, 1),
            day('marketing empire group', `${MEG}/?utm_source=google&utm_medium=gbp&utm_id=temecula`, 48, 1.4, 0),
            day('marketing empire group', 'https://g.page/marketingempiregroup', 9, 1, 0),
        ],
    });
    assert.equal(paired.affected, 0);
    assert.equal(paired.health, 1);
    assert.deepEqual(paired.keywords, []);

    const oneImpression = keywordCannibalization({
        keywords: [{ id: 'thin', keyword: 'thin query' }],
        current: CURRENT,
        measured: true,
        facts: [
            day('thin query', `${MEG}/a`, MIN_URL_IMPRESSIONS, 4, 0),
            day('thin query', `${MEG}/b`, MIN_URL_IMPRESSIONS, 9, 0),
        ],
    });
    assert.equal(oneImpression.affected, 1);
    assert.equal(oneImpression.keywords[0]?.urls.length, 2);
});

test('health is 1 minus affected over tracked, and zero tracked is not measurable', () => {
    const report = keywordCannibalization({
        keywords: [
            { id: 'agency', keyword: 'marketing agency' },
            { id: 'guide', keyword: 'seo for service based business' },
            { id: 'home', keyword: 'marketing empire group' },
            { id: 'quiet', keyword: 'quiet term' },
        ],
        current: CURRENT,
        measured: true,
        facts: [
            day('marketing agency', `${MEG}/murrieta-ca`, 45, 12, 0),
            day('marketing agency', `${MEG}/temecula-ca`, 13, 6.2, 0),
            day('seo for service based business', `${GUIDE}#viewer-k18i7388`, 258, 6, 0),
            day('seo for service based business', `${GUIDE}#viewer-c2i9v376`, 258, 6, 0),
            day('marketing empire group', `${MEG}/`, 6, 4, 1),
            day('marketing empire group', `${MEG}/?utm_medium=gbp`, 48, 1.4, 0),
            day('quiet term', `${MEG}/seo-services`, 12, 8, 0),
        ],
    });
    assert.equal(report.tracked, 4);
    assert.equal(report.affected, 1);
    assert.equal(report.health, 1 - 1 / 4);
    assert.equal(formatCannibalHealth(report.health), '75%');
    assert.deepEqual(report.keywords.map(row => row.keyword), ['marketing agency']);

    const none = keywordCannibalization({
        keywords: [],
        current: CURRENT,
        measured: true,
        facts: [day('marketing agency', `${MEG}/a`, 10, 4, 1), day('marketing agency', `${MEG}/b`, 10, 8, 1)],
    });
    assert.equal(none.tracked, 0);
    assert.equal(none.affected, null);
    assert.equal(none.health, null);
    assert.equal(formatCannibalHealth(none.health), GSC_NOT_MEASURABLE);
    assert.notEqual(formatCannibalHealth(none.health), '0%');
    assert.notEqual(formatCannibalHealth(none.health), '100%');
    assert.equal(JSON.stringify(none).includes('"affected":0'), false);
    assert.equal(JSON.stringify(none).includes('"health":0'), false);
    assert.equal(JSON.stringify(none).includes('"health":1'), false);

    const unread = keywordCannibalization({
        keywords: [{ id: 'agency', keyword: 'marketing agency' }],
        current: CURRENT,
        measured: false,
        facts: [
            day('marketing agency', `${MEG}/murrieta-ca`, 45, 12, 0),
            day('marketing agency', `${MEG}/temecula-ca`, 13, 6.2, 0),
        ],
    });
    assert.equal(unread.health, null);
    assert.equal(unread.affected, null);
    assert.deepEqual(unread.keywords, []);

    const allAffected = keywordCannibalization({
        keywords: [{ id: 'thin', keyword: 'thin query' }],
        current: CURRENT,
        measured: true,
        facts: [
            day('thin query', `${MEG}/a`, 1, 4, 0),
            day('thin query', `${MEG}/b`, 1, 9, 0),
        ],
    });
    assert.equal(allAffected.health, 0);
    assert.equal(formatCannibalHealth(0), '0%');
    assert.equal(formatCannibalHealth(null), 'not measurable');
});

test('missing impressions and position stay not measurable and are not coerced to 0', () => {
    const report = keywordCannibalization({
        keywords: [
            { id: 'split', keyword: 'split query' },
            { id: 'gap', keyword: 'gap query' },
        ],
        current: CURRENT,
        measured: true,
        facts: [
            day('split query', `${MEG}/a`, 8, null, null),
            day('split query', `${MEG}/b`, 5, null, null),
            day('gap query', `${MEG}/a`, 9, 4, 1),
            day('gap query', `${MEG}/a`, null, null, null),
            day('gap query', `${MEG}/b`, 4, 6, 0),
        ],
    });
    assert.equal(report.affected, 1);
    assert.deepEqual(report.keywords.map(row => row.keyword), ['split query']);
    const urls = report.keywords[0]?.urls ?? [];
    assert.deepEqual(urls.map(url => [url.url, url.impressions, url.clicks, url.avgPosition]), [
        [`${MEG}/a`, 8, null, null],
        [`${MEG}/b`, 5, null, null],
    ]);
    assert.equal(JSON.stringify(report).includes('"impressions":0'), false);
    assert.equal(JSON.stringify(report).includes('"clicks":0'), false);
    assert.equal(JSON.stringify(report).includes('"avgPosition":0'), false);
    assert.equal(JSON.stringify(report).includes(`${MEG}/b`), true);

    const zeroImpression = keywordCannibalization({
        keywords: [{ id: 'zero', keyword: 'zero query' }],
        current: CURRENT,
        measured: true,
        facts: [
            day('zero query', `${MEG}/a`, 7, 3, 1),
            day('zero query', `${MEG}/b`, 0, 0, 0),
        ],
    });
    assert.equal(zeroImpression.affected, 0);
    assert.equal(JSON.stringify(zeroImpression.keywords).includes('"impressions":0'), false);
});

test('the cannibalization view shows health, competing URLs, and the empty rule', () => {
    const keywords = [
        { id: 'agency', keyword: 'marketing agency', source: 'paste' as const, createdAt: '2026-11-06T00:00:00Z' },
        { id: 'guide', keyword: 'seo for service based business', source: 'paste' as const, createdAt: '2026-11-06T00:00:00Z' },
        { id: 'home', keyword: 'marketing empire group', source: 'paste' as const, createdAt: '2026-11-06T00:00:00Z' },
        { id: 'split', keyword: 'split query', source: 'paste' as const, createdAt: '2026-11-06T00:00:00Z' },
    ];
    const report = keywordCannibalization({
        keywords,
        current: CURRENT,
        measured: true,
        facts: [
            day('marketing agency', `${MEG}/murrieta-ca`, 45, 12, 0),
            day('marketing agency', `${MEG}/temecula-ca`, 13, 6.2, 0),
            day('marketing agency', `${MEG}/?utm_source=google&utm_medium=gbp&utm_id=temecula`, 48, 1.4, 0),
            day('seo for service based business', `${GUIDE}#viewer-k18i7388`, 258, 6, 0),
            day('seo for service based business', `${GUIDE}#viewer-c2i9v376`, 258, 6, 0),
            day('marketing empire group', `${MEG}/`, 6, 4, 1),
            day('marketing empire group', `${MEG}/?utm_medium=gbp`, 48, 1.4, 0),
            day('split query', `${MEG}/a`, 8, null, null),
            day('split query', `${MEG}/b`, 5, null, null),
        ],
    });
    const html = renderToStaticMarkup(createElement(RankingsPanel, {
        keywords,
        notes: [],
        cannibalization: report,
        initialSection: 'cannibalization',
        cap: 50,
        draft: '',
        message: '',
        error: '',
        periodLabel: 'Last 28 days · Oct 6 – Nov 2, 2026',
        compareLabel: 'Sep 8 – Oct 5, 2026',
        loading: false,
        busy: false,
        onDraft() {},
        onSubmit() {},
    }));
    assert.match(html, /aria-selected="true"[^>]*>Competing pages</);
    assert.match(html, /Last 28 days · Oct 6 – Nov 2, 2026/);
    assert.equal(html.includes('vs Sep 8'), false);
    assert.equal(html.includes('>Distribution<'), false);
    assert.equal(html.includes('Position distribution'), false);
    assert.match(html, new RegExp(CANNIBAL_DEFINITION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(html.includes('NEXT_PUBLIC'), false);
    assert.equal(/semrush|google ads/i.test(html), false);
    const health = html.match(/data-metric="health">([^<]+)/)?.[1];
    assert.equal(health, '50%');
    assert.match(html, /2 of 4 tracked keywords show on more than one page/);
    assert.match(html, /data-url="https:\/\/www\.marketingempiregroup\.com\/murrieta-ca"/);
    assert.match(html, /data-metric="impressions">45</);
    assert.match(html, /data-metric="impressions">13</);
    assert.match(html, /data-metric="clicks">0</);
    assert.equal(html.includes('#viewer-'), false);
    assert.equal(html.includes('utm_medium'), false);
    assert.equal(html.includes('data-url="https://www.marketingempiregroup.com/"'), false);
    assert.equal(html.includes('seo for service based business'), false);

    const split = html.slice(html.indexOf('data-keyword="split query"'), html.lastIndexOf('data-keyword="split query"') + 400);
    assert.match(split, /data-metric="position">not measurable/);
    assert.match(split, /data-metric="clicks">not measurable/);
    assert.equal(split.includes('0.0'), false);
    assert.equal(split.includes('>0<'), false);

    const empty = renderToStaticMarkup(createElement(CannibalizationView, {
        report: keywordCannibalization({
            keywords: [{ id: 'quiet', keyword: 'quiet term' }],
            facts: [],
            current: CURRENT,
            measured: true,
        }),
    }));
    assert.match(empty, /No pages are competing for the same search/);
    assert.match(empty, /two or more different pages were each shown in Google/);
    assert.equal(empty.match(/data-metric="health">([^<]+)/)?.[1], '100%');

    const unmeasured = renderToStaticMarkup(createElement(CannibalizationView, {
        report: keywordCannibalization({ keywords: [], facts: [], current: CURRENT, measured: true }),
    }));
    assert.equal(unmeasured.match(/data-metric="health">([^<]+)/)?.[1], 'not measurable');
    assert.equal(unmeasured.includes('0%'), false);
    assert.equal(unmeasured.includes('100%'), false);
    assert.equal(unmeasured.includes('No pages are competing for the same search'), false);
});

test('keyword tracking off makes no Supabase calls', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    const calls: string[] = [];
    const admin = {
        from(table: string) {
            calls.push(table);
            throw new Error(`should not read ${table}`);
        },
    };
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        const disabled = await loadTrackedKeywordGsc({
            organizationId: '11111111-1111-4111-8111-111111111111',
            clientId: '33333333-3333-4333-8333-333333333333',
            keywords: [{ id: 'agency', keyword: 'marketing agency' }],
            current: CURRENT,
            compare: COMPARE,
            client: admin as unknown as SearchReportingAdmin,
        });
        assert.deepEqual(disabled, { enabled: false });
        assert.deepEqual(calls, []);
        const html = renderToStaticMarkup(createElement(RankingsTab, {
            organizationId: 'org',
            clientId: 'client',
        }));
        assert.equal(html, '');
        const source = readFileSync(new URL('./cannibalization.ts', import.meta.url), 'utf8');
        const tab = readFileSync(new URL('../../components/workspace/RankingsTab.tsx', import.meta.url), 'utf8');
        assert.equal(source.includes('createClient'), false);
        assert.equal(source.includes('service_role'), false);
        assert.equal(tab.includes('createClient('), false);
        const refresh = tab.slice(tab.indexOf('const refresh = useCallback'), tab.indexOf('useEffect(() =>'));
        assert.ok(refresh.indexOf('loadTrackedKeywordGsc(') > refresh.indexOf('keywordTrackingEnabled()'));
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('a missing metric on the current-window read is not stored as zero', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    const calls: string[] = [];
    const admin = {
        from(table: string) {
            calls.push(table);
            const filters: { column: string; value: unknown }[] = [];
            const api = {
                select() { return api; },
                eq(column: string, value: unknown) { filters.push({ column, value }); return api; },
                gte() { return api; },
                lte() { return api; },
                in() { return api; },
                order() { return api; },
                async maybeSingle() {
                    return { data: { site_url: 'sc-domain:marketingempiregroup.com' }, error: null };
                },
                async range() {
                    if (table === 'gsc_history_days') {
                        return { data: [{ id: 'day-current', data_date: '2026-10-20' }], error: null };
                    }
                    return {
                        data: [
                            {
                                day_id: 'day-current',
                                grain: 'query_page',
                                query: 'split query',
                                page: `${MEG}/a`,
                                clicks: null,
                                impressions: 8,
                                position: null,
                            },
                            {
                                day_id: 'day-current',
                                grain: 'query_page',
                                query: 'split query',
                                page: `${MEG}/b`,
                                clicks: null,
                                impressions: '5',
                                position: null,
                            },
                            {
                                day_id: 'day-current',
                                grain: 'query_page',
                                query: 'gap query',
                                page: `${MEG}/a`,
                                clicks: 1,
                                impressions: null,
                                position: 4,
                            },
                        ],
                        error: null,
                    };
                },
            };
            return api;
        },
    };
    try {
        const loaded = await loadTrackedKeywordGsc({
            organizationId: '11111111-1111-4111-8111-111111111111',
            clientId: '33333333-3333-4333-8333-333333333333',
            keywords: [
                { id: 'split', keyword: 'split query' },
                { id: 'gap', keyword: 'gap query' },
            ],
            current: CURRENT,
            compare: COMPARE,
            client: admin as unknown as SearchReportingAdmin,
        });
        assert.equal(loaded.enabled && loaded.ok, true);
        if (!loaded.enabled || !loaded.ok) return;
        assert.equal(loaded.rows[0]?.current.status, 'not measurable');
        assert.equal(loaded.rows[0]?.current.impressions, null);
        assert.equal(loaded.rows[1]?.current.impressions, null);
        assert.equal(loaded.cannibalization.affected, 1);
        assert.equal(loaded.cannibalization.keywords[0]?.keyword, 'split query');
        assert.equal(loaded.cannibalization.keywords[0]?.urls[0]?.avgPosition, null);
        assert.equal(loaded.cannibalization.keywords[0]?.urls[0]?.clicks, null);
        assert.equal(loaded.cannibalization.keywords[0]?.urls[0]?.impressions, 8);
        assert.equal(JSON.stringify(loaded.cannibalization).includes('"impressions":0'), false);
        assert.equal(JSON.stringify(loaded.cannibalization).includes('"avgPosition":0'), false);
        assert.equal(JSON.stringify(loaded.cannibalization).includes('"clicks":0'), false);
        assert.deepEqual(calls, ['client_integrations', 'gsc_history_days', 'gsc_history_facts']);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});
