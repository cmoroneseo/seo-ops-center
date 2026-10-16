import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GA4_MAX_CONCURRENT_JOBS, GA4_MAX_JOBS_PER_PROPERTY, assembleGa4Days, dailyRepairDates, ga4BackoffSeconds,
    ga4ReportBody, isGa4DayFinal, normalizeGa4LandingPage, quotaPauseScope, shouldRescheduleForQuota,
} from './sync.ts';

const NOW = new Date('2026-10-15T11:00:00Z');

function row(dimensions: string[], metrics: Array<string | null>) {
    return {
        dimensionValues: dimensions.map(value => ({ value })),
        metricValues: metrics.map(value => ({ value: value ?? '' })),
    };
}

test('the nightly repair is the last three UTC days and only the oldest is final', () => {
    assert.deepEqual(dailyRepairDates(NOW), ['2026-10-14', '2026-10-13', '2026-10-12']);
    assert.equal(isGa4DayFinal('2026-10-14', NOW), false);
    assert.equal(isGa4DayFinal('2026-10-13', NOW), false);
    assert.equal(isGa4DayFinal('2026-10-12', NOW), true);
});

test('a successful report with no row stores zero and a measured zero stays zero', () => {
    const days = assembleGa4Days({
        dates: ['2026-10-12', '2026-10-13'],
        now: NOW,
        keyEvents: ['purchase'],
        totals: { rows: [row(['20261013'], ['40', '10', '0.25', '2'])], metadata: { subjectToThresholding: true } },
        organic: { rows: [row(['20261013'], ['0', '0', '0'])] },
        events: { rows: [row(['20261013', 'purchase'], ['2'])] },
        landing: {
            rows: [
                row(['20261013', '/Pricing?utm_source=google'], ['0', '0', '1']),
                row(['20261013', '/pricing/'], ['5', null, null]),
            ],
            metadata: { samplingMetadatas: [{ samplesReadCount: '1' }] },
        },
    });
    assert.equal(days[0]?.daily.sessions, 0);
    assert.equal(days[0]?.daily.engaged_sessions, 0);
    assert.equal(days[0]?.daily.engagement_rate, 0);
    assert.equal(days[0]?.daily.organic_sessions, 0);
    assert.equal(days[0]?.daily.key_events, 0);
    assert.deepEqual(days[0]?.daily.total_key_events_by_name, { purchase: 0 });
    assert.equal(days[0]?.landingPages.length, 0);
    assert.equal(days[1]?.daily.sessions, 40);
    assert.equal(days[1]?.daily.organic_sessions, 0);
    assert.equal(days[1]?.daily.key_events, 0);
    assert.deepEqual(days[1]?.daily.total_key_events_by_name, { purchase: 2 });
    assert.equal(days[1]?.sampled, true);
    assert.equal(days[1]?.thresholded, true);
    assert.equal(days[1]?.isFinal, false);
    assert.deepEqual(days[1]?.landingPages, [{
        landing_page_raw: '/Pricing?utm_source=google',
        landing_page_norm: '/pricing',
        organic_sessions: 5,
        engaged_sessions: null,
        key_events: null,
    }]);
});

test('a missing purchase row does not blank the organic key-event total', () => {
    const days = assembleGa4Days({
        dates: ['2026-10-13'],
        now: NOW,
        keyEvents: ['purchase', 'generate_lead'],
        totals: { rows: [row(['20261013'], ['40', '10', '0.25', '9'])] },
        organic: { rows: [row(['20261013'], ['12', '5', '4'])] },
        events: { rows: [row(['20261013', 'generate_lead'], ['4'])] },
        landing: { rows: [] },
    });
    assert.equal(days[0]?.daily.organic_sessions, 12);
    assert.equal(days[0]?.daily.key_events, 4);
    assert.deepEqual(days[0]?.daily.total_key_events_by_name, { purchase: 0, generate_lead: 4 });
});

test('a failed report stays null while a blank metric on a present row stays null', () => {
    const days = assembleGa4Days({
        dates: ['2026-10-12', '2026-10-13'],
        now: NOW,
        keyEvents: ['purchase'],
        totals: { rows: [row(['20261013'], ['', '1', '0.5', '2'])] },
        organic: null,
        events: null,
        landing: { rows: [] },
    });
    assert.equal(days[0]?.daily.sessions, 0);
    assert.equal(days[0]?.daily.organic_sessions, null);
    assert.equal(days[0]?.daily.key_events, null);
    assert.deepEqual(days[0]?.daily.total_key_events_by_name, { purchase: null });
    assert.equal(days[1]?.daily.sessions, null);
    assert.equal(days[1]?.daily.engaged_sessions, 1);
    assert.equal(days[1]?.daily.organic_sessions, null);
    assert.equal(days[1]?.daily.key_events, null);
});

test('quota under 20 percent hourly remaining reschedules, and 429 backs off', () => {
    assert.equal(quotaPauseScope({ tokensPerHour: { consumed: 32000, remaining: 8000 } }), null);
    assert.equal(quotaPauseScope({ tokensPerHour: { consumed: 32001, remaining: 7999 } }), 'property');
    assert.equal(quotaPauseScope({ tokensPerProjectPerHour: { consumed: 1601, remaining: 399 } }), 'project');
    assert.equal(shouldRescheduleForQuota({ tokensPerHour: { consumed: 1, remaining: 39999 } }), false);
    assert.equal(shouldRescheduleForQuota(null), false);
    assert.equal(ga4BackoffSeconds(1), 15 * 60);
    assert.equal(ga4BackoffSeconds(2), 30 * 60);
    assert.equal(ga4BackoffSeconds(20), 6 * 60 * 60);
    assert.equal(GA4_MAX_CONCURRENT_JOBS, 5);
    assert.equal(GA4_MAX_JOBS_PER_PROPERTY, 1);
});

test('report requests ask Google for the property quota', () => {
    const body = ga4ReportBody({
        start: '2026-09-01', end: '2026-09-30', metrics: ['sessions'], dimensions: ['date'],
    });
    assert.equal(body.returnPropertyQuota, true);
    assert.equal(normalizeGa4LandingPage('(not set)'), '(not set)');
    assert.equal(normalizeGa4LandingPage(''), null);
});
