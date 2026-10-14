import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBingSyncResult, readBingManualView } from './manual-view.ts';
import { logBingSyncSummary, summarizeBingCron } from './log.ts';

const view = {
    sitesMapped: 2,
    sitesSynced: 1,
    remaining: 1,
    errors: [429, 503],
    skipped: null,
};

test('the click result keeps counts and status codes', () => {
    assert.deepEqual(readBingManualView({ ...view, apiKey: 'synthetic-bing-key', rank: 4, siteUrl: 'https://alpha.example.test/' }), view);
    assert.equal(formatBingSyncResult(view), 'Mapped 2. Synced 1. 1 remaining. Errors: 429, 503.');
    assert.equal(formatBingSyncResult({ ...view, errors: [] }), 'Mapped 2. Synced 1. 1 remaining.');
    assert.equal(formatBingSyncResult({ ...view, skipped: 'flag_off' }), 'Bing sync is off.');
    assert.equal(formatBingSyncResult({ ...view, skipped: 'missing_key' }), 'Bing sync is not configured.');
    assert.equal(formatBingSyncResult({ ...view, skipped: 'unavailable' }), 'Bing sync did not finish. Try again.');
});

test('a result with a bad count or status is dropped', () => {
    assert.equal(readBingManualView({ ...view, sitesMapped: 1.5 }), null);
    assert.equal(readBingManualView({ ...view, errors: [99] }), null);
    assert.equal(readBingManualView({ ...view, errors: [600] }), null);
    assert.equal(readBingManualView({ ...view, errors: ['429'] }), null);
    assert.equal(readBingManualView({ ...view, skipped: 'other' }), null);
    assert.equal(readBingManualView(null), null);
});

test('the summary log is counts and status codes', () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
    try {
        logBingSyncSummary({ source: 'manual', sitesMapped: 2, sitesSynced: 1, remaining: 4, errors: [429, 12, 700] });
        logBingSyncSummary(summarizeBingCron({ enqueued: 3, continued: true }));
        logBingSyncSummary(summarizeBingCron({ skipped: true, reason: 'flag_off' }));
    } finally {
        console.log = original;
    }
    assert.deepEqual(lines.map(line => JSON.parse(line)), [
        { event: 'bing_sync', source: 'manual', sitesMapped: 2, sitesSynced: 1, remaining: 4, errors: [429] },
        { event: 'bing_sync', source: 'cron', sitesMapped: 3, sitesSynced: 0, remaining: 3, errors: [] },
        { event: 'bing_sync', source: 'cron', sitesMapped: 0, sitesSynced: 0, remaining: 0, errors: [] },
    ]);
    assert.equal(lines.join('\n').split(KEY_MARKER).length, 1);
});

const KEY_MARKER = 'BING_WEBMASTER_API_KEY';
