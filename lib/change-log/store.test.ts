import assert from 'node:assert/strict';
import test from 'node:test';
import { dateOffset } from '@/lib/gsc/history';
import { queryDaysFromFacts } from './facts';
import { getChange } from './store';

type Row = Record<string, unknown>;
const now = new Date('2026-11-23T20:00:00Z');
const scope = { organization_id: 'org', client_id: 'client' };
const url = 'https://example.com/';
const baselineDates = Array.from({ length: 28 }, (_, i) => dateOffset('2026-10-13', i));

function database(tables: Record<string, Row[]>, maxRows = 1000, beforeBaselineUpdate?: () => void) {
    const writes: Row[] = [];
    const ranges: { table: string; start: number; order: string[]; grain?: unknown; inFilters: Record<string, unknown[]> }[] = [];
    const db = {
        from(table: string) {
            const filters: ((row: Row) => boolean)[] = [];
            const order: string[] = [];
            const inFilters: Record<string, unknown[]> = {};
            let from = 0;
            let to = 999;
            let patch: Row | undefined;
            let grain: unknown;
            function result() {
                if (patch && table === 'seo_change_baselines') beforeBaselineUpdate?.();
                const matched = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
                matched.sort((a, b) => order.reduce((cmp, key) => cmp || String(a[key]).localeCompare(String(b[key])), 0));
                const data = matched.slice(from, Math.min(to + 1, from + maxRows));
                if (patch) for (const row of data) {
                    writes.push(patch);
                    Object.assign(row, patch);
                }
                return { data: data.map(row => ({ ...row })), error: null };
            }
            const query = {
                select() { return query; },
                eq(key: string, value: unknown) {
                    filters.push(row => row[key] === value);
                    if (key === 'grain') grain = value;
                    return query;
                },
                in(key: string, values: unknown[]) {
                    filters.push(row => values.includes(row[key]));
                    inFilters[key] = values;
                    return query;
                },
                ilike(key: string, pattern: string) {
                    const expression = new RegExp(pattern.split('%').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');
                    filters.push(row => expression.test(String(row[key])));
                    return query;
                },
                gte(key: string, value: string) { filters.push(row => String(row[key]) >= value); return query; },
                lte(key: string, value: string) { filters.push(row => String(row[key]) <= value); return query; },
                order(key: string) { order.push(key); return query; },
                limit(value: number) { to = Math.min(value, 1000) - 1; return query; },
                range(start: number, end: number) {
                    ranges.push({ table, start, order: [...order], grain, inFilters: { ...inFilters } });
                    from = start;
                    to = end;
                    return query;
                },
                update(values: Row) { patch = values; return query; },
                async maybeSingle() { return { data: result().data[0] ?? null, error: null }; },
                then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
            };
            return query;
        },
    } as unknown as NonNullable<Parameters<typeof getChange>[4]>;
    return { read: () => getChange('org', 'client', 'change', now, db), writes, ranges };
}

function seed(service: 'gsc' | 'ga4') {
    return {
        seo_changes: [{
            ...scope, id: 'change', live_at: '2026-11-10T22:04:00Z', change_type: 'h1',
            kpi: service === 'gsc' ? 'clicks' : 'organic_sessions',
        }],
        seo_change_pages: [{ change_id: 'change', url, url_key: 'example.com/' }],
        client_integrations: [{ ...scope, service, site_url: 'sc-domain:example.com', property_id: 'properties/1' }],
    };
}

test('a non-final GA4 landing page day is excluded from scoring and another property cannot supply it', async () => {
    const days = baselineDates.slice(-2);
    const db = database({
        ...seed('ga4'),
        ga4_history_days: [
            { ...scope, id: 'final', property: 'properties/1', day: days[0], is_final: true },
            { ...scope, id: 'open', property: 'properties/1', day: days[1], is_final: false },
        ],
        ga4_landing_page_days: [
            { ...scope, day_id: 'final', day: days[0], landing_page_norm: '/', organic_sessions: 4 },
            { ...scope, day_id: 'open', day: days[1], landing_page_norm: '/', organic_sessions: 50 },
            { ...scope, day_id: 'other-property', day: days[0], landing_page_norm: '/', organic_sessions: 100 },
        ],
    });
    const { impact } = await db.read();
    assert.equal(impact?.baseline.daysPresent, 1);
    assert.equal(impact?.baseline.organicSessions, 4);
});

function baselineSeed() {
    const days = baselineDates.map((data_date, i) => ({
        ...scope, id: `day-${i}`, property: 'sc-domain:example.com', search_type: 'web', data_date, is_incomplete: i >= 26,
    }));
    const snapshot = {
        ...scope, change_id: 'change', status: 'partial', estimate: true, note: '26 of 28 days',
        payload: { daysPresent: 26, daysExpected: 28 },
        captured_at: '2026-11-10T23:00:00Z', data_through: '2026-11-07',
    };
    const facts = days.map(day => ({
        day_id: day.id, row_key: day.id, grain: 'page', page: url, clicks: 1, impressions: 10, position: 3,
    }));
    const tables = {
        ...seed('gsc'),
        gsc_history_days: days,
        gsc_history_facts: facts,
        seo_change_baselines: [snapshot],
    };
    return { tables, days, snapshot, facts };
}

test('a saved 26-day baseline advances to 27 and then 28 final days, with no update at equal coverage', async () => {
    const { tables, days, snapshot, facts } = baselineSeed();
    const db = database(tables);
    assert.equal((await db.read()).baselineNote, '26 of 28 days');
    assert.equal(db.writes.length, 0);
    days[26].is_incomplete = false;
    assert.match((await db.read()).baselineNote ?? '', /27 of 28 days/);
    assert.equal(snapshot.status, 'partial');
    assert.equal(snapshot.estimate, true);
    assert.equal(snapshot.payload.daysPresent, 27);
    assert.equal(db.writes.length, 1);
    assert.match((await db.read()).baselineNote ?? '', /27 of 28 days/);
    assert.equal(db.writes.length, 1);
    days[27].is_incomplete = false;
    const repaired = await db.read();
    assert.equal(repaired.impact?.baseline.daysPresent, 28);
    assert.match(repaired.baselineNote ?? '', /^Starting point saved from stored/);
    assert.equal(snapshot.status, 'captured');
    assert.equal(snapshot.estimate, false);
    assert.equal(snapshot.payload.daysPresent, 28);
    assert.equal(snapshot.data_through, '2026-11-09');
    assert.equal(db.writes.length, 2);
    assert.ok(db.writes[1].captured_at as string > (db.writes[0].captured_at as string));
    facts[0].clicks = 3;
    assert.equal((await db.read()).impact?.baseline.clicks, 30);
    assert.equal(db.writes.length, 2);
});

test('a concurrent complete baseline wins over a stale partial refresh', async () => {
    const { tables, days, snapshot } = baselineSeed();
    days[26].is_incomplete = false;
    const db = database(tables, 1000, () => Object.assign(snapshot, {
        captured_at: '2026-11-23T20:00:00Z', status: 'captured', estimate: false,
        note: 'Complete baseline', payload: { daysPresent: 28, daysExpected: 28 }, data_through: '2026-11-09',
    }));
    assert.equal((await db.read()).baselineNote, 'Complete baseline');
    assert.equal(db.writes.length, 0);
});

test('a complete baseline refresh retries if a concurrent partial refresh wins first', async () => {
    const { tables, days, snapshot } = baselineSeed();
    days[26].is_incomplete = false;
    days[27].is_incomplete = false;
    const db = database(tables, 1000, () => {
        if (snapshot.payload.daysPresent === 26) Object.assign(snapshot, {
            captured_at: '2026-11-23T20:00:00.000Z', payload: { daysPresent: 27, daysExpected: 28 },
        });
    });
    assert.match((await db.read()).baselineNote ?? '', /^Starting point saved from stored/);
    assert.equal(snapshot.payload.daysPresent, 28);
    assert.equal(db.writes.length, 1);
});

test('change-log GSC and GA4 page reads advance by the returned rows until an empty page', async () => {
    const day = {
        ...scope, id: 'day', data_date: baselineDates[0], property: 'sc-domain:example.com', search_type: 'web',
    };
    const gsc = database({
        ...seed('gsc'),
        gsc_history_days: [day],
        gsc_history_facts: Array.from({ length: 601 }, (_, i) => ({
            day_id: day.id, row_key: `row-${i}`, grain: 'page', page: url, clicks: 1, impressions: 2, position: 3,
        })),
    }, 300);
    assert.equal((await gsc.read()).impact?.baseline.clicks, 601);
    assert.deepEqual(gsc.ranges.filter(range => range.grain === 'page' && range.inFilters.page).map(range => [range.start, range.order]),
        [0, 300, 600, 601].map(start => [start, ['day_id', 'row_key']]));

    const ga4 = database({
        ...seed('ga4'),
        ga4_history_days: [{ ...scope, id: 'final', property: 'properties/1', day: baselineDates[0], is_final: true }],
        ga4_landing_page_days: Array.from({ length: 601 }, (_, id) => ({
            ...scope, id, day_id: 'final', day: baselineDates[0], landing_page_norm: '/', organic_sessions: 1,
        })),
    }, 300);
    assert.equal((await ga4.read()).impact?.baseline.organicSessions, 601);
    assert.deepEqual(ga4.ranges.map(range => [range.table, range.start, range.order]), [0, 300, 600, 601]
        .map(start => ['ga4_landing_page_days', start, ['id']]));
});

test('query facts keep a day preliminary if any matched row is preliminary', () => {
    const date = baselineDates[0];
    const row = {
        grain: 'query_page', page: url, query: 'example', clicks: 1, impressions: 2, position: 3, surface: null,
    };
    const results = queryDaysFromFacts(
        [{ id: 'final', date, preliminary: false }, { id: 'open', date, preliminary: true }],
        [{ ...row, dayId: 'final' }, { ...row, dayId: 'open' }], [url], 'example',
    );
    assert.equal(results[0]?.preliminary, true);
    assert.equal(results[0]?.clicks, 2);
});

test('detail uses stored query-page rows for sparse terms, suggestions and competing pages', async () => {
    const days = [...baselineDates, ...Array.from({ length: 8 }, (_, i) => dateOffset('2026-11-10', i))];
    const term = 'hardscape contractors corona';
    const another = 'landscape contractors corona';
    const competing = 'https://example.com/corona-ca/';
    const queryFact = (day_id: string, page: string, query: string, impressions: number, position: number) => ({
        day_id, row_key: `${page}:${query}`, grain: 'query_page', page, query, impressions, position,
    });
    const db = database({
        ...seed('gsc'),
        seo_change_queries: [term, another].map(query => ({ change_id: 'change', query, normalized_query: query })),
        gsc_history_days: days.map(data_date => ({
            ...scope, id: data_date, data_date, property: 'sc-domain:example.com', search_type: 'web',
        })),
        gsc_history_facts: [
            ...days.map(day_id => ({ day_id, grain: 'page', page: url, clicks: 1, impressions: 30, position: 12 })),
            queryFact(days[0], url, term, 7, 12),
            queryFact('2026-11-10', url, term, 99, 1),
            queryFact('2026-11-11', url, term, 1, 12),
            queryFact(days[0], competing, term, 30, 2),
            queryFact(days[0], url, 'hardscape contractors', 93, 10.4),
            queryFact(days[0], url, 'landscaping corona', 28, 6),
            queryFact(days[0], competing, 'off-page suggestion', 150, 2),
        ],
    });
    const { impact } = await db.read();
    const context = impact?.searchTermContext;
    assert.deepEqual(context?.warnings.map(item => [item.query, item.before, item.after]), [[term, 7, 1], [another, 0, 0]]);
    assert.deepEqual(context?.warnings[0].betterPages, [{ period: 'before', url: competing, position: 2, pagePosition: 12 }]);
    assert.deepEqual(context?.suggestions, [
        { query: 'hardscape contractors', impressions: 93, position: 10.4 },
        { query: 'landscaping corona', impressions: 28, position: 6 },
    ]);
});

test('detail flags the Ecoworkz ranking page when the homepage has no rows for either tracked term', async () => {
    const homepage = 'https://www.ecoworkz.net/';
    const competing = 'https://www.ecoworkz.net/corona-ca/';
    const queries = ['corona landscaping', 'landscape contractors corona'];
    const after = Array.from({ length: 7 }, (_, i) => dateOffset('2026-11-11', i));
    const days = [...baselineDates, ...after];
    const db = database({
        ...seed('gsc'),
        seo_change_pages: [{ change_id: 'change', url: homepage, url_key: 'ecoworkz.net/' }],
        seo_change_queries: queries.map(query => ({ change_id: 'change', query, normalized_query: query })),
        client_integrations: [{ ...scope, service: 'gsc', site_url: 'sc-domain:ecoworkz.net' }],
        gsc_history_days: days.map(data_date => ({
            ...scope, id: data_date, data_date, property: 'sc-domain:ecoworkz.net', search_type: 'web',
        })),
        gsc_history_facts: [
            ...days.map(day_id => ({ day_id, grain: 'page', page: homepage, clicks: 1, impressions: 30, position: 12 })),
            ...queries.flatMap(query => [
                { day_id: baselineDates[0], page: competing, impressions: 30, position: 2 },
                { day_id: after[0], page: competing, impressions: 20, position: 2.1 },
                { day_id: baselineDates[0], page: `${homepage}?utm_campaign=gbp_listing`, impressions: 50, position: 1 },
                { day_id: baselineDates[0], page: 'https://example.com/corona-ca/', impressions: 50, position: 1 },
            ].map(row => ({ ...row, row_key: `${row.page}:${query}`, grain: 'query_page', query }))),
        ],
    });
    const { impact } = await db.read();
    assert.deepEqual(impact?.searchTermContext?.warnings, queries.map(query => ({
        query, before: 0, after: 0,
        betterPages: [
            { period: 'before', url: competing, position: 2, pagePosition: null },
            { period: 'after', url: competing, position: 2.1, pagePosition: null },
        ],
    })));
});

test('detail reads unfiltered page queries only for baseline days and filters tracked queries after go-live', async () => {
    const after = Array.from({ length: 7 }, (_, i) => dateOffset('2026-11-11', i));
    const query = 'landscape contractors corona';
    const db = database({
        ...seed('gsc'),
        seo_change_queries: [{ change_id: 'change', query, normalized_query: query }],
        gsc_history_days: [...baselineDates, '2026-11-10', ...after].map(data_date => ({
            ...scope, id: data_date, data_date, property: 'sc-domain:example.com', search_type: 'web',
        })),
    });
    await db.read();
    const pageQueries = db.ranges.filter(range => range.grain === 'query_page' && range.inFilters.page);
    assert.deepEqual(pageQueries.filter(range => !range.inFilters.query).flatMap(range => range.inFilters.day_id), baselineDates);
    const tracked = pageQueries.filter(range => range.inFilters.query);
    assert.deepEqual(tracked.flatMap(range => range.inFilters.day_id), after);
    for (const range of tracked) assert.deepEqual(range.inFilters.query, [query]);
});

test('GBP-tagged page facts are visible separately from the main page, including final zero days', async () => {
    const after = Array.from({ length: 7 }, (_, i) => dateOffset('2026-11-11', i));
    const days = [...baselineDates, '2026-11-10', ...after];
    const fact = (day_id: string, page: string, clicks: number, impressions: number, position: number, surface = 'organic') => ({
        day_id, row_key: page, grain: 'page', page, clicks, impressions, position, surface,
    });
    const gbp = 'http://www.example.com/?utm_campaign=gbp_listing&utm_source=maps';
    const db = database({
        ...seed('gsc'),
        gsc_history_days: days.map(data_date => ({
            ...scope, id: data_date, data_date, property: 'sc-domain:example.com', search_type: 'web', page_limited: false,
        })),
        gsc_history_facts: [
            ...days.map(day => fact(day, url, day > '2026-11-10' || baselineDates.slice(0, 9).includes(day) ? 1 : 0, 25, 18)),
            fact(baselineDates[0], gbp, 18, 1378, 8, 'gbp_link'),
            fact(after[0], 'https://example.com/?utm_medium=organic&utm_source=google', 7, 245, 7),
            fact(after[0], 'https://example.com/?utm_medium=email&utm_source=google', 100, 500, 1),
            fact(after[0], 'https://example.com/other/?utm_campaign=gbp_listing', 100, 500, 1),
            fact('2026-11-10', gbp, 100, 500, 1),
        ],
    });
    const { change, impact } = await db.read();
    assert.equal(change?.kpi, 'clicks');
    assert.equal(impact?.kpi, 'impressions');
    assert.equal(impact?.lowClickBaseline, 9);
    assert.deepEqual([impact?.baseline.clicks, impact?.headline.page.clicks], [9, 7]);
    assert.deepEqual([impact?.baseline.impressions, impact?.headline.page.impressions], [700, 175]);
    assert.deepEqual(
        [impact?.gbp?.before, impact?.gbp?.after].map(read => [read?.clicks, read?.impressions, read?.position, read?.daysPresent]),
        [[18, 1378, 8, 28], [7, 245, 7, 7]],
    );
});
