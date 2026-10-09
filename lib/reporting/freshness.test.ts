import test from 'node:test';
import assert from 'node:assert/strict';

import { DAY_MS, FRESH_WINDOW_MS, HOUR_MS, formatAsOfDate, resolveFreshness, type FreshnessInput } from './freshness.ts';
import { STATES_COPY } from './states-copy.ts';

const NOW = new Date('2026-10-08T20:00:00.000Z');

function input(over: Partial<FreshnessInput> = {}): FreshnessInput {
    return {
        source: 'gsc',
        connected: true,
        lastSyncAt: new Date(NOW.getTime() - HOUR_MS),
        lastSyncErrored: false,
        now: NOW,
        historyCoversWindow: true,
        backfillRunning: false,
        value: 65,
        ...over,
    };
}

test('freshness windows are 36h, 72h, and 7 days', () => {
    assert.equal(FRESH_WINDOW_MS.gsc, 36 * HOUR_MS);
    assert.equal(FRESH_WINDOW_MS.ga4, 36 * HOUR_MS);
    assert.equal(FRESH_WINDOW_MS.ahrefs, 36 * HOUR_MS);
    assert.equal(FRESH_WINDOW_MS.gbp, 72 * HOUR_MS);
    assert.equal(FRESH_WINDOW_MS.dfs, 7 * DAY_MS);
});

test('a sync at the window edge is fresh and one millisecond past it is stale', () => {
    const fresh = resolveFreshness(input({ lastSyncAt: new Date(NOW.getTime() - FRESH_WINDOW_MS.gsc) }));
    assert.equal(fresh.state, 'fresh');
    assert.equal(fresh.copy, STATES_COPY.fresh);
    assert.equal(fresh.displayValue, '65');

    const staleAt = new Date(NOW.getTime() - FRESH_WINDOW_MS.gsc - 1);
    const stale = resolveFreshness(input({ lastSyncAt: staleAt }));
    assert.equal(stale.state, 'stale');
    assert.equal(stale.copy, STATES_COPY.staleGsc);
    assert.equal(stale.asOf, `as of ${formatAsOfDate(staleAt)}`);
    assert.equal(stale.asOf, 'as of Oct 7, 2026');
    assert.equal(stale.tone, 'neutral');
});

test('Business Profile waits 72 hours and a DataForSEO snapshot waits 7 days', () => {
    const gbpFresh = resolveFreshness(input({
        source: 'gbp',
        lastSyncAt: new Date(NOW.getTime() - FRESH_WINDOW_MS.gbp),
    }));
    assert.equal(gbpFresh.state, 'fresh');
    const gbpStale = resolveFreshness(input({
        source: 'gbp',
        lastSyncAt: new Date(NOW.getTime() - FRESH_WINDOW_MS.gbp - 1),
    }));
    assert.equal(gbpStale.state, 'stale');
    assert.equal(gbpStale.copy, STATES_COPY.staleGbp);

    const dfsFresh = resolveFreshness(input({
        source: 'dfs',
        lastSyncAt: new Date(NOW.getTime() - FRESH_WINDOW_MS.dfs),
    }));
    assert.equal(dfsFresh.state, 'fresh');
    const dfsStale = resolveFreshness(input({
        source: 'dfs',
        lastSyncAt: new Date(NOW.getTime() - FRESH_WINDOW_MS.dfs - 1),
    }));
    assert.equal(dfsStale.copy, STATES_COPY.staleDfs);
});

test('a sync error is stale even when the timestamp is recent', () => {
    const readout = resolveFreshness(input({ lastSyncErrored: true, backfillRunning: true }));
    assert.equal(readout.state, 'stale');
    assert.equal(readout.copy, STATES_COPY.staleError);
    assert.equal(readout.asOf, 'as of Oct 8, 2026');
});

test('no successful sync is stale without an as-of date', () => {
    const readout = resolveFreshness(input({ lastSyncAt: null }));
    assert.equal(readout.state, 'stale');
    assert.equal(readout.copy, STATES_COPY.noSuccessfulSync);
    assert.equal(readout.asOf, null);
});

test('partial coverage and a running backfill use the prelim tag', () => {
    const history = resolveFreshness(input({ historyCoversWindow: false }));
    assert.equal(history.state, 'partial');
    assert.equal(history.copy, STATES_COPY.partialHistory);
    assert.equal(history.tag, STATES_COPY.prelimTag);
    assert.equal(history.displayValue, '65');

    const backfill = resolveFreshness(input({ backfillRunning: true }));
    assert.equal(backfill.copy, STATES_COPY.partialBackfill);
    assert.equal(backfill.tag, 'prelim');
});

test('a real zero is a neutral 0 and never an em dash', () => {
    const readout = resolveFreshness(input({ value: 0 }));
    assert.equal(readout.state, 'empty');
    assert.equal(readout.displayValue, '0');
    assert.equal(readout.displayValue === '—', false);
    assert.equal(readout.tone, 'neutral');
    assert.equal(readout.copy, STATES_COPY.empty);
});

test('a stale real zero still shows 0', () => {
    const readout = resolveFreshness(input({
        value: 0,
        lastSyncAt: new Date(NOW.getTime() - FRESH_WINDOW_MS.gsc - 1),
    }));
    assert.equal(readout.state, 'stale');
    assert.equal(readout.displayValue, '0');
});

test('missing data is an em dash and not a fabricated zero', () => {
    const readout = resolveFreshness(input({ value: null }));
    assert.equal(readout.state, 'missing');
    assert.equal(readout.displayValue, '—');
    assert.equal(readout.copy, STATES_COPY.missing);
    assert.equal(readout.displayValue === '0', false);
});

test('not connected is an em dash plus the reason, even if a zero is lying around', () => {
    const readout = resolveFreshness(input({
        connected: false,
        value: 0,
        notConnectedReason: "Search Console isn't connected.",
    }));
    assert.equal(readout.state, 'not_connected');
    assert.equal(readout.displayValue, '—');
    assert.equal(readout.copy, "Search Console isn't connected.");
    assert.equal(`${readout.displayValue} ${readout.copy}`, "— Search Console isn't connected.");
});

test('as-of dates are formatted in Pacific time', () => {
    assert.equal(formatAsOfDate(new Date('2026-10-09T06:30:00.000Z')), 'Oct 8, 2026');
});
