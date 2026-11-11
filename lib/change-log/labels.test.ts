import assert from 'node:assert/strict';
import test from 'node:test';

import { controlFor, controlModeLabel } from './control';
import { plainStartingPointNote } from './store';
import { formatWentLive } from './time';
import { CAUSATION } from './thresholds';
import {
    CHANGE_TYPES,
    CHANGE_TYPE_HINT,
    CHANGE_TYPE_LABEL,
    EARLY_ESTIMATE_LABEL,
    KPI_HINT,
    KPI_LABEL,
    KPIS,
    chartHeading,
    resultLabel,
    type MetricRead,
} from './types';
import { nextStep } from './verdict';

const READ: MetricRead = {
    measured: true,
    clicks: 10,
    impressions: 200,
    ctr: 0.05,
    position: 8,
    organicSessions: 4,
    keyEvents: 1,
    daysPresent: 28,
    daysExpected: 28,
};

test('stored enums stay put and the labels are plain English', () => {
    assert.deepEqual(CHANGE_TYPES, [
        'title', 'h1', 'meta', 'content_refresh', 'internal_links', 'schema', 'new_page', 'redirect', 'cro_block', 'other',
    ]);
    assert.deepEqual(KPIS, ['clicks', 'impressions', 'ctr', 'avg_position', 'organic_sessions', 'key_events']);
    assert.equal(CHANGE_TYPE_LABEL.h1, 'Main page heading');
    assert.equal(CHANGE_TYPE_HINT.h1, 'H1');
    assert.equal(CHANGE_TYPE_LABEL.meta, 'Search result description');
    assert.equal(CHANGE_TYPE_LABEL.schema, 'Search-friendly page data');
    assert.equal(CHANGE_TYPE_LABEL.cro_block, 'Call-to-action section');
    assert.equal(CHANGE_TYPE_LABEL.redirect, 'Redirect (old address sends visitors to a new one)');
    assert.equal(KPI_LABEL.ctr, 'Click rate');
    assert.equal(KPI_HINT.ctr, 'CTR');
    assert.equal(KPI_LABEL.clicks, 'Clicks from Google');
    assert.equal(KPI_LABEL.impressions, 'Times shown in Google');
    assert.equal(KPI_LABEL.avg_position, 'Average Google position');
    assert.equal(KPI_LABEL.organic_sessions, 'Visits from search');
    assert.equal(KPI_LABEL.key_events, 'Leads and key actions');
    assert.equal(resultLabel('flat', false), 'No clear change');
    assert.equal(resultLabel('too_early', false), 'Too early to tell');
    assert.equal(resultLabel('improved', false), 'Improved');
    assert.equal(resultLabel('declined', false), 'Declined');
    assert.equal(resultLabel('improved', true), EARLY_ESTIMATE_LABEL);
    assert.equal(EARLY_ESTIMATE_LABEL, 'Early estimate');
    assert.equal(CAUSATION, "Lines up with the change. Doesn't prove the change caused it.");
});

test('chart titles name the metric and the comparison is the rest of the site', () => {
    assert.equal(chartHeading('clicks'), 'Clicks from Google, day by day');
    assert.equal(chartHeading('ctr'), 'Click rate from Google, day by day');
    assert.equal(chartHeading('impressions'), 'Times shown in Google, day by day');
    assert.equal(chartHeading('organic_sessions'), 'Visits from search, day by day');
    assert.equal(controlModeLabel('untouched'), 'Rest of the site');
    assert.equal(controlModeLabel('sitewide'), 'Rest of the site');
    assert.equal(controlModeLabel('none'), 'No comparison');
    assert.equal(controlFor(READ, { ...READ, clicks: 80, impressions: 900 }, 'clicks').label, 'Rest of the site');
    assert.equal(controlFor(READ, null, 'clicks').label, 'No comparison');
    assert.equal(controlFor(READ, READ, 'clicks').mode, 'untouched');
});

test('next steps and starting-point notes avoid the old jargon', () => {
    const banned = /\b(H1|Meta|Schema|CRO|CTR|KPI|baseline|control|Revert|checkpoint|untouched)\b/i;
    for (const type of CHANGE_TYPES) {
        for (const verdict of ['improved', 'flat', 'declined', 'too_early'] as const) {
            assert.equal(banned.test(nextStep(type, verdict)), false, `${type} ${verdict}`);
        }
    }
    assert.match(nextStep('h1', 'declined'), /Undo the main page heading/);
    assert.match(nextStep('h1', 'too_early'), /7-day check/);
    assert.equal(plainStartingPointNote('', 'missing'), 'The starting point was not saved.');
    assert.equal(plainStartingPointNote('', 'captured'), null);
    assert.equal(
        plainStartingPointNote('Baseline saved with 20 of 28 days. Search Console is about 3 days behind.', 'partial'),
        'Starting point saved with 20 of 28 days. Google Search Console is about 3 days behind.',
    );
    assert.equal(formatWentLive('2026-11-10T22:04:00.000Z'), 'Nov 10, 2026 · 2:04 PM PT (Pacific time)');
});
