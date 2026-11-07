/**
 * Run with: node --import tsx --test lib/keyword-tracking/brand.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BrandClickSummary, BrandTermsCard, RankingsPanel, RankingsTab } from '../../components/workspace/RankingsTab.tsx';
import { GSC_NOT_MEASURABLE } from './gsc-read.ts';
import { formatMeasuredCount } from './rankings.ts';
import {
    queryContainsBrandTerm,
    queryIsBranded,
    splitBrandClicks,
    type BrandClickSplit,
    type BrandOverride,
    type BrandQueryClicks,
} from './brand.ts';
import { loadBrandClicks } from './brand-clicks.ts';
import { addBrandTerm, loadBrandTerms, removeBrandTerm, updateBrandTerm, type BrandTermClient } from './brand-store.ts';
import type { SearchReportingAdmin } from '../search-reporting/load.ts';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

/**
 * Click-bearing Search Console queries for Marketing Empire Group,
 * sc-domain:marketingempiregroup.com, 2026-10-06 through 2026-11-02.
 * Property clicks in that window were 136. Zero-click queries are omitted;
 * they do not change the sums.
 */
const MEG_QUERIES: BrandQueryClicks[] = [
    { query: 'marketing empire group', clicks: 26 },
    { query: 'marketing empire', clicks: 6 },
    { query: 'empire marketing group', clicks: 4 },
    { query: 'the industrial revolution and its influence on marketing.', clicks: 3 },
    { query: '1 link', clicks: 1 },
    { query: 'branding agency', clicks: 1 },
    { query: 'capcut vs premiere pro vs davinci resolve', clicks: 1 },
    { query: 'digital marketing agency', clicks: 1 },
    { query: 'digital marketing agency in california', clicks: 1 },
    { query: 'digital marketing agency reno', clicks: 1 },
    { query: 'digital medical marketing', clicks: 1 },
    { query: 'inland empire marketing', clicks: 1 },
    { query: 'marketing companies in california', clicks: 1 },
    { query: 'marketing company', clicks: 1 },
    { query: 'marketingempiregroup.com', clicks: 1 },
    { query: 'riverside business marketing', clicks: 1 },
    { query: 'the golden age of advertising', clicks: 1 },
];

function assertIdentity(split: BrandClickSplit) {
    if (split.queryClicks == null || split.branded == null || split.nonBranded == null) {
        assert.equal(split.branded, null);
        assert.equal(split.nonBranded, null);
        assert.equal(split.queryClicks, null);
        assert.equal(split.unattributed, null);
        return;
    }
    assert.equal(split.branded + split.nonBranded, split.queryClicks);
    if (split.propertyClicks == null) {
        assert.equal(split.unattributed, null);
        return;
    }
    assert.equal(split.unattributed, split.propertyClicks - split.queryClicks);
}

test('a brand term matches a whole phrase after tracker normalization', () => {
    assert.equal(queryContainsBrandTerm('Marketing Empire Group', '  marketing   EMPIRE '), true);
    assert.equal(queryContainsBrandTerm('empire marketing group', 'marketing empire'), false);
    assert.equal(queryContainsBrandTerm('inland empire marketing', 'marketing empire'), false);
    assert.equal(queryContainsBrandTerm('marketingempiregroup.com', 'marketing empire'), false);
    assert.equal(queryContainsBrandTerm('marketingempiregroup.com', 'marketingempiregroup.com'), true);
    assert.equal(queryContainsBrandTerm('the meg agency', 'meg'), true);
    assert.equal(queryContainsBrandTerm('omega', 'meg'), false);
    assert.equal(queryContainsBrandTerm('marketing.', 'marketing'), false);
    assert.equal(queryContainsBrandTerm('seo agency', ''), false);
    assert.equal(queryContainsBrandTerm('', 'brand'), false);
});

test('every lexicon kind can brand a query, and an override wins only for that query', () => {
    const terms = [
        { term: 'Marketing Empire', kind: 'brand' as const },
        { term: 'marketting empire', kind: 'misspelling' as const },
        { term: 'Carlos Morones', kind: 'owner' as const },
        { term: 'Empire OS', kind: 'product' as const },
    ];
    assert.equal(queryIsBranded('marketing empire group', terms, []), true);
    assert.equal(queryIsBranded('marketting empire reviews', terms, []), true);
    assert.equal(queryIsBranded('carlos morones seo', terms, []), true);
    assert.equal(queryIsBranded('buy empire os', terms, []), true);
    assert.equal(queryIsBranded('seo agency', terms, []), false);

    const forcedOff: BrandOverride[] = [{ normalizedKey: 'Marketing Empire Group', branded: false }];
    assert.equal(queryIsBranded('marketing empire group', terms, forcedOff), false);
    assert.equal(queryIsBranded('marketing empire', terms, forcedOff), true);

    const forcedOn: BrandOverride[] = [{ normalizedKey: 'seo agency', branded: true }];
    assert.equal(queryIsBranded('seo agency', terms, forcedOn), true);
    assert.equal(queryIsBranded('seo agency temecula', terms, forcedOn), false);

    const conflict: BrandOverride[] = [
        { normalizedKey: 'seo agency', branded: true },
        { normalizedKey: 'seo agency', branded: false },
    ];
    assert.equal(queryIsBranded('seo agency', [], conflict), false);
    assert.equal(queryIsBranded('seo agency', terms, conflict), false);
});

test('unattributed clicks are property clicks minus visible query clicks, including a negative remainder', () => {
    const empty = splitBrandClicks({
        propertyClicks: 136,
        queries: MEG_QUERIES,
        terms: [],
        overrides: [],
    });
    assertIdentity(empty);
    assert.equal(empty.branded, 0);
    assert.equal(empty.nonBranded, 52);
    assert.equal(empty.queryClicks, 52);
    assert.equal(empty.unattributed, 84);
    assert.equal(empty.propertyClicks, 136);

    const named = splitBrandClicks({
        propertyClicks: 136,
        queries: MEG_QUERIES,
        terms: [{ term: 'Marketing Empire' }],
        overrides: [],
    });
    assertIdentity(named);
    assert.equal(named.branded, 32);
    assert.equal(named.nonBranded, 20);
    assert.equal(named.unattributed, 84);

    const override = splitBrandClicks({
        propertyClicks: 136,
        queries: MEG_QUERIES,
        terms: [{ term: 'Marketing Empire' }],
        overrides: [{ normalizedKey: 'marketing empire group', branded: false }],
    });
    assertIdentity(override);
    assert.equal(override.branded, 6);
    assert.equal(override.nonBranded, 46);
    assert.equal(override.unattributed, 84);

    const negative = splitBrandClicks({
        propertyClicks: 10,
        queries: [{ query: 'seo agency', clicks: 12 }],
        terms: [],
        overrides: [],
    });
    assertIdentity(negative);
    assert.equal(negative.unattributed, -2);
    assert.equal(formatMeasuredCount(negative.unattributed), '-2');
    assert.notEqual(formatMeasuredCount(negative.unattributed), '0');
    assert.notEqual(formatMeasuredCount(negative.unattributed), GSC_NOT_MEASURABLE);

    const measuredZero = splitBrandClicks({
        propertyClicks: 0,
        queries: [],
        terms: [{ term: 'Marketing Empire' }],
        overrides: [],
    });
    assertIdentity(measuredZero);
    assert.equal(measuredZero.branded, 0);
    assert.equal(measuredZero.nonBranded, 0);
    assert.equal(measuredZero.unattributed, 0);
    assert.equal(formatMeasuredCount(measuredZero.branded), '0');
});

test('a missing click is not coerced to zero', () => {
    const missingQuery = splitBrandClicks({
        propertyClicks: 10,
        queries: [
            { query: 'seo agency', clicks: 4 },
            { query: 'marketing empire', clicks: null },
        ],
        terms: [{ term: 'marketing empire' }],
        overrides: [],
    });
    assertIdentity(missingQuery);
    assert.equal(missingQuery.branded, null);
    assert.equal(missingQuery.nonBranded, null);
    assert.equal(missingQuery.unattributed, null);
    assert.equal(JSON.stringify(missingQuery).includes(':0'), false);

    const missingProperty = splitBrandClicks({
        propertyClicks: null,
        queries: [{ query: 'seo agency', clicks: 0 }],
        terms: [],
        overrides: [],
    });
    assert.equal(missingProperty.branded, 0);
    assert.equal(missingProperty.nonBranded, 0);
    assert.equal(missingProperty.queryClicks, 0);
    assert.equal(missingProperty.unattributed, null);
    assert.equal(missingProperty.propertyClicks, null);

    const unread = splitBrandClicks({
        propertyClicks: 10,
        queries: null,
        terms: [],
        overrides: [],
    });
    assertIdentity(unread);
    assert.equal(unread.propertyClicks, 10);
    assert.equal(formatMeasuredCount(unread.branded), GSC_NOT_MEASURABLE);
    assert.equal(formatMeasuredCount(unread.unattributed), GSC_NOT_MEASURABLE);
});

function metric(html: string, name: string): string | undefined {
    return html.match(new RegExp(`data-metric="${name}"[^>]*>([^<]+)`))?.[1]?.trim();
}

function panel(split: BrandClickSplit | null, terms: { id: string; term: string; kind: 'brand'; normalizedKey: string }[] = []) {
    return renderToStaticMarkup(createElement(RankingsPanel, {
        keywords: [],
        notes: [],
        cap: 50,
        draft: '',
        message: '',
        error: '',
        loading: false,
        busy: false,
        periodLabel: 'Last 28 days · Oct 6 – Nov 2, 2026',
        onDraft() {},
        onSubmit() {},
        terms,
        clickSplit: split,
    }));
}

test('the rankings surface shows the click split and brand terms without a distribution tab', () => {
    const split = splitBrandClicks({
        propertyClicks: 136,
        queries: MEG_QUERIES,
        terms: [],
        overrides: [],
    });
    const html = panel(split);
    assert.match(html, /Brand terms/);
    assert.match(html, /No brand terms yet/);
    assert.match(html, /Add term/);
    assert.match(html, /Search Console clicks/);
    assert.match(html, /Last 28 days · Oct 6 – Nov 2, 2026/);
    assert.equal(metric(html, 'branded'), '0');
    assert.equal(metric(html, 'non-branded'), '52');
    assert.equal(metric(html, 'unattributed'), '84');
    assert.equal(html.includes('>Distribution<'), false);
    assert.equal(html.includes('NEXT_PUBLIC'), false);
    assert.equal(/semrush|google ads/i.test(html), false);

    const negative = panel(splitBrandClicks({
        propertyClicks: 10,
        queries: [{ query: 'seo agency', clicks: 12 }],
        terms: [],
        overrides: [],
    }));
    assert.equal(metric(negative, 'unattributed'), '-2');
    assert.equal(metric(negative, 'unattributed') === '0', false);

    const missing = panel(splitBrandClicks({
        propertyClicks: null,
        queries: null,
        terms: [],
        overrides: [],
    }));
    assert.equal(metric(missing, 'branded'), GSC_NOT_MEASURABLE);
    assert.equal(metric(missing, 'non-branded'), GSC_NOT_MEASURABLE);
    assert.equal(metric(missing, 'unattributed'), GSC_NOT_MEASURABLE);
    assert.equal(metric(missing, 'branded') === '0', false);

    const saved = renderToStaticMarkup(createElement(BrandTermsCard, {
        terms: [{ id: 'term-1', term: 'Marketing Empire', kind: 'brand', normalizedKey: 'marketing empire' }],
        loading: false,
        busy: false,
        message: '',
        error: '',
        onAdd() { return false; },
        onUpdate() { return false; },
        onRemove() { return false; },
    }));
    assert.match(saved, /data-brand-term="Marketing Empire"/);
    assert.match(saved, /data-brand-kind="brand"/);
    assert.match(saved, />Remove</);
    assert.match(saved, /Misspelling/);
    assert.match(saved, /Owner/);
    assert.match(saved, /Product/);

    const summary = renderToStaticMarkup(createElement(BrandClickSummary, {
        loading: true,
        split: null,
        periodLabel: '',
        detail: '',
        note: '',
    }));
    assert.equal(summary.includes('>0<'), false);
    assert.match(summary, /data-metric="branded">…/);
});

const SCOPE = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    clientId: '33333333-3333-4333-8333-333333333333',
};

test('keyword tracking off makes no Supabase calls for brand terms or clicks', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    const calls: string[] = [];
    const client = {
        from(table: string) {
            calls.push(table);
            throw new Error(`should not read ${table}`);
        },
    };
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        const terms = await loadBrandTerms({ ...SCOPE, client: client as unknown as BrandTermClient });
        const added = await addBrandTerm({ ...SCOPE, term: 'Marketing Empire', kind: 'brand', client: client as unknown as BrandTermClient });
        const clicks = await loadBrandClicks({
            ...SCOPE,
            window: { start: '2026-10-06', end: '2026-11-02' },
            client: client as unknown as SearchReportingAdmin,
        });
        assert.deepEqual(terms, { ok: true, terms: [] });
        assert.equal(added.ok, false);
        assert.deepEqual(clicks, { enabled: false });
        assert.deepEqual(calls, []);
        const html = renderToStaticMarkup(createElement(RankingsTab, SCOPE));
        assert.equal(html, '');
        const tab = readFileSync(new URL('../../components/workspace/RankingsTab.tsx', import.meta.url), 'utf8');
        const refresh = tab.slice(tab.indexOf('const refresh = useCallback'), tab.indexOf('useEffect(() =>'));
        assert.match(refresh, /if \(!keywordTrackingEnabled\(\)\) return;/);
        assert.ok(refresh.indexOf('loadBrandTerms(') > refresh.indexOf('keywordTrackingEnabled()'));
        assert.ok(refresh.indexOf('loadBrandClicks(') > refresh.indexOf('loadRankingWindows('));
        assert.ok(refresh.indexOf('loadTrackedKeywordGsc(') > refresh.indexOf('loadBrandClicks('));
        assert.equal(tab.includes('createClient('), false);
        assert.equal(tab.includes('service_role'), false);
        assert.equal(tab.includes('>Distribution<'), false);
        for (const name of ['brand.ts', 'brand-store.ts', 'brand-clicks.ts']) {
            const source = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
            assert.equal(source.includes('service_role'), false, name);
            assert.equal(source.includes('createAdminClient'), false, name);
            assert.equal(source.includes('dataforseo'), false, name);
        }
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

interface RecordedFilter {
    op: string;
    column: string;
    value: unknown;
}

function clickClient(input: {
    days: Record<string, unknown>[];
    facts: Record<string, unknown>[];
    keywords?: Record<string, unknown>[];
    connected?: boolean;
    calls: { table: string; filters: RecordedFilter[] }[];
}): SearchReportingAdmin {
    return {
        from(table: string) {
            const filters: RecordedFilter[] = [];
            const api = {
                select() { return api; },
                eq(column: string, value: unknown) { filters.push({ op: 'eq', column, value }); return api; },
                gte() { return api; },
                lte() { return api; },
                in(column: string, value: unknown) { filters.push({ op: 'in', column, value }); return api; },
                order() { return api; },
                async maybeSingle() {
                    input.calls.push({ table, filters: [...filters] });
                    if (input.connected === false) return { data: null, error: null };
                    return { data: { site_url: 'sc-domain:marketingempiregroup.com' }, error: null };
                },
                async range() {
                    input.calls.push({ table, filters: [...filters] });
                    const rows = table === 'gsc_history_days'
                        ? input.days
                        : table === 'tracked_keywords'
                            ? input.keywords ?? []
                            : input.facts.filter(row => filters.every(filter => {
                                if (filter.op === 'eq') return row[filter.column] === filter.value;
                                if (filter.op === 'in' && Array.isArray(filter.value)) return filter.value.includes(row[filter.column]);
                                return true;
                            }));
                    return { data: rows, error: null };
                },
            };
            return api;
        },
    };
}

test('the click loader sums stored property and query rows and keeps a missing day unmeasured', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    const calls: { table: string; filters: RecordedFilter[] }[] = [];
    const days = [
        { id: 'day-1', data_date: '2026-10-06', is_incomplete: false, query_limited: false },
        { id: 'day-2', data_date: '2026-10-07', is_incomplete: false, query_limited: false },
    ];
    const facts = [
        { day_id: 'day-1', grain: 'property', query: '', clicks: 10 },
        { day_id: 'day-2', grain: 'property', query: '', clicks: '5' },
        { day_id: 'day-1', grain: 'query_page', query: 'Marketing Empire', clicks: 4 },
        { day_id: 'day-2', grain: 'query_page', query: 'seo agency', clicks: 6 },
        { day_id: 'day-2', grain: 'page', query: '', clicks: 99 },
    ];
    try {
        const loaded = await loadBrandClicks({
            ...SCOPE,
            window: { start: '2026-10-06', end: '2026-10-07' },
            client: clickClient({ days, facts, keywords: [{ normalized_key: 'seo agency', is_branded_override: false }], calls }),
        });
        assert.equal(loaded.enabled && loaded.ok && loaded.connected, true);
        if (!loaded.enabled || !loaded.ok || !loaded.connected || !loaded.measurement) return;
        const split = splitBrandClicks({
            propertyClicks: loaded.measurement.propertyClicks,
            queries: loaded.measurement.queries,
            terms: [{ term: 'marketing empire' }],
            overrides: loaded.measurement.overrides,
        });
        assertIdentity(split);
        assert.equal(split.propertyClicks, 15);
        assert.equal(split.branded, 4);
        assert.equal(split.nonBranded, 6);
        assert.equal(split.unattributed, 5);
        assert.deepEqual(loaded.measurement.overrides, [{ normalizedKey: 'seo agency', branded: false }]);
        const factCalls = calls.filter(call => call.table === 'gsc_history_facts');
        const grains = factCalls.flatMap(call => call.filters.filter(filter => filter.column === 'grain').flatMap(filter => filter.value as string[]));
        assert.deepEqual(grains.sort(), ['property', 'query_page']);
        assert.equal(calls.some(call => call.table === 'metrics'), false);

        calls.length = 0;
        const gap = await loadBrandClicks({
            ...SCOPE,
            window: { start: '2026-10-06', end: '2026-10-07' },
            client: clickClient({ days: [days[0]], facts, calls }),
        });
        assert.equal(gap.enabled && gap.ok && gap.connected, true);
        if (!gap.enabled || !gap.ok || !gap.connected) return;
        assert.equal(gap.measurement?.propertyClicks, null);
        assert.equal(gap.measurement?.queries, null);
        assert.match(gap.detail, /missing days/);
        assert.equal(calls.some(call => call.table === 'gsc_history_facts'), false);
        const hidden = splitBrandClicks({
            propertyClicks: gap.measurement?.propertyClicks ?? null,
            queries: gap.measurement?.queries ?? null,
            terms: [],
            overrides: [],
        });
        assert.equal(hidden.branded, null);
        assert.equal(hidden.unattributed, null);
        assert.equal(formatMeasuredCount(hidden.branded), GSC_NOT_MEASURABLE);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('a null query click and a failed read are not stored as zero', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logs.push(args); };
    try {
        const calls: { table: string; filters: RecordedFilter[] }[] = [];
        const days = [{ id: 'day-1', data_date: '2026-10-06', is_incomplete: false, query_limited: false }];
        const loaded = await loadBrandClicks({
            ...SCOPE,
            window: { start: '2026-10-06', end: '2026-10-06' },
            client: clickClient({
                days,
                facts: [
                    { day_id: 'day-1', grain: 'property', query: '', clicks: 8 },
                    { day_id: 'day-1', grain: 'query_page', query: 'seo agency', clicks: null },
                ],
                calls,
            }),
        });
        assert.equal(loaded.enabled && loaded.ok, true);
        if (!loaded.enabled || !loaded.ok || !loaded.connected || !loaded.measurement) return;
        const split = splitBrandClicks({
            propertyClicks: loaded.measurement.propertyClicks,
            queries: loaded.measurement.queries,
            terms: [],
            overrides: [],
        });
        assert.equal(split.queryClicks, null);
        assert.equal(split.branded, null);
        assert.equal(split.nonBranded, null);
        assert.equal(split.unattributed, null);
        assert.equal(JSON.stringify(split).includes(':0'), false);

        calls.length = 0;
        const limited = await loadBrandClicks({
            ...SCOPE,
            window: { start: '2026-10-06', end: '2026-10-06' },
            client: clickClient({
                days: [{ id: 'day-1', data_date: '2026-10-06', is_incomplete: false, query_limited: true }],
                facts: [
                    { day_id: 'day-1', grain: 'property', query: '', clicks: 8 },
                    { day_id: 'day-1', grain: 'query_page', query: 'seo agency', clicks: 3 },
                ],
                calls,
            }),
        });
        if (!limited.enabled || !limited.ok || !limited.connected || !limited.measurement) return;
        assert.equal(limited.measurement.queries, null);
        assert.equal(limited.measurement.propertyClicks, 8);
        assert.match(limited.detail, /incomplete/);
        const limitedGrains = calls.filter(call => call.table === 'gsc_history_facts')
            .flatMap(call => call.filters.filter(filter => filter.column === 'grain').flatMap(filter => filter.value as string[]));
        assert.deepEqual(limitedGrains, ['property']);
        const limitedSplit = splitBrandClicks({
            propertyClicks: limited.measurement.propertyClicks,
            queries: limited.measurement.queries,
            terms: [],
            overrides: limited.measurement.overrides,
        });
        assert.equal(limitedSplit.branded, null);
        assert.equal(limitedSplit.unattributed, null);
        assert.equal(formatMeasuredCount(limitedSplit.unattributed), GSC_NOT_MEASURABLE);

        const broken = {
            from() {
                throw new Error('secret query text and token');
            },
        };
        const failed = await loadBrandClicks({
            ...SCOPE,
            window: { start: '2026-10-06', end: '2026-10-06' },
            client: broken as unknown as SearchReportingAdmin,
        });
        assert.deepEqual(failed, { enabled: true, ok: false, error: 'Could not read Search Console clicks.' });
        assert.deepEqual(logs, [['Could not read Search Console clicks.']]);
        assert.equal(JSON.stringify(logs).includes('secret'), false);
    } finally {
        console.error = original;
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

function termClient(store: { rows: Record<string, unknown>[] }): BrandTermClient {
    return {
        from(table: string) {
            if (table !== 'client_brand_terms') throw new Error(`unexpected ${table}`);
            let action: 'select' | 'insert' | 'update' | 'delete' = 'select';
            let payload: Record<string, unknown> = {};
            const filters: Record<string, unknown> = {};
            const result = () => {
                if (action === 'insert') {
                    const term = String(payload.term);
                    const normalized = term.trim().toLowerCase().replace(/\s+/g, ' ');
                    if (store.rows.some(row => row.normalized_key === normalized)) {
                        return { data: null, error: { code: '23505', message: `duplicate ${term}` } };
                    }
                    const row = { id: `id-${store.rows.length + 1}`, ...payload, normalized_key: normalized };
                    store.rows.push(row);
                    return { data: null, error: null };
                }
                const matches = store.rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
                if (action === 'update') {
                    if (matches.length === 1) Object.assign(matches[0], payload);
                    return { data: matches.map(row => ({ id: row.id })), error: null };
                }
                if (action === 'delete') {
                    store.rows = store.rows.filter(row => !matches.includes(row));
                    return { data: matches.map(row => ({ id: row.id })), error: null };
                }
                return { data: matches, error: null };
            };
            const api = {
                select() { return api; },
                insert(row: Record<string, unknown>) { action = 'insert'; payload = row; return api; },
                update(row: Record<string, unknown>) { action = 'update'; payload = row; return api; },
                delete() { action = 'delete'; return api; },
                eq(column: string, value: unknown) { filters[column] = value; return api; },
                order() { return api; },
                range() { return Promise.resolve(result()); },
                then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
                    return Promise.resolve(result()).then(resolve, reject);
                },
            };
            return api;
        },
    };
}

test('brand terms can be added, edited, and removed without logging the term', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { logs.push(args); };
    const store = { rows: [] as Record<string, unknown>[] };
    const client = termClient(store);
    try {
        const added = await addBrandTerm({ ...SCOPE, term: '  Marketing   Empire ', kind: 'brand', client });
        assert.equal(added.ok, true);
        const duplicate = await addBrandTerm({ ...SCOPE, term: 'marketing empire', kind: 'product', client });
        assert.equal(duplicate.ok, false);
        assert.equal(duplicate.message, 'That term is already in the list.');
        assert.equal(JSON.stringify(logs).includes('Marketing'), false);
        const listed = await loadBrandTerms({ ...SCOPE, client });
        assert.equal(listed.ok, true);
        if (!listed.ok) return;
        assert.equal(listed.terms.length, 1);
        assert.equal(listed.terms[0]?.term, 'Marketing Empire');
        assert.equal(listed.terms[0]?.kind, 'brand');
        const saved = await updateBrandTerm({
            ...SCOPE,
            id: listed.terms[0].id,
            term: 'Empire OS',
            kind: 'product',
            client,
        });
        assert.equal(saved.message, 'Saved.');
        const removed = await removeBrandTerm({ ...SCOPE, id: listed.terms[0].id, client });
        assert.equal(removed.message, 'Removed.');
        const empty = await loadBrandTerms({ ...SCOPE, client });
        assert.equal(empty.ok && empty.terms.length, 0);
        const invalid = await addBrandTerm({ ...SCOPE, term: '   ', kind: 'brand', client });
        assert.equal(invalid.ok, false);
        assert.equal(store.rows.length, 0);
    } finally {
        console.error = original;
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});
