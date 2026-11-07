/**
 * Run with: node --import tsx --test lib/keyword-tracking/report-snapshot.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { SearchReportingAdmin } from '../search-reporting/load.ts';
import { widgetLibrary } from '../reports/blocks.ts';
import {
    captureTrackedKeywordSnapshot,
    freezeTrackedKeywordReport,
    loadDraftTrackedKeywordReport,
    parseTrackedKeywordReportSnapshot,
    TRACKING_SNAPSHOT_EMPTY,
    TRACKING_SNAPSHOT_UNAVAILABLE,
} from './report-snapshot.ts';

const ORG = '11111111-1111-4111-8111-111111111111';
const CLIENT = '33333333-3333-4333-8333-333333333333';
const REPORT = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-11-07T20:00:00.000Z');

const KEYWORDS = [
    { id: 'kw-emergency', keyword: 'emergency dentist', source: 'paste' },
    { id: 'kw-cleaning', keyword: 'teeth cleaning', source: 'paste' },
    { id: 'kw-guard', keyword: 'night guard', source: 'paste' },
];

function facts(clicks: number) {
    return [
        {
            day_id: 'day-1',
            grain: 'query_page',
            query: 'emergency dentist',
            page: 'https://example.com/emergency',
            clicks,
            impressions: 20,
            position: 5,
        },
        {
            day_id: 'day-1',
            grain: 'query_page',
            query: 'teeth cleaning',
            page: 'https://example.com/cleaning',
            clicks: 0,
            impressions: 8,
            position: 3,
        },
    ];
}

interface RecordedCall {
    table: string;
}

function scriptedAdmin(respond: (call: RecordedCall) => { data: unknown; error: { message?: string } | null }): {
    admin: SearchReportingAdmin;
    calls: RecordedCall[];
} {
    const calls: RecordedCall[] = [];
    const admin = {
        from(table: string) {
            const call = { table };
            calls.push(call);
            const api = {
                select() { return api; },
                eq() { return api; },
                gte() { return api; },
                lte() { return api; },
                in() { return api; },
                order() { return api; },
                async range() { return respond(call); },
                async maybeSingle() { return respond(call); },
            };
            return api;
        },
    };
    return { admin: admin as unknown as SearchReportingAdmin, calls };
}

function sections() {
    return { version: 2, blocks: [{ id: 'tracked', type: 'tracked_keywords_gsc', props: {} }] };
}

test('the flag off skips keyword and Search Console reads', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        const reader = scriptedAdmin(() => { throw new Error('should not read'); });
        const captured = await captureTrackedKeywordSnapshot({
            report: { id: REPORT, organization_id: ORG, client_id: CLIENT, sections: sections() },
            now: NOW,
            client: reader.admin,
            write: async () => { throw new Error('should not write'); },
        });
        assert.deepEqual(captured, { ok: true, skipped: 'flag', snapshot: null });
        assert.equal(reader.calls.length, 0);
        const draft = await loadDraftTrackedKeywordReport({
            organizationId: ORG,
            clientId: CLIENT,
            now: NOW,
            client: reader.admin,
        });
        assert.deepEqual(draft, { enabled: false });
        assert.equal(reader.calls.length, 0);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('an empty tracked set is stored without a Search Console read', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    try {
        const reader = scriptedAdmin(call => {
            if (call.table === 'tracked_keywords') return { data: [], error: null };
            throw new Error(`unexpected ${call.table}`);
        });
        let written: unknown = null;
        const captured = await captureTrackedKeywordSnapshot({
            report: { id: REPORT, organization_id: ORG, client_id: CLIENT, sections: sections() },
            now: NOW,
            client: reader.admin,
            write: async (row) => { written = row.payload; return { ok: true }; },
        });
        assert.equal(captured.ok, true);
        if (!captured.ok || captured.skipped) return;
        assert.equal(captured.snapshot.state, 'empty');
        assert.deepEqual(reader.calls.map(call => call.table), ['tracked_keywords']);
        assert.equal(parseTrackedKeywordReportSnapshot(written)?.state, 'empty');
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('a published snapshot keeps its numbers after the underlying facts change', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    let clicks = 37;
    try {
        const reader = scriptedAdmin(call => {
            if (call.table === 'tracked_keywords') return { data: KEYWORDS, error: null };
            if (call.table === 'client_integrations') return { data: { site_url: 'sc-domain:example.com' }, error: null };
            if (call.table === 'gsc_history_days') return { data: [{ id: 'day-1', data_date: '2026-11-01', is_incomplete: false }], error: null };
            if (call.table === 'gsc_history_facts') return { data: facts(clicks), error: null };
            throw new Error(`unexpected ${call.table}`);
        });
        let stored: unknown = null;
        const captured = await captureTrackedKeywordSnapshot({
            report: { id: REPORT, organization_id: ORG, client_id: CLIENT, sections: sections() },
            now: NOW,
            client: reader.admin,
            write: async (row) => { stored = row.payload; return { ok: true }; },
        });
        assert.equal(captured.ok, true);
        if (!captured.ok || !captured.snapshot) return;
        const frozen = parseTrackedKeywordReportSnapshot(stored);
        assert.ok(frozen);
        const emergency = frozen.keywords.find(row => row.keyword === 'emergency dentist');
        const cleaning = frozen.keywords.find(row => row.keyword === 'teeth cleaning');
        const guard = frozen.keywords.find(row => row.keyword === 'night guard');
        assert.equal(emergency?.clicks, 37);
        assert.equal(emergency?.impressions, 20);
        assert.equal(emergency?.position, 5);
        assert.equal(cleaning?.clicks, 0);
        assert.equal(guard?.clicks, null);
        assert.equal(guard?.position, null);
        assert.equal(frozen.distribution?.find(band => band.id === '1-3')?.count, 1);
        assert.equal(frozen.distribution?.find(band => band.id === '4-10')?.count, 1);

        const callsAtPublish = reader.calls.length;
        clicks = 91;
        const live = await loadDraftTrackedKeywordReport({
            organizationId: ORG,
            clientId: CLIENT,
            now: NOW,
            client: reader.admin,
        });
        assert.equal(live.enabled && live.ok && live.snapshot.keywords.find(row => row.keyword === 'emergency dentist')?.clicks, 91);
        assert.equal(frozen.keywords.find(row => row.keyword === 'emergency dentist')?.clicks, 37);
        assert.ok(reader.calls.length > callsAtPublish);

        const { renderTrackedKeywordSnapshot } = await import('./report-snapshot-render.ts');
        const publishedHtml = renderTrackedKeywordSnapshot(frozen);
        const liveHtml = renderTrackedKeywordSnapshot(live.enabled && live.ok ? live.snapshot : null);
        const emergencyHtml = publishedHtml.slice(publishedHtml.indexOf('data-keyword="emergency dentist"'), publishedHtml.indexOf('data-keyword="night guard"'));
        assert.match(emergencyHtml, /data-metric="clicks">37</);
        assert.doesNotMatch(emergencyHtml, /data-metric="clicks">91</);
        assert.match(liveHtml, /data-metric="clicks">91</);
        const cleaningHtml = publishedHtml.slice(publishedHtml.indexOf('data-keyword="teeth cleaning"'), publishedHtml.indexOf('data-keyword="emergency dentist"'));
        assert.match(cleaningHtml, /data-metric="clicks">0</);
        const guardHtml = publishedHtml.slice(publishedHtml.indexOf('data-keyword="night guard"'));
        assert.match(guardHtml, /data-metric="clicks">not measurable</);
        assert.doesNotMatch(guardHtml, /data-metric="clicks">0</);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('a missing snapshot and a disconnected property are not measurable and not zero', () => {
    const missing = parseTrackedKeywordReportSnapshot(null);
    assert.equal(missing, null);
    const rejected = parseTrackedKeywordReportSnapshot({
        schemaVersion: 1,
        sourceLabel: 'GSC avg position, all locations & devices',
        capturedAt: NOW.toISOString(),
        state: 'measured',
        connected: true,
        window: null,
        keywords: [{ id: 'kw', keyword: 'emergency dentist', change: null, position: null, clicks: '0', impressions: 0, bestUrl: null }],
        distribution: null,
        cannibalization: null,
    });
    assert.equal(rejected, null);

    const unmeasured = freezeTrackedKeywordReport({
        capturedAt: NOW.toISOString(),
        keywords: [{ id: 'kw', keyword: 'emergency dentist', source: 'paste' }],
        connected: false,
        window: { current: { start: '2026-10-05', end: '2026-11-01' }, compare: { start: '2026-09-07', end: '2026-10-04' } },
        gscRows: [],
        cannibalization: null,
    });
    assert.equal(unmeasured.state, 'unmeasured');
    assert.equal(unmeasured.keywords[0]?.clicks, null);
    assert.equal(unmeasured.distribution, null);
    assert.equal(unmeasured.cannibalization?.health, null);
    assert.equal(TRACKING_SNAPSHOT_UNAVAILABLE.includes('0'), false);
    assert.equal(TRACKING_SNAPSHOT_EMPTY.includes('0'), false);
});

test('the report block is not offered unless keyword tracking is on', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    const source = readFileSync(new URL('./report-snapshot.ts', import.meta.url), 'utf8');
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        assert.equal(widgetLibrary().some(group => group.items.some(item => item.type === 'tracked_keywords_gsc')), false);
        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'false';
        assert.equal(widgetLibrary().some(group => group.items.some(item => item.type === 'tracked_keywords_gsc')), false);
        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
        const item = widgetLibrary().flatMap(group => group.items).find(entry => entry.type === 'tracked_keywords_gsc');
        assert.equal(item?.name, 'Tracked keywords (GSC)');
        assert.equal(JSON.stringify(widgetLibrary()).includes('NEXT_PUBLIC_KEYWORD_TRACKING'), false);
        assert.match(source, /loadTrackedKeywordGsc/);
        assert.match(source, /loadRankingWindows/);
        assert.match(source, /rankingsDisplayRows/);
        assert.doesNotMatch(source, /semrush/i);
        const effectGuard = source.indexOf('if (!keywordTrackingEnabled()) return { enabled: false }');
        assert.ok(effectGuard >= 0);
        assert.ok(effectGuard < source.indexOf('createClient()'));
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});
