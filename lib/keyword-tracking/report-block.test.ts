/**
 * Run with: node --import tsx --test lib/keyword-tracking/report-block.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { keywordTrackingEnabled } from './flag.ts';
import { renderTrackedKeywordBlock, renderTrackedKeywordSnapshot } from './report-snapshot-render.ts';
import { TRACKING_SNAPSHOT_EMPTY, TRACKING_SNAPSHOT_UNAVAILABLE, type TrackedKeywordReportSnapshot } from './report-snapshot.ts';

const frozen: TrackedKeywordReportSnapshot = {
    schemaVersion: 1,
    sourceLabel: 'GSC avg position, all locations & devices',
    capturedAt: '2026-11-07T20:00:00.000Z',
    state: 'measured',
    connected: true,
    window: {
        current: { start: '2026-10-05', end: '2026-11-01' },
        compare: { start: '2026-09-07', end: '2026-10-04' },
    },
    keywords: [
        { id: 'kw-cleaning', keyword: 'teeth cleaning', change: 'New', position: 3, clicks: 0, impressions: 8, bestUrl: 'https://example.com/cleaning' },
        { id: 'kw-emergency', keyword: 'emergency dentist', change: 'New', position: 5, clicks: 37, impressions: 20, bestUrl: 'https://example.com/emergency' },
        { id: 'kw-guard', keyword: 'night guard', change: null, position: null, clicks: null, impressions: null, bestUrl: null },
    ],
    distribution: [
        { id: '1-3', label: '1–3', count: 1 },
        { id: '4-10', label: '4–10', count: 1 },
        { id: '11-20', label: '11–20', count: 0 },
        { id: '21-50', label: '21–50', count: 0 },
        { id: '51-100', label: '51–100', count: 0 },
    ],
    cannibalization: { tracked: 3, affected: 0, health: 1, keywords: [] },
};

test('the block is absent when the flag is off, including a published snapshot', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    try {
        delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        assert.equal(keywordTrackingEnabled(), false);
        assert.equal(renderTrackedKeywordBlock({ reportStatus: 'published', trackingSnapshot: frozen }), '');
        const source = readFileSync(new URL('../../components/reports/TrackedKeywordsReportBlock.tsx', import.meta.url), 'utf8');
        const effect = source.slice(source.indexOf('useEffect(() =>'));
        assert.ok(effect.indexOf('if (!keywordTrackingEnabled()) return;') < effect.indexOf('loadDraftTrackedKeywordReport'));
        assert.ok(effect.indexOf('if (frozen) return;') < effect.indexOf('loadDraftTrackedKeywordReport'));
        assert.equal(source.includes('NEXT_PUBLIC_KEYWORD_TRACKING'), false);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});

test('a published report renders the frozen numbers, not a missing snapshot as zero', () => {
    const previous = process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
    process.env.NEXT_PUBLIC_KEYWORD_TRACKING = 'true';
    try {
        const html = renderTrackedKeywordBlock({ reportStatus: 'published', trackingSnapshot: frozen });
        assert.match(html, /data-keyword="emergency dentist"[\s\S]*data-metric="clicks">37</);
        assert.match(html, /data-keyword="teeth cleaning"[\s\S]*data-metric="clicks">0</);
        assert.match(html, /data-keyword="night guard"[\s\S]*data-metric="clicks">not measurable</);
        const changed = { ...frozen, keywords: frozen.keywords.map(row => row.keyword === 'emergency dentist' ? { ...row, clicks: 91 } : row) };
        const stillFrozen = renderTrackedKeywordBlock({ reportStatus: 'published', trackingSnapshot: frozen });
        assert.match(stillFrozen, /data-metric="clicks">37</);
        assert.doesNotMatch(stillFrozen, /data-metric="clicks">91</);
        assert.match(renderTrackedKeywordSnapshot(changed), /data-metric="clicks">91</);

        const missing = renderTrackedKeywordBlock({ reportStatus: 'published', trackingSnapshot: null });
        assert.match(missing, new RegExp(TRACKING_SNAPSHOT_UNAVAILABLE));
        assert.equal(missing.includes('data-metric="clicks"'), false);
        assert.equal(missing.includes('>0<'), false);

        const empty = renderTrackedKeywordSnapshot({
            schemaVersion: 1,
            sourceLabel: 'GSC avg position, all locations & devices',
            capturedAt: frozen.capturedAt,
            state: 'empty',
            connected: null,
            window: null,
            keywords: [],
            distribution: null,
            cannibalization: null,
        });
        assert.match(empty, new RegExp(TRACKING_SNAPSHOT_EMPTY));
        assert.equal(empty.includes('data-distribution'), false);
        assert.equal(empty.includes('data-metric'), false);
        assert.equal(empty.includes('>0<'), false);
    } finally {
        if (previous === undefined) delete process.env.NEXT_PUBLIC_KEYWORD_TRACKING;
        else process.env.NEXT_PUBLIC_KEYWORD_TRACKING = previous;
    }
});
