/**
 * Run with: node --import tsx --test lib/keyword-tracking/gsc-read.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { SearchReportingAdmin } from '../search-reporting/load.ts';
import { normalizeUrl } from '../url/normalize-url.ts';
import {
    GSC_NOT_MEASURABLE,
    loadTrackedKeywordGsc,
    readTrackedKeywordGsc,
    type GscQueryPageFact,
    type GscReadWindow,
} from './gsc-read.ts';

const CURRENT: GscReadWindow = { start: '2026-10-01', end: '2026-10-28' };
const COMPARE: GscReadWindow = { start: '2026-09-03', end: '2026-09-30' };
const MEG = 'https://www.marketingempiregroup.com';

function fact(partial: GscQueryPageFact): GscQueryPageFact {
    return partial;
}

/** Page totals from gsc_history_facts for this query, web, sc-domain:marketingempiregroup.com. */
function megAgencyFacts(): GscQueryPageFact[] {
    const current: [string, number, number, number][] = [
        [`${MEG}/temecula-ca`, 2, 23, 901],
        [`${MEG}/murrieta-ca`, 0, 14, 221],
        [`${MEG}/?utm_source=google&utm_medium=gbp&utm_id=temecula`, 0, 9, 69],
        [`${MEG}/carson-city-marketing?utm_source=google&utm_medium=gbp&utm_campaign=carson_city`, 0, 5, 85],
    ];
    const compare: [string, number, number, number][] = [
        [`${MEG}/temecula-ca`, 0, 186, 12292],
        [`${MEG}/?utm_source=google&utm_medium=gbp&utm_id=temecula`, 0, 160, 230],
        [`${MEG}/murrieta-ca`, 0, 51, 807],
        [`${MEG}/carson-city-marketing?utm_source=google&utm_medium=gbp&utm_campaign=carson_city`, 0, 2, 82],
    ];
    return [
        ...current.map(([page, clicks, impressions, weighted]) => fact({
            date: '2026-10-15',
            query: 'digital marketing agency',
            page,
            clicks,
            impressions,
            position: weighted / impressions,
            grain: 'query_page',
        })),
        ...compare.map(([page, clicks, impressions, weighted]) => fact({
            date: '2026-09-15',
            query: 'digital marketing agency',
            page,
            clicks,
            impressions,
            position: weighted / impressions,
            grain: 'query_page',
        })),
    ];
}

test('a zero-impression keyword is not measurable, not zero', () => {
    const rows = readTrackedKeywordGsc({
        keywords: [
            { id: 'zero', keyword: 'brand new service' },
            { id: 'missing', keyword: 'never returned' },
        ],
        current: CURRENT,
        compare: COMPARE,
        facts: [
            fact({
                date: '2026-10-10',
                query: 'brand new service',
                page: `${MEG}/`,
                clicks: 4,
                impressions: 0,
                position: 0,
                grain: 'query_page',
            }),
            fact({
                date: '2026-09-10',
                query: 'Brand   New   Service',
                page: `${MEG}/`,
                clicks: 0,
                impressions: 0,
                position: 0,
            }),
        ],
    });

    assert.equal(GSC_NOT_MEASURABLE, 'not measurable');
    for (const row of rows) {
        for (const window of [row.current, row.compare]) {
            assert.equal(window.status, 'not measurable');
            assert.equal(window.clicks, null);
            assert.equal(window.impressions, null);
            assert.equal(window.avgPosition, null);
            assert.equal(window.bestUrl, null);
            assert.notEqual(window.clicks, 0);
            assert.notEqual(window.impressions, 0);
            assert.notEqual(window.avgPosition, 0);
        }
    }
    assert.equal(JSON.stringify(rows).includes('"clicks":0'), false);
    assert.equal(JSON.stringify(rows).includes('"impressions":0'), false);
    assert.equal(JSON.stringify(rows).includes('"avgPosition":0'), false);
});

test('zero clicks with impressions stay a measured zero', () => {
    const [row] = readTrackedKeywordGsc({
        keywords: [{ id: 'seen', keyword: 'quiet term' }],
        current: CURRENT,
        compare: COMPARE,
        facts: [fact({
            date: '2026-10-04',
            query: 'quiet term',
            page: `${MEG}/seo-services`,
            clicks: 0,
            impressions: 12,
            position: 8,
        })],
    });
    assert.equal(row.current.status, 'measured');
    if (row.current.status !== 'measured') return;
    assert.equal(row.current.clicks, 0);
    assert.equal(row.current.impressions, 12);
    assert.equal(row.current.avgPosition, 8);
    assert.equal(row.current.bestUrl, `${MEG}/seo-services`);
    assert.equal(row.compare.status, 'not measurable');
});

test('MEG digital marketing agency matches Search Console page totals', () => {
    const [row] = readTrackedKeywordGsc({
        keywords: [{ id: 'meg', keyword: 'Digital   Marketing Agency' }],
        current: CURRENT,
        compare: COMPARE,
        facts: [
            ...megAgencyFacts(),
            fact({
                date: '2026-08-01',
                query: 'digital marketing agency',
                page: `${MEG}/temecula-ca`,
                clicks: 99,
                impressions: 999,
                position: 1,
                grain: 'query_page',
            }),
            fact({
                date: '2026-10-15',
                query: 'digital marketing agency',
                page: `${MEG}/ignored`,
                clicks: 50,
                impressions: 50,
                position: 1,
                grain: 'page',
            }),
        ],
    });

    assert.equal(row.normalizedKey, 'digital marketing agency');
    assert.deepEqual(row.current, {
        status: 'measured',
        clicks: 2,
        impressions: 51,
        avgPosition: 25,
        bestUrl: `${MEG}/`,
    });
    assert.deepEqual(row.compare, {
        status: 'measured',
        clicks: 0,
        impressions: 399,
        avgPosition: 33.6,
        bestUrl: `${MEG}/`,
    });
    assert.equal(normalizeUrl(`${MEG}/?utm_source=google&utm_medium=gbp&utm_id=temecula`)?.url, `${MEG}/`);
});

test('best URL is the lowest position after utm and fragment collapse, not the busiest page', () => {
    const services = `${MEG}/seo-services`;
    const [row] = readTrackedKeywordGsc({
        keywords: [{ id: 'best', keyword: 'seo services' }],
        current: CURRENT,
        compare: COMPARE,
        facts: [
            fact({
                date: '2026-10-02',
                query: 'seo services',
                page: `${services}?utm_source=google&utm_medium=cpc#viewer-k3f9a`,
                clicks: 1,
                impressions: 10,
                position: 4,
            }),
            fact({
                date: '2026-10-03',
                query: 'SEO   services',
                page: `${services}#viewer-zz91`,
                clicks: 0,
                impressions: 10,
                position: 8,
            }),
            fact({
                date: '2026-10-04',
                query: 'seo services',
                page: `${MEG}/blog`,
                clicks: 2,
                impressions: 100,
                position: 9,
            }),
            fact({
                date: '2026-10-05',
                query: 'seo services',
                page: 'not a url',
                clicks: 1,
                impressions: 5,
                position: 1,
            }),
        ],
    });

    assert.equal(row.current.status, 'measured');
    if (row.current.status !== 'measured') return;
    assert.equal(row.current.clicks, 4);
    assert.equal(row.current.impressions, 125);
    assert.equal(row.current.avgPosition, 8.2);
    assert.equal(row.current.bestUrl, services);
});

test('tied positions pick the URL with more impressions, then the earlier URL', () => {
    const [row] = readTrackedKeywordGsc({
        keywords: [{ id: 'tie', keyword: 'tie' }],
        current: CURRENT,
        compare: COMPARE,
        facts: [
            fact({ date: '2026-10-01', query: 'tie', page: `${MEG}/b`, clicks: 0, impressions: 10, position: 4 }),
            fact({ date: '2026-10-01', query: 'tie', page: `${MEG}/a`, clicks: 0, impressions: 10, position: 4 }),
            fact({ date: '2026-10-02', query: 'tie', page: `${MEG}/a`, clicks: 0, impressions: 1, position: 4 }),
        ],
    });
    assert.equal(row.current.status, 'measured');
    if (row.current.status !== 'measured') return;
    assert.equal(row.current.bestUrl, `${MEG}/a`);
    assert.equal(row.current.avgPosition, 4);
});

interface RecordedCall {
    table: string;
    filters: { op: string; column: string; value: unknown }[];
}

function scriptedAdmin(respond: (call: RecordedCall) => { data: unknown; error: { message?: string } | null }): {
    admin: SearchReportingAdmin;
    calls: RecordedCall[];
} {
    const calls: RecordedCall[] = [];
    const admin = {
        from(table: string) {
            const filters: RecordedCall['filters'] = [];
            const call = { table, filters };
            calls.push(call);
            const api = {
                select() { return api; },
                eq(column: string, value: unknown) { filters.push({ op: 'eq', column, value }); return api; },
                gte(column: string, value: unknown) { filters.push({ op: 'gte', column, value }); return api; },
                lte(column: string, value: unknown) { filters.push({ op: 'lte', column, value }); return api; },
                in(column: string, value: readonly unknown[]) { filters.push({ op: 'in', column, value: [...value] }); return api; },
                order() { return api; },
                async range() { return respond(call); },
                async maybeSingle() { return respond(call); },
            };
            return api;
        },
    };
    return { admin: admin as unknown as SearchReportingAdmin, calls };
}

test('the loader reads query_page facts only when keyword tracking is on', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    const scope = {
        organizationId: '11111111-1111-4111-8111-111111111111',
        clientId: '33333333-3333-4333-8333-333333333333',
    };
    const keywords = [{ id: 'kw', keyword: 'SEO Agency' }];
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        const off = scriptedAdmin(() => { throw new Error('should not read'); });
        const disabled = await loadTrackedKeywordGsc({
            ...scope,
            keywords,
            current: CURRENT,
            compare: COMPARE,
            client: off.admin,
        });
        assert.deepEqual(disabled, { enabled: false });
        assert.equal(off.calls.length, 0);

        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
        const invalid = await loadTrackedKeywordGsc({
            ...scope,
            keywords,
            current: { start: '2026-10-28', end: '2026-10-01' },
            compare: COMPARE,
            client: off.admin,
        });
        assert.equal(invalid.enabled, true);
        assert.equal(invalid.ok, false);
        assert.equal(off.calls.length, 0);

        const empty = scriptedAdmin(() => { throw new Error('should not read'); });
        const noKeywords = await loadTrackedKeywordGsc({
            ...scope,
            keywords: [],
            current: CURRENT,
            compare: COMPARE,
            client: empty.admin,
        });
        assert.deepEqual(noKeywords, {
            enabled: true,
            ok: true,
            connected: null,
            rows: [],
            cannibalization: { tracked: 0, affected: null, health: null, keywords: [] },
        });
        assert.equal(empty.calls.length, 0);

        const unavailable = await loadTrackedKeywordGsc({
            ...scope,
            keywords,
            current: CURRENT,
            compare: COMPARE,
            client: null,
        });
        assert.deepEqual(unavailable, { enabled: true, ok: false, error: 'Keyword tracking is unavailable.' });

        const disconnected = scriptedAdmin(() => ({ data: { site_url: '  ' }, error: null }));
        const missingProperty = await loadTrackedKeywordGsc({
            ...scope,
            keywords,
            current: CURRENT,
            compare: COMPARE,
            client: disconnected.admin,
        });
        assert.equal(missingProperty.enabled && missingProperty.ok && missingProperty.connected, false);
        if (missingProperty.enabled && missingProperty.ok) {
            assert.equal(missingProperty.rows[0]?.current.status, 'not measurable');
            assert.equal(missingProperty.rows[0]?.current.clicks, null);
            assert.equal(missingProperty.cannibalization.health, null);
            assert.equal(missingProperty.cannibalization.affected, null);
            assert.equal(missingProperty.cannibalization.tracked, 1);
        }
        assert.deepEqual(disconnected.calls.map(call => call.table), ['client_integrations']);

        const days = [
            { id: 'day-gap', data_date: '2026-09-20' },
            { id: 'day-compare', data_date: '2026-09-15' },
            { id: 'day-current', data_date: '2026-10-15T00:00:00+00:00' },
            ...Array.from({ length: 6 }, (_, index) => ({ id: `day-extra-${index}`, data_date: '2026-10-16' })),
        ];
        const live = scriptedAdmin(call => {
            if (call.table === 'client_integrations') {
                return { data: { site_url: 'sc-domain:marketingempiregroup.com' }, error: null };
            }
            if (call.table === 'gsc_history_days') return { data: days, error: null };
            const requested = call.filters.find(filter => filter.column === 'day_id')?.value;
            const dayIds = Array.isArray(requested) ? requested : [];
            const rows = [{
                day_id: 'day-current',
                grain: 'query_page',
                query: 'seo agency',
                page: `${MEG}/seo-services?utm_source=newsletter`,
                clicks: '3',
                impressions: '10',
                position: '4.24',
            }, {
                day_id: 'day-compare',
                grain: 'query_page',
                query: 'seo agency',
                page: `${MEG}/seo-services`,
                clicks: 0,
                impressions: 0,
                position: 0,
            }].filter(row => dayIds.includes(row.day_id));
            return { data: rows, error: null };
        });
        const loaded = await loadTrackedKeywordGsc({
            ...scope,
            keywords,
            current: CURRENT,
            compare: { start: '2026-09-03', end: '2026-09-16' },
            client: live.admin,
        });
        assert.equal(loaded.enabled && loaded.ok, true);
        if (!loaded.enabled || !loaded.ok) return;
        assert.equal(loaded.connected, true);
        assert.equal(loaded.rows[0]?.current.status, 'measured');
        if (loaded.rows[0]?.current.status === 'measured') {
            assert.equal(loaded.rows[0].current.clicks, 3);
            assert.equal(loaded.rows[0].current.impressions, 10);
            assert.equal(loaded.rows[0].current.avgPosition, 4.2);
            assert.equal(loaded.rows[0].current.bestUrl, `${MEG}/seo-services`);
        }
        assert.equal(loaded.rows[0]?.compare.status, 'not measurable');
        assert.equal(loaded.rows[0]?.compare.clicks, null);
        assert.equal(loaded.cannibalization.tracked, 1);
        assert.equal(loaded.cannibalization.affected, 0);
        assert.equal(loaded.cannibalization.health, 1);
        assert.deepEqual(loaded.cannibalization.keywords, []);

        const factCalls = live.calls.filter(call => call.table === 'gsc_history_facts');
        assert.equal(factCalls.length, 2);
        for (const call of factCalls) {
            assert.equal(call.filters.find(filter => filter.column === 'grain' && filter.op === 'eq')?.value, 'query_page');
            const queries = call.filters.find(filter => filter.column === 'query')?.value;
            assert.ok(Array.isArray(queries));
            assert.equal(queries.includes('seo agency'), true);
            assert.equal(queries.includes('SEO Agency'), true);
            const dayIds = call.filters.find(filter => filter.column === 'day_id')?.value;
            assert.ok(Array.isArray(dayIds));
            assert.equal(dayIds.includes('day-gap'), false);
            assert.equal(dayIds.length <= 7, true);
        }
        assert.equal(factCalls.flatMap(call => call.filters.find(filter => filter.column === 'day_id')?.value as string[]).includes('day-current'), true);
        const dayCall = live.calls.find(call => call.table === 'gsc_history_days');
        assert.equal(dayCall?.filters.find(filter => filter.column === 'property')?.value, 'sc-domain:marketingempiregroup.com');
        assert.equal(dayCall?.filters.find(filter => filter.column === 'organization_id')?.value, scope.organizationId);
        assert.equal(dayCall?.filters.find(filter => filter.op === 'gte')?.value, '2026-09-03');
        assert.equal(dayCall?.filters.find(filter => filter.op === 'lte')?.value, '2026-10-28');

        const failing = scriptedAdmin(() => ({ data: null, error: { message: 'timeout' } }));
        const logged: unknown[][] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => { logged.push(args); };
        try {
            const failed = await loadTrackedKeywordGsc({
                ...scope,
                keywords,
                current: CURRENT,
                compare: COMPARE,
                client: failing.admin,
            });
            assert.deepEqual(failed, {
                enabled: true,
                ok: false,
                error: 'Could not read Search Console history for tracked keywords.',
            });
        } finally {
            console.error = original;
        }
        assert.deepEqual(logged, [['Could not read Search Console history for tracked keywords.']]);

        const truncated = scriptedAdmin(call => {
            if (call.table === 'client_integrations') return { data: { site_url: 'sc-domain:example.com' }, error: null };
            if (call.table === 'gsc_history_days') return { data: [{ id: 'day-current', data_date: '2026-10-15' }], error: null };
            return { data: Array.from({ length: 1000 }, () => ({ day_id: 'day-current', grain: 'query_page', query: 'seo agency', page: `${MEG}/`, clicks: 1, impressions: 1, position: 1 })), error: null };
        });
        console.error = (...args: unknown[]) => { logged.push(args); };
        try {
            const partial = await loadTrackedKeywordGsc({
                ...scope,
                keywords,
                current: CURRENT,
                compare: COMPARE,
                client: truncated.admin,
            });
            assert.equal(partial.ok, false);
            if (partial.enabled && partial.ok) {
                assert.fail('a truncated fact read must not become not measurable');
            }
        } finally {
            console.error = original;
        }
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});
