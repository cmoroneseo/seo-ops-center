import test from 'node:test';
import assert from 'node:assert/strict';
import { dateOffset } from '@/lib/gsc/history';
import {
    IMPACT_WINDOWS,
    buildLedger,
    impactKind,
    judgeAfterDays,
    ledgerInsightsHref,
    parsePlanView,
    type LedgerDayInput,
    type LedgerFactInput,
    type LedgerSource,
} from './ledger';

const TODAY = new Date('2026-10-09T18:00:00.000Z');
const CLIENT = '44444444-4444-4444-8444-444444444444';

function span(start: string, end: string): LedgerDayInput[] {
    const days: LedgerDayInput[] = [];
    for (let date = start; date <= end; date = dateOffset(date, 1)) {
        days.push({ id: date, date, isIncomplete: false });
    }
    return days;
}

function base(overrides: Partial<LedgerSource> = {}): LedgerSource {
    return {
        clientId: CLIENT,
        clientDomain: 'example.com',
        connected: true,
        property: 'sc-domain:example.com',
        lastSyncAt: '2026-10-09T16:00:00.000Z',
        lastSyncErrored: false,
        historyStart: null,
        earliestStoredDay: '2026-07-09',
        historyDays: 60,
        unsurfacedRows: 0,
        days: [],
        facts: [],
        deliverables: [],
        ...overrides,
    };
}

function prose(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(prose);
    if (value && typeof value === 'object') return Object.values(value).flatMap(prose);
    return [];
}

function assertCorrelation(value: unknown) {
    for (const text of prose(value)) {
        assert.equal(/because of/i.test(text), false, text);
        assert.equal(/\bcaused\b/i.test(text), false, text);
    }
}

test('impact windows and the plan view parser', () => {
    assert.equal(impactKind('Content', 'city_page'), 'new_page');
    assert.equal(impactKind('Content', 'blog'), 'new_page');
    assert.equal(impactKind('Content', null), 'optimization');
    assert.equal(impactKind('Other', 'technical_seo'), 'optimization');
    assert.equal(impactKind('Backlink', 'link_building'), 'backlink');
    assert.equal(impactKind('GBP', 'gbp_management'), 'gbp_post');
    assert.deepEqual(IMPACT_WINDOWS.new_page, { minDays: 30, maxDays: 90 });
    assert.deepEqual(IMPACT_WINDOWS.optimization, { minDays: 14, maxDays: 60 });
    assert.deepEqual(IMPACT_WINDOWS.gbp_post, { minDays: 7, maxDays: 30 });
    assert.deepEqual(IMPACT_WINDOWS.backlink, { minDays: 30, maxDays: 120 });
    assert.equal(judgeAfterDays('optimization'), 28);
    assert.equal(judgeAfterDays('new_page'), 30);
    assert.equal(judgeAfterDays('backlink'), 30);
    assert.equal(parsePlanView('results', true), 'results');
    assert.equal(parsePlanView('results', false), 'plan');
    assert.equal(parsePlanView('tasks', false), 'tasks');
    assert.equal(parsePlanView('nope', true), 'plan');
    assert.equal(ledgerInsightsHref(CLIENT, '2026-08'), `/workspace/${CLIENT}?tab=insights&range=2026-08`);
});

test('a shipped page joins normalized URLs and ignores v2 grains', () => {
    const days = span('2026-07-09', '2026-09-02');
    const facts: LedgerFactInput[] = [];
    for (const day of days) {
        const after = day.date >= '2026-08-06';
        facts.push({
            dayId: day.date,
            grain: 'page',
            page: 'https://example.com/chino',
            clicks: after ? 2 : 4,
            impressions: after ? 50 : 100,
            position: after ? 11.8 : 13.6,
            surface: 'organic',
        });
        if (after) {
            facts.push({
                dayId: day.date,
                grain: 'page',
                page: 'https://example.com/chino?utm_medium=gbp&utm_source=gmb',
                clicks: 1,
                impressions: 10,
                position: 3,
                surface: 'gbp_link',
            });
        }
        facts.push({
            dayId: day.date,
            grain: 'page_device',
            page: 'https://example.com/chino',
            clicks: 999,
            impressions: 99999,
            position: 1,
            surface: 'organic',
        });
        facts.push({
            dayId: day.date,
            grain: 'page_organic',
            page: 'https://example.com/chino',
            clicks: 999,
            impressions: 88888,
            position: 1,
            surface: 'organic',
        });
    }
    const model = buildLedger(base({
        days,
        facts,
        deliverables: [{
            id: 'page-1',
            title: 'Chino location page',
            type: 'Content',
            subtype: 'city_page',
            status: 'Published',
            publishedUrl: 'http://www.example.com/chino/?utm_source=newsletter',
            deliveredOn: '2026-08-06',
        }],
    }), TODAY);
    assert.equal(model.entries.length, 1);
    const entry = model.entries[0];
    assert.equal(entry.verdict, 'after_shipped');
    assert.equal(entry.chip, 'After this shipped: organic impressions 2,800 → 1,400');
    assert.equal(entry.organic?.before.impressions, 2800);
    assert.equal(entry.organic?.after.impressions, 1400);
    assert.equal(entry.organic?.before.clicks, 112);
    assert.equal(entry.map?.before.impressions, 0);
    assert.equal(entry.map?.after.impressions, 280);
    assert.equal(entry.map?.before.impressions + (entry.organic?.before.impressions ?? 0), 2800);
    assert.equal(entry.insightsHref, `/workspace/${CLIENT}?tab=insights&range=2026-08`);
    assert.equal(model.latest?.title, 'Chino location page');
    assert.equal(model.latest?.verdict, entry.chip);
    assert.equal(model.empty, null);
    assertCorrelation(model);
});

test('a covered page with no rows is a real zero, and a hole is not', () => {
    const covered = buildLedger(base({
        days: span('2026-07-09', '2026-09-02'),
        deliverables: [{
            id: 'zero',
            title: 'Quiet page',
            type: 'Content',
            subtype: 'blog',
            status: 'Published',
            publishedUrl: 'https://example.com/quiet',
            deliveredOn: '2026-08-06',
        }],
    }), TODAY);
    assert.equal(covered.entries[0].chip, 'After this shipped: organic impressions 0 → 0');
    assert.equal(covered.entries[0].organic?.after.position, null);
    assert.equal(covered.entries[0].map?.after.impressions, 0);

    const holed = span('2026-07-09', '2026-09-02').filter(day => day.date !== '2026-08-20');
    const partial = buildLedger(base({
        days: holed,
        facts: holed.map(day => ({
            dayId: day.date,
            grain: 'page',
            page: 'https://example.com/quiet',
            clicks: 5,
            impressions: 5,
            position: 4,
            surface: 'organic' as const,
        })),
        deliverables: [{
            id: 'hole',
            title: 'Quiet page',
            type: 'Content',
            subtype: 'blog',
            status: 'Published',
            publishedUrl: 'https://example.com/quiet',
            deliveredOn: '2026-08-06',
        }],
    }), TODAY);
    assert.equal(partial.entries[0].verdict, 'inconclusive');
    assert.equal(partial.entries[0].organic, null);
    assert.equal(JSON.stringify(partial.entries[0]).includes('"impressions":0'), false);
    assertCorrelation(partial);
});

test('verdict vocabulary follows the window, the baseline, and the connection', () => {
    const days = span('2026-08-10', '2026-10-09');
    const shipped = (id: string, title: string, type: string, subtype: string | null, url: string, deliveredOn: string) => ({
        id, title, type, subtype, status: 'Published', publishedUrl: url, deliveredOn,
    });
    const model = buildLedger(base({
        days,
        historyStart: '2026-08-10',
        facts: days.filter(day => day.date >= '2026-08-10').map(day => ({
            dayId: day.date,
            grain: 'page',
            page: 'https://example.com/chino',
            clicks: 1,
            impressions: 20,
            position: 8,
            surface: 'organic' as const,
        })),
        deliverables: [
            shipped('early-opt', 'Title tweak', 'Content', null, 'https://example.com/chino', '2026-09-19'),
            shipped('early-page', 'New service page', 'Content', 'service_page', 'https://example.com/service', '2026-09-11'),
            shipped('gbp', 'GBP post', 'GBP', 'gbp_management', 'https://example.com/chino', '2026-08-06'),
            shipped('yelp', 'Yelp citation', 'Backlink', 'link_building', 'https://www.yelp.com/biz/scott', '2026-08-06'),
            shipped('partial', 'August optimization', 'Content', null, 'https://example.com/chino', '2026-08-06'),
            { id: 'bare', title: 'No URL yet', type: 'Content', status: 'Published', publishedUrl: null, deliveredOn: '2026-09-01' },
        ],
    }), TODAY);

    const byId = new Map(model.entries.map(entry => [entry.id, entry]));
    assert.equal(byId.get('early-opt')?.verdict, 'too_early');
    assert.equal(byId.get('early-opt')?.chip, 'Too early to judge');
    assert.equal(byId.get('early-opt')?.organic, null);
    assert.equal(byId.get('early-page')?.verdict, 'too_early');
    assert.match(byId.get('early-page')?.detail ?? '', /day 30/);
    assert.equal(byId.get('gbp')?.chip, 'Not measurable in Search Console');
    assert.equal(byId.get('gbp')?.organic, null);
    assert.equal(byId.get('yelp')?.verdict, 'not_measurable');
    assert.equal(byId.get('partial')?.verdict, 'inconclusive');
    assert.equal(byId.get('partial')?.detail, 'Inconclusive: no 28-day baseline before Aug 6. History starts Aug 10.');
    assert.equal(byId.get('partial')?.organic, null);
    assert.equal(model.missingProof.map(item => item.id).join(), 'bare');
    assert.equal(model.entries.some(entry => entry.id === 'bare'), false);
    assertCorrelation(model);

    const offline = buildLedger(base({
        connected: false,
        property: null,
        days: [],
        deliverables: [shipped('off', 'Chino location page', 'Content', 'city_page', 'https://example.com/chino', '2026-08-06')],
    }), TODAY);
    assert.equal(offline.entries[0].detail, "Can't measure: Search Console isn't connected.");
    assert.equal(offline.entries[0].organic, null);
    assert.equal(offline.state, 'not_connected');
    assert.equal(JSON.stringify(offline.entries[0]).includes('"impressions"'), false);

    const frozen = buildLedger(base({
        lastSyncAt: '2026-10-01T15:00:00.000Z',
        days: span('2026-07-09', '2026-09-02'),
        deliverables: [shipped('old', 'Chino location page', 'Content', 'city_page', 'https://example.com/chino', '2026-08-06')],
    }), TODAY);
    assert.equal(frozen.state, 'stale');
    assert.match(frozen.entries[0].footnote ?? '', /^Results as of /);
    assert.equal(frozen.empty, null);
});

test('no shipped work uses the empty state and does not invent a latest result', () => {
    const model = buildLedger(base({ deliverables: [] }), TODAY);
    assert.equal(model.empty, 'No shipped work recorded yet. Work shows up here once it has a ship date and a page URL.');
    assert.equal(model.latest, null);
    assert.equal(model.entries.length, 0);
    assert.equal(model.gaps.find(gap => gap.id === 'missing-proof')?.value, '0');
    assertCorrelation(model);
});
