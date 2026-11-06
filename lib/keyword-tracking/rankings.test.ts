/**
 * Run with: node --import tsx --test lib/keyword-tracking/rankings.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { SearchReportingAdmin } from '../search-reporting/load.ts';
import { parseRange, resolveRange } from '../search-reporting/range.ts';
import { GSC_NOT_MEASURABLE, type KeywordGscWindow } from './gsc-read.ts';
import {
    classifyRankingChange,
    formatMeasuredCount,
    formatMeasuredPosition,
    loadRankingWindows,
    positionBand,
    rankingDistribution,
    rankingWindows,
    rankingWindowsForDays,
    rankingsDisplayRows,
} from './rankings.ts';

const MEASURED = {
    status: 'measured' as const,
    clicks: 1,
    impressions: 10,
    bestUrl: 'https://www.marketingempiregroup.com/',
};

function measured(position: number, clicks = 1): KeywordGscWindow {
    return { ...MEASURED, avgPosition: position, clicks };
}

function unmeasured(): KeywordGscWindow {
    return {
        status: GSC_NOT_MEASURABLE,
        clicks: null,
        impressions: null,
        avgPosition: null,
        bestUrl: null,
    };
}

test('distribution bands keep null and 0 out of 1–3', () => {
    assert.equal(positionBand(null), null);
    assert.equal(positionBand(Number.NaN), null);
    assert.equal(positionBand(Number.POSITIVE_INFINITY), null);
    assert.equal(positionBand(0), null);
    assert.equal(positionBand(0.9), null);
    assert.equal(positionBand(1)?.label, '1–3');
    assert.equal(positionBand(3)?.label, '1–3');
    assert.equal(positionBand(3.1)?.label, '4–10');
    assert.equal(positionBand(4)?.label, '4–10');
    assert.equal(positionBand(10)?.label, '4–10');
    assert.equal(positionBand(10.1)?.label, '11–20');
    assert.equal(positionBand(20)?.label, '11–20');
    assert.equal(positionBand(20.1)?.label, '21–50');
    assert.equal(positionBand(50)?.label, '21–50');
    assert.equal(positionBand(50.1)?.label, '51–100');
    assert.equal(positionBand(51)?.label, '51–100');
    assert.equal(positionBand(100)?.label, '51–100');
    assert.equal(positionBand(100.1), null);

    const counts = rankingDistribution([null, 0, 0.9, 1, 3, 3.1, 100, 100.1]);
    assert.deepEqual(counts.map(band => [band.label, band.count]), [
        ['1–3', 2],
        ['4–10', 1],
        ['11–20', 0],
        ['21–50', 0],
        ['51–100', 1],
    ]);
    assert.equal(counts.reduce((sum, band) => sum + band.count, 0), 4);
});

test('change classification treats a lower position as improved', () => {
    assert.equal(classifyRankingChange(unmeasured(), unmeasured()), null);
    assert.equal(classifyRankingChange(measured(8), unmeasured()), 'New');
    assert.equal(classifyRankingChange(unmeasured(), measured(8)), 'Lost');
    assert.equal(classifyRankingChange(measured(25), measured(33.6)), 'Improved');
    assert.equal(classifyRankingChange(measured(40), measured(12)), 'Declined');
    assert.equal(classifyRankingChange(measured(25, 2), measured(25, 0)), 'Unchanged');
    assert.equal(classifyRankingChange(measured(0), unmeasured()), 'New');
    assert.equal(positionBand(0), null);
});

test('not measurable metrics stay words, and a measured zero stays 0', () => {
    assert.equal(formatMeasuredCount(null), 'not measurable');
    assert.equal(formatMeasuredPosition(null), 'not measurable');
    assert.equal(formatMeasuredCount(0), '0');
    assert.equal(formatMeasuredPosition(0), '0.0');
    assert.equal(formatMeasuredPosition(25), '25.0');
    assert.equal(formatMeasuredPosition(33.6), '33.6');
    assert.equal(formatMeasuredCount(1399), '1,399');
});

test('ranking windows are the Search Insights adjacent 28-day pair', () => {
    assert.deepEqual(rankingWindows('2026-10-28'), {
        current: { start: '2026-10-01', end: '2026-10-28' },
        compare: { start: '2026-09-03', end: '2026-09-30' },
    });

    const now = new Date('2026-11-06T20:00:00Z');
    const days = [
        { date: '2026-11-06', isIncomplete: true },
        { date: '2026-11-02', isIncomplete: true },
        { date: '2026-11-01', isIncomplete: false },
        { date: '2026-10-01', isIncomplete: false },
    ];
    const resolved = resolveRange(parseRange('28d')!, days, now);
    assert.deepEqual(rankingWindowsForDays(days, now), {
        current: resolved.current,
        compare: resolved.prior,
    });
    assert.deepEqual(rankingWindowsForDays(days, now), {
        current: { start: '2026-10-05', end: '2026-11-01' },
        compare: { start: '2026-09-07', end: '2026-10-04' },
    });
    assert.deepEqual(rankingWindowsForDays([], now).current.end, '2026-11-06');
});

test('display rows sort by position and do not turn a missing window into zero', () => {
    const rows = rankingsDisplayRows(
        [
            { id: 'meg', keyword: 'digital marketing agency', source: 'paste' },
            { id: 'quiet', keyword: 'quiet term', source: 'gsc_promote' },
            { id: 'missing', keyword: 'never returned', source: 'paste' },
        ],
        [
            {
                id: 'meg',
                keyword: 'digital marketing agency',
                normalizedKey: 'digital marketing agency',
                current: { status: 'measured', clicks: 2, impressions: 51, avgPosition: 25, bestUrl: 'https://www.marketingempiregroup.com/' },
                compare: { status: 'measured', clicks: 0, impressions: 399, avgPosition: 33.6, bestUrl: 'https://www.marketingempiregroup.com/' },
            },
            {
                id: 'quiet',
                keyword: 'quiet term',
                normalizedKey: 'quiet term',
                current: { status: 'measured', clicks: 0, impressions: 12, avgPosition: 8, bestUrl: 'https://www.marketingempiregroup.com/seo-services' },
                compare: unmeasured(),
            },
        ],
    );

    assert.deepEqual(rows.map(row => row.keyword), ['quiet term', 'digital marketing agency', 'never returned']);
    assert.equal(rows[0]?.change, 'New');
    assert.equal(rows[0]?.bandLabel, '4–10');
    assert.equal(rows[0]?.clicksText, '0');
    assert.equal(rows[0]?.positionText, '8.0');
    assert.equal(rows[1]?.change, 'Improved');
    assert.equal(rows[1]?.bandLabel, '21–50');
    assert.equal(rows[1]?.positionText, '25.0');
    assert.equal(rows[1]?.clicksText, '2');
    assert.equal(rows[1]?.impressionsText, '51');
    assert.equal(rows[1]?.bestUrlText, 'www.marketingempiregroup.com/');
    const missing = rows[2];
    assert.equal(missing?.change, null);
    assert.equal(missing?.bandLabel, null);
    assert.equal(missing?.position, null);
    assert.equal(missing?.positionText, 'not measurable');
    assert.equal(missing?.clicksText, 'not measurable');
    assert.equal(missing?.impressionsText, 'not measurable');
    assert.equal(missing?.bestUrl, null);
    assert.equal(missing?.bestUrlText, 'not measurable');
    assert.equal(JSON.stringify(missing).includes('"position":0'), false);
});

test('the window loader does not read Supabase when keyword tracking is off', async () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    const calls: string[] = [];
    const admin = {
        from(table: string) {
            calls.push(table);
            throw new Error('should not read');
        },
    };
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        const disabled = await loadRankingWindows({
            organizationId: 'org',
            clientId: 'client',
            client: admin as unknown as SearchReportingAdmin,
        });
        assert.deepEqual(disabled, { enabled: false });
        assert.deepEqual(calls, []);

        process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
        const unavailable = await loadRankingWindows({
            organizationId: 'org',
            clientId: 'client',
            client: null,
        });
        assert.deepEqual(unavailable, { enabled: true, ok: false, error: 'Keyword tracking is unavailable.' });

        const disconnected = scriptedAdmin(() => ({ data: { site_url: '  ' }, error: null }));
        const missing = await loadRankingWindows({
            organizationId: 'org',
            clientId: 'client',
            now: new Date('2026-11-06T20:00:00Z'),
            client: disconnected.admin,
        });
        assert.equal(missing.enabled && missing.ok && missing.connected, false);
        if (missing.enabled && missing.ok) {
            assert.equal(missing.current.end, '2026-11-06');
            assert.equal(missing.current.start < missing.compare.end, false);
        }
        assert.deepEqual(disconnected.calls.map(call => call.table), ['client_integrations']);

        const live = scriptedAdmin(call => {
            if (call.table === 'client_integrations') {
                return { data: { site_url: 'sc-domain:marketingempiregroup.com' }, error: null };
            }
            return {
                data: [
                    { data_date: '2026-11-06', is_incomplete: true },
                    { data_date: '2026-11-01T00:00:00+00:00', is_incomplete: false },
                ],
                error: null,
            };
        });
        const loaded = await loadRankingWindows({
            organizationId: 'org',
            clientId: 'client',
            now: new Date('2026-11-06T20:00:00Z'),
            client: live.admin,
        });
        assert.deepEqual(loaded, {
            enabled: true,
            ok: true,
            connected: true,
            current: { start: '2026-10-05', end: '2026-11-01' },
            compare: { start: '2026-09-07', end: '2026-10-04' },
        });
        const dayCall = live.calls.find(call => call.table === 'gsc_history_days');
        assert.equal(dayCall?.filters.find(filter => filter.column === 'property')?.value, 'sc-domain:marketingempiregroup.com');
        assert.equal(dayCall?.filters.find(filter => filter.op === 'lte')?.value, '2026-11-06');
        assert.equal(live.calls.some(call => call.table === 'gsc_history_facts'), false);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

interface RecordedCall {
    table: string;
    filters: { op: string; column: string; value: unknown }[];
}

function scriptedAdmin(
    respond: (call: RecordedCall) => { data: unknown; error: { message?: string } | null },
): { admin: SearchReportingAdmin; calls: RecordedCall[] } {
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
