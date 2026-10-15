import test from 'node:test';
import assert from 'node:assert/strict';
import { ga4CardsEnabled } from './ga4-flag.ts';
import { ga4PickerRequested, ga4PropertyPickerHref } from './ga4-link.ts';
import {
    attachGa4Dashboard,
    cardMetricSearch,
    compareGa4Cards,
    engagementRate,
    formatCardCount,
    formatGa4Metric,
    parseCardMetric,
    parseGa4Aggregate,
    type Ga4Aggregate,
    type Ga4CardView,
    type Ga4MetricView,
} from './ga4.ts';
import { NOT_ENOUGH_HISTORY } from './portfolio.ts';

function env(values: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return values as NodeJS.ProcessEnv;
}

test('the GA4 card flag stays off unless it is exactly true', () => {
    assert.equal(ga4CardsEnabled(env({})), false);
    assert.equal(ga4CardsEnabled(env({ NEXT_PUBLIC_GA4_CARDS: '' })), false);
    assert.equal(ga4CardsEnabled(env({ NEXT_PUBLIC_GA4_CARDS: '1' })), false);
    assert.equal(ga4CardsEnabled(env({ NEXT_PUBLIC_GA4_CARDS: 'TRUE' })), false);
    assert.equal(ga4CardsEnabled(env({ NEXT_PUBLIC_GA4_CARDS: 'true' })), true);
});

test('the card metric lives in the query and clicks is the default', () => {
    assert.equal(parseCardMetric(null), 'clicks');
    assert.equal(parseCardMetric('sessions'), 'clicks');
    assert.equal(parseCardMetric('organic-sessions'), 'organic-sessions');
    assert.equal(parseCardMetric('key-events'), 'key-events');
    assert.equal(cardMetricSearch('', 'organic-sessions'), '?metric=organic-sessions');
    assert.equal(cardMetricSearch('?range=28d&metric=key-events', 'clicks'), '?range=28d');
    assert.equal(cardMetricSearch('?metric=organic-sessions', 'key-events'), '?metric=key-events');
    assert.equal(ga4PropertyPickerHref('north'), '/workspace/north?tab=integrations&picker=ga4');
    assert.equal(ga4PickerRequested('ga4'), true);
    assert.equal(ga4PickerRequested('gsc'), false);
    assert.equal(ga4PickerRequested(null), false);
});

test('a missing GA4 period is not a zero, and the rate needs both sides', () => {
    assert.equal(engagementRate(null), null);
    assert.equal(engagementRate({ organicSessions: 0, sessions: null, engagedSessions: 0, keyEvents: 0, days: 4 }), null);
    assert.equal(engagementRate({ organicSessions: 0, sessions: 0, engagedSessions: 0, keyEvents: 0, days: 4 }), null);
    assert.equal(engagementRate({ organicSessions: 10, sessions: 20, engagedSessions: 0, keyEvents: 1, days: 4 }), 0);
    assert.equal(engagementRate({ organicSessions: null, sessions: 20, engagedSessions: 10, keyEvents: null, days: 4 }), 0.5);
    assert.equal(formatGa4Metric('organicSessions', null), '—');
    assert.equal(formatGa4Metric('organicSessions', 0), '0');
    assert.equal(formatCardCount(12480), '12,480');
    assert.equal(formatGa4Metric('engagementRate', null), '—');
    assert.equal(formatGa4Metric('engagementRate', 0.612), '61.2%');
    assert.equal(formatGa4Metric('keyEvents', 342), '342');
});

test('percent change is null when either GA4 period is missing', () => {
    const aggregate: Ga4Aggregate = {
        clients: [{
            clientId: 'north',
            current: { organicSessions: 80, sessions: 100, engagedSessions: 40, keyEvents: 4, days: 28 },
            previous: null,
            series: [{ bucket: '2026-10-01', organicSessions: null, keyEvents: 1 }],
        }],
    };
    const model = attachGa4Dashboard({
        buckets: ['2026-10-01', '2026-10-02'],
        cards: [{ clientId: 'north' }, { clientId: 'quiet' }],
    }, {
        links: [{ clientId: 'north', property: 'properties/1' }],
        aggregate,
        expectedPreviousDays: 28,
    });
    const north = model.cards[0].ga4 as Ga4CardView;
    assert.equal(north.mapped, true);
    assert.equal(north.metrics.organicSessions.value, 80);
    assert.equal(north.metrics.organicSessions.change, null);
    assert.equal(north.metrics.engagementRate.value, 0.4);
    assert.equal(north.metrics.engagementRate.change, null);
    assert.deepEqual(north.series.organicSessions, [null, null]);
    assert.deepEqual(north.series.keyEvents, [1, null]);
    const quiet = model.cards[1].ga4 as Ga4CardView;
    assert.equal(quiet.mapped, false);
    assert.equal(quiet.unavailable, false);
    assert.equal(quiet.metrics.organicSessions.value, null);
    assert.equal(quiet.metrics.sessions.value, null);
    assert.equal(quiet.metrics.keyEvents.value, null);
});

test('a short previous window and a null metric stay null, while a measured zero stays zero', () => {
    const attached = attachGa4Dashboard({
        buckets: ['2026-10-06', '2026-10-07'],
        cards: [{ clientId: 'short', name: 'Short' }, { clientId: 'zero', name: 'Zero' }, { clientId: 'empty', name: 'Empty' }],
    }, {
        links: [
            { clientId: 'short', property: 'properties/1' },
            { clientId: 'zero', property: 'properties/2' },
            { clientId: 'empty', property: 'properties/3' },
        ],
        aggregate: {
            clients: [
                {
                    clientId: 'short',
                    current: { organicSessions: 10, sessions: 24, engagedSessions: 9, keyEvents: 2, days: 2 },
                    previous: { organicSessions: 10, sessions: 20, engagedSessions: 10, keyEvents: 2, days: 1 },
                    series: [],
                },
                {
                    clientId: 'zero',
                    current: { organicSessions: 0, sessions: 0, engagedSessions: 0, keyEvents: 0, days: 2 },
                    previous: { organicSessions: 0, sessions: 4, engagedSessions: 0, keyEvents: 0, days: 2 },
                    series: [],
                },
                {
                    clientId: 'empty',
                    current: { organicSessions: null, sessions: null, engagedSessions: null, keyEvents: null, days: 2 },
                    previous: null,
                    series: [],
                },
            ],
        },
        expectedPreviousDays: 2,
    });
    const short = attached.cards[0].ga4 as Ga4CardView;
    assert.equal(short.metrics.organicSessions.change, null);
    assert.equal(short.changeNote, NOT_ENOUGH_HISTORY);
    const zero = attached.cards[1].ga4 as Ga4CardView;
    assert.equal(zero.metrics.organicSessions.value, 0);
    assert.equal(zero.metrics.organicSessions.change, 0);
    assert.equal(zero.metrics.sessions.value, 0);
    assert.equal(zero.metrics.engagementRate.value, null);
    assert.equal(zero.metrics.keyEvents.value, 0);
    const empty = attached.cards[2].ga4 as Ga4CardView;
    assert.equal(empty.mapped, true);
    assert.equal(empty.metrics.organicSessions.value, null);
    assert.equal(empty.metrics.sessions.value, null);
    assert.equal(formatGa4Metric('organicSessions', empty.metrics.organicSessions.value), '—');
});

test('a failed GA4 read does not pretend the client is unmapped', () => {
    const failedLinks = attachGa4Dashboard({
        buckets: [],
        cards: [{ clientId: 'north', name: 'North' }],
    }, { links: null, aggregate: null, expectedPreviousDays: 28 });
    assert.equal(failedLinks.cards[0].ga4?.unavailable, true);
    assert.equal(failedLinks.cards[0].ga4?.mapped, false);

    const failedAggregate = attachGa4Dashboard({
        buckets: [],
        cards: [{ clientId: 'north', name: 'North' }, { clientId: 'quiet', name: 'Quiet' }],
    }, { links: [{ clientId: 'north', property: 'properties/9' }], aggregate: null, expectedPreviousDays: 28 });
    assert.equal(failedAggregate.cards[0].ga4?.mapped, true);
    assert.equal(failedAggregate.cards[0].ga4?.unavailable, true);
    assert.equal(failedAggregate.cards[1].ga4?.mapped, false);
    assert.equal(failedAggregate.cards[1].ga4?.unavailable, false);
});

test('the aggregate parser keeps nulls and rejects a negative measurement', () => {
    const parsed = parseGa4Aggregate({
        current: [{ clientId: 'north', organicSessions: null, sessions: '12', engagedSessions: 6, keyEvents: 0, days: 2 }],
        previous: [],
        series: [{ clientId: 'north', bucket: '2026-10-07T00:00:00Z', organicSessions: null, keyEvents: 0 }],
    });
    assert.equal(parsed.clients[0].current?.organicSessions, null);
    assert.equal(parsed.clients[0].current?.sessions, 12);
    assert.equal(parsed.clients[0].current?.keyEvents, 0);
    assert.equal(parsed.clients[0].series[0].bucket, '2026-10-07');
    assert.equal(parsed.clients[0].series[0].organicSessions, null);
    assert.throws(() => parseGa4Aggregate({
        current: [{ clientId: 'north', organicSessions: -1, sessions: 1, engagedSessions: 0, keyEvents: 0, days: 1 }],
        previous: [],
        series: [],
    }));
    assert.throws(() => parseGa4Aggregate({ current: [], previous: [] }));
});

function ga4Card(name: string, organic: Ga4MetricView, mapped = true): { name: string; ga4: Ga4CardView } {
    const blank: Ga4MetricView = { value: null, previous: null, change: null };
    return {
        name,
        ga4: {
            mapped,
            unavailable: false,
            changeNote: null,
            series: { organicSessions: [], keyEvents: [] },
            metrics: { organicSessions: organic, sessions: blank, engagementRate: blank, keyEvents: blank },
        },
    };
}

test('GA4 sort puts a missing value after a measured client and does not treat it as zero', () => {
    const withData = ga4Card('Measured', { value: 10, previous: 20, change: -0.5 });
    const missing = ga4Card('Missing', { value: null, previous: null, change: null }, false);
    const zero = ga4Card('Zero', { value: 0, previous: 0, change: 0 });
    const order = [missing, zero, withData].sort((left, right) => compareGa4Cards(left, right, 'organicSessions', { mode: 'declines', direction: 'desc' }));
    assert.deepEqual(order.map(card => card.name), ['Measured', 'Zero', 'Missing']);
});
