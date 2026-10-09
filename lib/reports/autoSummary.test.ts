import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAutoSummary } from './autoSummary';
import { assertClientCopy } from './copy-rules';

test('the summary states computed facts and drops canned advice', () => {
    const summary = generateAutoSummary('North', 'September 2026', {
        gsc: { organic_clicks: 65, impressions: 200 },
        gbp: { calls: 12 },
        ahrefs: { traffic: 5000, domain_rating: 22 },
    }, {
        gsc: { organic_clicks: 40, impressions: 100 },
    });

    assert.equal(summary.recommendations, '');
    assert.match(summary.executiveSummary, /Search performance for North in September 2026\./);
    assert.match(summary.executiveSummary, /Clicks to your website from Google: 65, higher by 25 from 40\./);
    assert.match(summary.executiveSummary, /Times shown: 200, higher by 100 \(100\.0%\) from 100\./);
    assert.match(summary.executiveSummary, /Call-button taps: 12\. No comparable baseline\./);
    assert.match(summary.executiveSummary, /Domain Rating: 22\. No comparable baseline\./);
    assert.doesNotMatch(summary.executiveSummary, /5000|traffic|positive momentum|building links|authority links/i);
    assert.doesNotMatch(`${summary.executiveSummary}\n${summary.recommendations}`, /\bcalls\b|\bpeople\b|\bvisits\b|\bvisitors\b|\bcustomers\b|\bleads\b/i);
    assert.doesNotThrow(() => assertClientCopy(summary.executiveSummary, ['gsc', 'organic_clicks', 'CALL_CLICKS']));
});

test('a small move stays inside the noise band and a missing value is not written as zero', () => {
    const summary = generateAutoSummary('North', 'September 2026', {
        gsc: { organic_clicks: 100, impressions: null },
    }, {
        gsc: { organic_clicks: 103, impressions: 80 },
    });
    assert.match(summary.executiveSummary, /Clicks to your website from Google: 100, about the same as 103\./);
    assert.doesNotMatch(summary.executiveSummary, /Times shown: 0|impressions were 0|Times shown: —/i);
});

test('no sources produces a factual empty summary', () => {
    const summary = generateAutoSummary('North', 'September 2026', {}, {});
    assert.equal(summary.executiveSummary, 'Search performance for North in September 2026. No metrics are on file for this month.');
    assert.equal(summary.recommendations, '');
    assert.doesNotMatch(summary.executiveSummary, /positive momentum|connect data sources/i);
});
