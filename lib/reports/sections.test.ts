import test from 'node:test';
import assert from 'node:assert/strict';
import { clientSafeMetricData, computeDelta, formatMetricCaption, METRIC_DEFS, REPORT_SECTIONS } from './sections';

test('a missing metric stays missing in month-over-month math', () => {
    assert.equal(computeDelta(null, 10), null);
    assert.equal(computeDelta(10, null), null);
    assert.equal(computeDelta(undefined, 10), null);
    assert.equal(computeDelta('', 10), null);
});

test('a real zero is a value and a zero baseline has no percent', () => {
    const drop = computeDelta(0, 10);
    assert.ok(drop);
    assert.equal(drop.pct, -100);
    assert.equal(computeDelta(5, 0), null);
});

test('client labels and the Ahrefs appendix', () => {
    assert.equal(REPORT_SECTIONS.at(-1)?.key, 'ahrefs');
    assert.equal(REPORT_SECTIONS.at(-1)?.name, 'Authority (Ahrefs, appendix)');
    assert.equal(METRIC_DEFS.gsc.find(metric => metric.key === 'organic_clicks')?.label, 'Clicks to your website from Google');
    assert.equal(METRIC_DEFS.gsc.find(metric => metric.key === 'impressions')?.label, 'Times shown');
    assert.equal(METRIC_DEFS.gbp.find(metric => metric.key === 'calls')?.label, 'Call-button taps');
    assert.equal(METRIC_DEFS.gbp.find(metric => metric.key === 'calls')?.key, 'calls');
});

test('a metric caption carries the source, the month, and the as-of date', () => {
    assert.equal(
        formatMetricCaption('gsc', '2026-09', '2026-10-02T15:04:00.000Z'),
        'Google Search Console · Sep 1–30, 2026 · as of Oct 2, 2026',
    );
    assert.equal(formatMetricCaption('gbp', '2026-09', null), 'Google Business Profile · Sep 1–30, 2026');
    assert.equal(formatMetricCaption('ga4', '2026-02', null), 'Google Analytics · Feb 1–28, 2026');
});

test('modeled Ahrefs columns are removed before a client snapshot', () => {
    assert.deepEqual(clientSafeMetricData({ domain_rating: 22, traffic: 5000, volume: 90, top_10_keywords: 4 }), {
        domain_rating: 22,
        top_10_keywords: 4,
    });
});
