import assert from 'node:assert/strict';
import test from 'node:test';
import { dateOffset } from '@/lib/gsc/history';
import { queryDaysFromFacts } from './facts';
import { buildResultsTable } from './results';
import { ControlMigrationRequired, getChange, listChanges, updateControlPages } from './store';

type Row = Record<string, unknown>;
const now = new Date('2026-11-23T20:00:00Z');
const scope = { organization_id: 'org', client_id: 'client' };
const url = 'https://example.com/';
const baselineDates = Array.from({ length: 28 }, (_, i) => dateOffset('2026-10-13', i));

function database(tables: Record<string, Row[]>, options: {
    controlColumn?: boolean;
    maxRows?: number;
    beforeBaselineUpdate?: () => void;
    positionRows?: Row[];
    positionError?: { code?: string; message?: string };
} = {}) {
    const { controlColumn = true, maxRows = 1000, beforeBaselineUpdate } = options;
    const writes: Row[] = [];
    const ranges: { table: string; start: number; order: string[]; grain?: unknown; inFilters: Record<string, unknown[]>; tagged: boolean }[] = [];
    const rpcCalls: { name: string; args: Row }[] = [];
    const db = {
        async rpc(name: string, args: Row) {
            rpcCalls.push({ name, args });
            return { data: options.positionRows ?? [], error: options.positionError ?? null };
        },
        from(table: string) {
            const filters: ((row: Row) => boolean)[] = [];
            const order: { key: string; ascending: boolean }[] = [];
            const inFilters: Record<string, unknown[]> = {};
            let from = 0;
            let to = 999;
            let patch: Row | undefined;
            let grain: unknown;
            let tagged = false;
            function result() {
                if (!controlColumn && patch && 'control_urls' in patch) {
                    return { data: [], error: { code: 'PGRST204', message: 'Could not find control_urls in the schema cache' } };
                }
                if (patch && table === 'seo_change_baselines') beforeBaselineUpdate?.();
                const matched = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
                matched.sort((a, b) => {
                    for (const { key, ascending } of order) {
                        const cmp = String(a[key]).localeCompare(String(b[key]));
                        if (cmp !== 0) return ascending ? cmp : -cmp;
                    }
                    return 0;
                });
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
                    tagged = key === 'page';
                    const expression = new RegExp(pattern.split('%').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');
                    filters.push(row => expression.test(String(row[key])));
                    return query;
                },
                gte(key: string, value: string) { filters.push(row => String(row[key]) >= value); return query; },
                lte(key: string, value: string) { filters.push(row => String(row[key]) <= value); return query; },
                lt(key: string, value: string) { filters.push(row => String(row[key]) < value); return query; },
                order(key: string, { ascending = true } = {}) { order.push({ key, ascending }); return query; },
                limit(value: number) { to = Math.min(value, 1000) - 1; return query; },
                range(start: number, end: number) {
                    ranges.push({ table, start, order: order.map(({ key }) => key), grain, inFilters: { ...inFilters }, tagged });
                    from = start;
                    to = end;
                    return query;
                },
                update(values: Row) { patch = values; return query; },
                async maybeSingle() { const { data, error } = result(); return { data: data[0] ?? null, error }; },
                then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
            };
            return query;
        },
    } as unknown as NonNullable<Parameters<typeof getChange>[4]>;
    return {
        read: (readAt = now) => getChange('org', 'client', 'change', readAt, db),
        list: () => listChanges('org', 'client', now, db),
        saveControls: (urls: unknown, client = 'client') => updateControlPages('org', client, 'change', urls, db),
        writes,
        ranges,
        rpcCalls,
    };
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
    const db = database(tables, {
        beforeBaselineUpdate: () => Object.assign(snapshot, {
            captured_at: '2026-11-23T20:00:00Z', status: 'captured', estimate: false,
            note: 'Complete baseline', payload: { daysPresent: 28, daysExpected: 28 }, data_through: '2026-11-09',
        }),
    });
    assert.equal((await db.read()).baselineNote, 'Complete baseline');
    assert.equal(db.writes.length, 0);
});

test('a complete baseline refresh retries if a concurrent partial refresh wins first', async () => {
    const { tables, days, snapshot } = baselineSeed();
    days[26].is_incomplete = false;
    days[27].is_incomplete = false;
    const db = database(tables, {
        beforeBaselineUpdate: () => {
            if (snapshot.payload.daysPresent === 26) Object.assign(snapshot, {
                captured_at: '2026-11-23T20:00:00.000Z', payload: { daysPresent: 27, daysExpected: 28 },
            });
        },
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
    }, { maxRows: 300 });
    assert.equal((await gsc.read()).impact?.baseline.clicks, 601);
    assert.deepEqual(gsc.ranges.filter(range => range.grain === 'page' && range.inFilters.page).map(range => [range.start, range.order]),
        [0, 300, 600, 601].map(start => [start, ['day_id', 'row_key']]));

    const ga4 = database({
        ...seed('ga4'),
        ga4_history_days: [{ ...scope, id: 'final', property: 'properties/1', day: baselineDates[0], is_final: true }],
        ga4_landing_page_days: Array.from({ length: 601 }, (_, id) => ({
            ...scope, id, day_id: 'final', day: baselineDates[0], landing_page_norm: '/', organic_sessions: 1,
        })),
    }, { maxRows: 300 });
    assert.equal((await ga4.read()).impact?.baseline.organicSessions, 601);
    assert.deepEqual(ga4.ranges.filter(range => range.table === 'ga4_landing_page_days').map(range => [range.start, range.order]),
        [0, 300, 600, 601].map(start => [start, ['id']]));
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

const pavers = 'https://example.com/pavers';
const landscaping = 'https://example.com/landscaping';

function controlsSeed(kpi = 'avg_position') {
    const tables = seed('gsc');
    const after = Array.from({ length: 7 }, (_, i) => dateOffset('2026-11-11', i));
    const days = [...baselineDates, '2026-11-10', ...after];
    return {
        ...tables,
        seo_changes: [{ ...tables.seo_changes[0], title: 'Homepage heading', kpi, control_urls: [] as string[], compare_last_year: false }],
        gsc_history_days: days.map(data_date => ({
            ...scope, id: data_date, data_date, property: 'sc-domain:example.com', search_type: 'web', page_limited: false,
        })),
        gsc_history_facts: days.flatMap(day_id => [
            { day_id, grain: 'property', clicks: 100, impressions: 5000, position: 8 },
            { day_id, grain: 'page', page: url, clicks: 20, impressions: 1000, position: 2 },
            { day_id, grain: 'page', page: 'http://www.example.com/about/', clicks: 5, impressions: 500, position: 5 },
            { day_id, grain: 'page', page: 'https://www.example.com/ABOUT?ref=test', clicks: 5, impressions: 500, position: 1 },
            { day_id, grain: 'page', page: pavers, clicks: 2, impressions: 100, position: 20 },
            { day_id, grain: 'page', page: landscaping, clicks: 6, impressions: 300, position: 40 },
        ]),
    };
}

function positionRows(dates: string[]) {
    return dates.map(data_date => ({ data_date, clicks: 8, impressions: 400, position_weight: 14000 }));
}

test('the list reads rest-of-site position for the eight newest eligible changes and detail still reads a skipped change', async () => {
    const tables = controlsSeed();
    const recent = Array.from({ length: 7 }, (_, i) => ({
        id: `recent-${i}`,
        liveAt: `2026-11-10T23:1${i}:00Z`,
    }));
    const changes = [
        { id: 'tied-z', liveAt: '2026-11-10T23:00:00Z' },
        ...recent,
        { id: 'tied-a', liveAt: '2026-11-10T23:00:00Z' },
        { id: 'clicks', liveAt: '2026-11-10T23:30:00Z', kpi: 'clicks' },
        { id: 'picked', liveAt: '2026-11-10T23:30:00Z', controls: [pavers] },
    ];
    for (const { id, liveAt, kpi, controls } of changes) {
        const page = `https://example.com/${id}`;
        tables.seo_changes.push({
            ...tables.seo_changes[0], id, live_at: liveAt, kpi: kpi ?? 'avg_position', control_urls: controls ?? [],
        });
        tables.seo_change_pages.push({ change_id: id, url: page, url_key: `example.com/${id}` });
        tables.gsc_history_facts.push(...tables.gsc_history_days.map(({ id: day_id }) => ({
            day_id, grain: 'page', page, clicks: 20, impressions: 1000, position: day_id < '2026-11-10' ? 8 : 2,
        })));
    }
    const db = database(tables, { positionRows: positionRows(tables.gsc_history_days.map(day => day.data_date)) });
    const { items, impacts } = await db.list();

    const selected = [...recent.map(({ id }) => id).reverse(), 'tied-a'];
    assert.equal(db.rpcCalls.length, 8);
    assert.ok(db.rpcCalls.every(call => call.name === 'seo_change_rest_position'));
    assert.deepEqual(db.rpcCalls.map(call => call.args.p_excluded_page_keys), selected.map(id => [`example.com/${id}`]));
    for (const id of selected) {
        assert.equal(impacts[id].headline.controlMode, 'untouched');
        assert.equal(items.find(item => item.id === id)?.verdict, 'improved');
    }
    for (const id of ['tied-z', 'change']) {
        assert.equal(impacts[id].headline.controlMode, 'none');
        assert.equal(impacts[id].headline.control, null);
        assert.ok(impacts[id].series.every(point => point.controlPosition === null));
        assert.equal(items.find(item => item.id === id)?.verdict, null);
    }
    assert.equal(impacts.picked.headline.controlMode, 'picked');
    assert.ok(db.ranges.every(range => range.grain !== 'page' || range.inFilters.page));

    const { impact } = await db.read();
    assert.equal(db.rpcCalls.length, 9);
    assert.deepEqual(db.rpcCalls[8].args.p_excluded_page_keys, ['example.com/']);
    assert.equal(impact?.headline.controlMode, 'untouched');
    assert.equal(impact?.headline.control?.position, 35);
});

test('the detail reads position once for at most 84 final days and makes no unfiltered page reads', async () => {
    const tables = controlsSeed();
    tables.seo_change_pages.push({ change_id: 'change', url: 'https://example.com/about', url_key: 'example.com/about' });
    tables.seo_changes[0].compare_last_year = true;
    const days = [...baselineDates, ...Array.from({ length: 56 }, (_, i) => dateOffset('2026-11-11', i))];
    tables.gsc_history_days.push(...['2025-11-01', ...days.slice(35), '2027-01-06'].map(data_date => ({
        ...tables.gsc_history_days[0], id: data_date, data_date,
    })));
    const position = positionRows(days);
    position[0] = { data_date: days[0], clicks: 8, impressions: 1200, position_weight: 18000 };
    const small = database(tables, { positionRows: position });
    const readAt = new Date('2027-01-10T20:00:00Z');
    const { impact } = await small.read(readAt);
    assert.equal(impact?.controlLabel, 'Rest of the site');
    assert.equal(impact?.headline.controlMode, 'untouched');
    assert.equal(impact?.headline.controlMove?.before, 33);
    assert.equal(impact?.headline.controlMove?.after, 35);
    assert.equal(impact?.headline.sitewide?.position, 8);
    assert.equal(impact?.series.find(point => point.date === '2026-11-11')?.controlPosition, 35);
    assert.equal(impact?.series.find(point => point.date === '2026-11-10')?.control, null);
    assert.deepEqual(small.rpcCalls, [{
        name: 'seo_change_rest_position',
        args: {
            p_organization_id: 'org', p_client_id: 'client', p_property: 'sc-domain:example.com',
            p_day_ids: days, p_excluded_page_keys: ['example.com/', 'example.com/about'],
        },
    }]);

    tables.gsc_history_facts.push(...Array.from({ length: 5000 }, (_, i) => ({
        day_id: days[0], grain: 'page', page: `https://example.com/unrelated-${i}`,
        clicks: 1, impressions: 20, position: 50,
    })));
    const large = database(tables, { positionRows: position });
    await large.read(readAt);
    const factReads = (db: typeof small) => db.ranges.filter(range => range.table === 'gsc_history_facts');
    assert.equal(factReads(large).length, factReads(small).length);
    assert.ok(factReads(large).every(range => range.grain !== 'page' || range.inFilters.page || range.tagged));
    assert.deepEqual(large.rpcCalls, small.rpcCalls);
});

test('a missing position RPC leaves control position unavailable without loading all pages', async () => {
    for (const positionError of [
        { code: 'PGRST202' }, { code: '42883' },
        { message: 'Could not find the function public.seo_change_rest_position in the schema cache' },
    ]) {
        const db = database(controlsSeed(), { positionError });
        const { impact, setup } = await db.read();
        assert.equal(setup, 'ready');
        assert.equal(impact?.headline.page.position, 2);
        assert.equal(impact?.headline.controlMode, 'none');
        assert.equal(impact?.headline.control, null);
        assert.equal(impact?.headline.sitewide?.position, 8);
        assert.ok(impact?.series.every(point => point.controlPosition === null));
        assert.equal(db.rpcCalls.length, 1);
        assert.equal((await db.list()).items[0]?.verdict, null);
        assert.equal(db.rpcCalls.length, 2);
        assert.ok(db.ranges.every(range => range.grain !== 'page' || range.inFilters.page || range.tagged));
    }
});

test('a non-position list skips the RPC while its detail loads it for the position chart', async () => {
    const tables = controlsSeed('clicks');
    const db = database(tables, { positionRows: positionRows(['2026-11-11']) });
    await db.list();
    assert.equal(db.rpcCalls.length, 0);
    const { impact } = await db.read();
    assert.equal(impact?.series.find(point => point.date === '2026-11-11')?.controlPosition, 35);
    assert.equal(db.rpcCalls.length, 1);

    tables.seo_changes[0].kpi = 'avg_position';
    await db.list();
    assert.equal(db.rpcCalls.length, 2);
});

test('saved controls replace the default in the checkpoint, the results table and the chart', async () => {
    const tables = controlsSeed('clicks');
    const db = database(tables);
    assert.deepEqual(await db.saveControls([pavers, landscaping]), { status: 'saved' });
    const { change, impact } = await db.read();
    assert.ok(impact);
    assert.deepEqual(change?.controlUrls, [pavers, landscaping]);
    assert.equal(impact.controlLabel, 'Selected control pages');
    assert.equal(impact.headline.controlMode, 'picked');
    assert.deepEqual([impact.headline.control?.clicks, impact.headline.control?.impressions, impact.headline.control?.position], [56, 2800, 35]);
    assert.equal(impact.headline.controlMove?.after, 8);
    const comparison = buildResultsTable(impact).rows.find(row => row.id === 'rest_clicks');
    assert.deepEqual([comparison?.label, comparison?.before, comparison?.after], ['Selected control page clicks', 8, 8]);
    const point = impact.series.find(item => item.date === '2026-11-11');
    assert.deepEqual([point?.control, point?.controlPosition], [8, 35]);
    assert.equal(db.rpcCalls.length, 0);
    await db.saveControls([]);
    assert.equal((await db.read()).impact?.headline.controlMove?.after, 80);
});

test('edits reject test and off-site pages and scope the write to the client', async () => {
    const db = database(controlsSeed());
    assert.deepEqual(await db.saveControls(['http://www.example.com/?ref=other']), {
        status: 'invalid', error: "A control page can't be a page in this test.",
    });
    assert.deepEqual(await db.saveControls(['https://other.example.com/pavers']), {
        status: 'invalid', error: 'Control pages must be on the same site as the test pages.',
    });
    assert.deepEqual(await db.saveControls([pavers], 'other-client'), { status: 'missing' });
    assert.deepEqual(db.writes, []);
});

test('an older schema reads the default control and asks for the migration only when saving picks', async () => {
    const db = database(seed('gsc'), { controlColumn: false });
    assert.deepEqual((await db.read()).change?.controlUrls, []);
    await assert.rejects(db.saveControls([pavers]), ControlMigrationRequired);
    assert.deepEqual(await db.saveControls([]), { status: 'saved' });
});

test('detail overlap includes both windows, matches the logged site and labels the affected pages', async () => {
    const tables = controlsSeed();
    tables.seo_changes[0].control_urls = [pavers];
    const changes = [
        { id: 'early', date: '2026-10-12', page: url },
        { id: 'baseline-edge', date: '2026-10-13', page: url },
        { id: 'redirect', date: '2026-11-02', page: 'http://www.example.com/?one=two' },
        { id: 'pavers', date: '2026-11-16', page: 'https://www.example.com/pavers/' },
        { id: 'off-site', date: '2026-11-16', page: 'https://other.example.com/pavers' },
        { id: 'other-client', date: '2026-11-16', page: pavers, client_id: 'other' },
        { id: 'after-edge', date: '2027-01-05', page: landscaping },
        { id: 'late', date: '2027-01-06', page: url },
    ];
    for (const item of changes) {
        tables.seo_changes.push({
            ...tables.seo_changes[0], id: item.id, title: item.id, live_at: `${item.date}T20:00:00Z`,
            client_id: item.client_id ?? scope.client_id,
        });
        tables.seo_change_pages.push({ change_id: item.id, url: item.page, url_key: item.page });
    }
    const { confounders } = await database(tables).read();
    assert.deepEqual(confounders.map(item => [item.id, item.overlap, item.touchesTestPage, item.touchesControlPage]), [
        ['baseline-edge', 'baseline', true, false],
        ['redirect', 'baseline', true, false],
        ['pavers', 'after', false, true],
        ['after-edge', 'after', false, false],
    ]);
    tables.seo_changes[0].control_urls = [];
    assert.equal((await database(tables).read()).confounders.find(item => item.id === 'after-edge')?.touchesControlPage, true);
});
