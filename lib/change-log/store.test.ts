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
    const ranges: { table: string; start: number; order: string[]; grain?: unknown }[] = [];
    const db = {
        from(table: string) {
            const filters: ((row: Row) => boolean)[] = [];
            const order: string[] = [];
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
                in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
                gte(key: string, value: string) { filters.push(row => String(row[key]) >= value); return query; },
                lte(key: string, value: string) { filters.push(row => String(row[key]) <= value); return query; },
                order(key: string) { order.push(key); return query; },
                limit(value: number) { to = Math.min(value, 1000) - 1; return query; },
                range(start: number, end: number) {
                    ranges.push({ table, start, order: [...order], grain });
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
    assert.deepEqual(gsc.ranges.filter(range => range.grain === 'page').map(range => [range.start, range.order]),
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
