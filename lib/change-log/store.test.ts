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

function database(tables: Record<string, Row[]>) {
    const writes: Row[] = [];
    const factRanges: number[][] = [];
    const db = {
        from(table: string) {
            const filters: ((row: Row) => boolean)[] = [];
            const order: string[] = [];
            let from = 0;
            let to = 999;
            let patch: Row | undefined;
            function result() {
                const matched = (tables[table] ?? []).filter(row => filters.every(filter => filter(row)));
                matched.sort((a, b) => order.reduce((cmp, key) => cmp || String(a[key]).localeCompare(String(b[key])), 0));
                const data = matched.slice(from, to + 1);
                if (patch) for (const row of data) {
                    writes.push(patch);
                    Object.assign(row, patch);
                }
                return { data, error: null };
            }
            const query = {
                select() { return query; },
                eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query; },
                in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query; },
                gte(key: string, value: string) { filters.push(row => String(row[key]) >= value); return query; },
                lte(key: string, value: string) { filters.push(row => String(row[key]) <= value); return query; },
                order(key: string) { order.push(key); return query; },
                limit(value: number) { to = Math.min(value, 1000) - 1; return query; },
                range(start: number, end: number) {
                    if (table === 'gsc_history_facts') factRanges.push([start, end, order.length]);
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
    return { read: () => getChange('org', 'client', 'change', now, db), writes, factRanges };
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

test('a saved 26-day baseline updates only when the full window is final, then stays frozen', async () => {
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
    const db = database({
        ...seed('gsc'),
        gsc_history_days: days,
        gsc_history_facts: facts,
        seo_change_baselines: [snapshot],
    });
    assert.equal((await db.read()).baselineNote, '26 of 28 days');
    assert.equal(db.writes.length, 0);
    days[26].is_incomplete = false;
    assert.equal((await db.read()).baselineNote, '26 of 28 days');
    assert.equal(db.writes.length, 0);
    days[27].is_incomplete = false;
    const repaired = await db.read();
    assert.equal(repaired.impact?.baseline.daysPresent, 28);
    assert.match(repaired.baselineNote ?? '', /^Starting point saved from stored/);
    assert.equal(snapshot.status, 'captured');
    assert.equal(snapshot.estimate, false);
    assert.equal(snapshot.payload.daysPresent, 28);
    assert.equal(snapshot.data_through, '2026-11-09');
    assert.equal(db.writes.length, 1);
    facts[0].clicks = 3;
    assert.equal((await db.read()).impact?.baseline.clicks, 30);
    assert.equal(db.writes.length, 1);
});

test('change-log facts read past the PostgREST page cap', async () => {
    const day = {
        ...scope, id: 'day', data_date: baselineDates[0], property: 'sc-domain:example.com', search_type: 'web',
    };
    const db = database({
        ...seed('gsc'),
        gsc_history_days: [day],
        gsc_history_facts: Array.from({ length: 1001 }, (_, i) => ({
            day_id: day.id, row_key: `row-${i}`, grain: 'page', page: url, clicks: 1, impressions: 2, position: 3,
        })),
    });
    const { impact } = await db.read();
    assert.equal(impact?.baseline.clicks, 1001);
    assert.ok(db.factRanges.some(([start, end, orders]) => start === 1000 && end === 1999 && orders >= 2));
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
