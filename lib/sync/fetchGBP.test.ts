import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGBP } from './fetchGBP';

const token = async () => ({ token: 'test-token', creds: { location_name: 'locations/9' } });
const METRICS = [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'CALL_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'WEBSITE_CLICKS',
];

function series(metric: string, values: (string | null | undefined)[]) {
    return {
        dailyMetric: metric,
        timeSeries: { datedValues: values.map(value => (value == null ? {} : { value })) },
    };
}

function payload(metrics: { metric: string; values: (string | null | undefined)[] }[]) {
    return { multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: metrics.map(item => series(item.metric, item.values)) }] };
}

test('the performance request asks for all seven daily metrics', async () => {
    let performance = '';
    await fetchGBP('client', '2026-08', {
        getToken: token,
        fetch: async (input) => {
            const url = String(input);
            if (url.includes('reviews')) return Response.json({ totalReviewCount: 4, averageRating: 4.2 });
            performance = url;
            return Response.json(payload(METRICS.map(metric => ({ metric, values: ['1'] }))));
        },
    });
    const params = new URL(performance).searchParams;
    assert.deepEqual(params.getAll('dailyMetrics'), METRICS);
});

test('an absent call series stays null and omitted values inside a series are zeros', async () => {
    const result = await fetchGBP('client', '2026-08', {
        getToken: token,
        fetch: async (input) => {
            if (String(input).includes('reviews')) return Response.json({});
            return Response.json(payload([
                ...METRICS
                    .filter(metric => metric !== 'CALL_CLICKS' && metric !== 'BUSINESS_DIRECTION_REQUESTS')
                    .map(metric => ({ metric, values: ['3'] })),
                { metric: 'BUSINESS_DIRECTION_REQUESTS', values: [undefined, ''] },
            ]));
        },
    });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') {
        assert.equal(result.data.calls, null);
        assert.equal(result.data.direction_requests, 0);
        assert.equal(result.data.impressions, 12);
    }
});

test('impressions stay null unless all four impression series are present', async () => {
    const result = await fetchGBP('client', '2026-08', {
        getToken: token,
        fetch: async (input) => {
            if (String(input).includes('reviews')) return Response.json({ totalReviewCount: 1, averageRating: 5 });
            return Response.json(payload([
                { metric: 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', values: ['2'] },
                { metric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', values: ['2'] },
                { metric: 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', values: ['2'] },
                { metric: 'CALL_CLICKS', values: ['7'] },
            ]));
        },
    });
    assert.equal(result.status, 'ok');
    if (result.status === 'ok') {
        assert.equal(result.data.impressions, null);
        assert.equal(result.data.calls, 7);
    }
});

test('a 403 is an error and not an empty result', async () => {
    const result = await fetchGBP('client', '2026-08', {
        getToken: token,
        fetch: async () => new Response('quota secret', { status: 403 }),
    });
    assert.equal(result.status, 'error');
    if (result.status === 'error') {
        assert.match(result.message, /HTTP 403/);
        assert.equal(result.retryable, false);
        assert.doesNotMatch(result.message, /quota secret/);
    }
});

test('a reviews failure leaves review fields null and keeps the performance result', async () => {
    const result = await fetchGBP('client', '2026-08', {
        getToken: token,
        fetch: async (input) => {
            if (String(input).includes('reviews')) throw new Error('reviews down');
            return Response.json(payload([{ metric: 'CALL_CLICKS', values: ['4'] }]));
        },
    });
    assert.deepEqual(result, {
        status: 'ok',
        data: {
            impressions: null,
            calls: 4,
            direction_requests: null,
            website_clicks: null,
            review_count: null,
            avg_rating: null,
        },
    });
});
