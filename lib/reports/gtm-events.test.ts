import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildGtmEventsReport,
    formatPrior,
    friendlyPropertyLabel,
    isExcludedLinkText,
    parseGtmEventsSnapshot,
    type BuildGtmEventsInput,
    type Ga4LinkRow,
} from './gtm-events.ts';

const forbidden = /\(not set\)|\(other\)|\bNone\b|customEvent:|linkDomain|parameter/i;

function link(partial: Partial<Ga4LinkRow> & Pick<Ga4LinkRow, 'eventName' | 'count'>): Ga4LinkRow {
    return partial;
}

function input(overrides: Partial<BuildGtmEventsInput> = {}): BuildGtmEventsInput {
    return {
        clientName: 'Kentina Hospitality',
        reportMonth: '2026-10',
        capturedAt: '2026-11-09T18:00:00.000Z',
        sessions: { current: 592, prior: 361 },
        events: { current: [], prior: [] },
        links: { current: [], prior: [] },
        daily: [],
        excludedLinkTexts: ['Allow cookies', 'Decline'],
        tagSource: 'gtm',
        tags: [
            { name: 'Outbound', eventName: 'property_outbound_click', paused: false },
            { name: 'Booking', eventName: 'booking_click', paused: false },
            { name: 'Quiet', eventName: 'email_click', paused: false },
        ],
        fallbackEventNames: [],
        outboundEventName: 'property_outbound_click',
        bookingEventName: 'booking_click',
        ticketEventName: 'buy_tickets_click',
        ...overrides,
    };
}

test('friendly names replace missing property labels and keep a real name', () => {
    assert.equal(friendlyPropertyLabel('(not set)', 'https://www.deportolawinetrail.com/store'), 'De Portola Wine Trail');
    assert.equal(friendlyPropertyLabel('None', 'deportolawinetrail.com'), 'De Portola Wine Trail');
    assert.equal(friendlyPropertyLabel('(other)', 'bookeo.com'), 'Bookeo');
    assert.equal(friendlyPropertyLabel('Danza del Sol', 'danzadelsolwinery.com'), 'Danza del Sol');
    assert.equal(friendlyPropertyLabel('  ', 'masiadelavinya.com'), 'Masia de la Vinya');
});

test('a prior-month zero is an em dash, never the word None', () => {
    assert.equal(formatPrior(0), '—');
    assert.equal(formatPrior(0).includes('None'), false);
    assert.equal(formatPrior(63), '63');
});

test('consent clicks are excluded only when they are on this client list', () => {
    assert.equal(isExcludedLinkText('Allow Cookies', ['Allow cookies', 'Decline']), true);
    assert.equal(isExcludedLinkText('Decline', ['Allow cookies', 'Decline']), true);
    assert.equal(isExcludedLinkText('See Details', ['Allow cookies', 'Decline']), false);
    assert.equal(isExcludedLinkText('Allow cookies', []), false);
});

test('rows keep a report-month count, drop consent clicks, and hide sentinel labels', () => {
    const report = buildGtmEventsReport(input({
        events: {
            current: [
                { eventName: 'page_view', count: 10 },
                { eventName: 'property_outbound_click', count: 18 },
                { eventName: 'booking_click', count: 6 },
                { eventName: 'click', count: 9 },
                { eventName: '(not set)', count: 4 },
                { eventName: 'only_prior', count: 0 },
            ],
            prior: [
                { eventName: 'only_prior', count: 9 },
                { eventName: 'property_outbound_click', count: 4 },
                { eventName: 'page_view', count: 0 },
            ],
        },
        links: {
            current: [
                link({ eventName: 'property_outbound_click', count: 10, linkText: 'Allow cookies', linkDomain: 'example.com', property: '(not set)' }),
                link({ eventName: 'property_outbound_click', count: 8, linkText: 'See Details', linkDomain: 'danzadelsolwinery.com', property: 'Danza del Sol' }),
                link({ eventName: 'property_outbound_click', count: 2, linkText: 'Buy Tickets', linkDomain: 'deportolawinetrail.com', property: '(not set)' }),
                link({ eventName: 'booking_click', count: 4, linkText: 'Decline', linkUrl: 'https://staykentina.com/book-online/?utm_source=a' }),
                link({ eventName: 'booking_click', count: 1, linkText: 'Start Your Booking', linkUrl: 'https://staykentina.com/book-online/?utm_source=a', property: 'Stay Kentina' }),
                link({ eventName: 'booking_click', count: 1, linkText: 'Start Your Booking', linkUrl: 'https://staykentina.com/book-online/?utm_source=b', property: 'Stay Kentina' }),
                link({ eventName: 'click', count: 3, linkText: 'Allow cookies', linkDomain: 'kentina.com' }),
            ],
            prior: [
                link({ eventName: 'property_outbound_click', count: 4, linkText: 'See Details', linkDomain: 'danzadelsolwinery.com', property: '(other)' }),
            ],
        },
        daily: [
            { date: '20261001', eventName: 'page_view', count: 7 },
            { date: '20261002', eventName: 'page_view', count: 3 },
        ],
    }));

    assert.deepEqual(report.events.map(row => row.name), ['page_view', 'click', 'property_outbound_click', 'booking_click']);
    assert.equal(report.events.some(row => row.name === 'only_prior'), false);
    assert.equal(report.events.find(row => row.name === 'page_view')?.prior, 0);
    assert.equal(formatPrior(report.events.find(row => row.name === 'page_view')?.prior ?? 0), '—');
    assert.equal(report.events.find(row => row.name === 'property_outbound_click')?.current, 8);
    assert.equal(report.events.find(row => row.name === 'booking_click')?.current, 2);
    assert.equal(report.events.find(row => row.name === 'click')?.current, 9);
    assert.equal(report.kpis.tagEvents.current, 10);
    assert.equal(report.kpis.tagEvents.tagsRecorded, 2);
    assert.equal(report.kpis.tagEvents.tagsActive, 3);
    assert.equal(report.kpis.totalEvents.current, 10 + 18 + 6 + 9 + 0);
    assert.deepEqual(report.outbound?.byProperty.map(row => [row.label, row.current, row.prior]), [
        ['Danza del Sol', 8, 4],
        ['De Portola Wine Trail', 2, 0],
    ]);
    assert.equal(report.outbound?.byLink.some(row => row.label === 'Allow cookies'), false);
    assert.equal(report.booking?.rows.some(row => row.label === 'Decline'), false);
    assert.equal(report.booking?.rows[0]?.current, 2);
    assert.equal(report.booking?.rows[0]?.destination, 'staykentina.com/book-online');
    assert.equal(JSON.stringify(report).match(forbidden), null);
    assert.equal(report.copy.events.includes('October'), true);
    assert.equal(report.copy.tagEvents.includes('2 of 3'), true);
});

test('without an exclusion list, cookie-banner clicks stay in the outbound table', () => {
    const report = buildGtmEventsReport(input({
        excludedLinkTexts: [],
        events: { current: [{ eventName: 'property_outbound_click', count: 3 }], prior: [] },
        links: {
            current: [link({ eventName: 'property_outbound_click', count: 3, linkText: 'Allow cookies', linkDomain: 'example.com', property: 'Banner' })],
            prior: [],
        },
        tags: [{ name: 'Outbound', eventName: 'property_outbound_click', paused: false }],
    }));
    assert.equal(report.outbound?.byLink[0]?.label, 'Allow cookies');
    assert.equal(report.kpis.tagEvents.current, 3);
});

test('a disconnected Tag Manager report stays on Analytics and says so in plain language', () => {
    const unavailable = buildGtmEventsReport(input({
        tagSource: 'unavailable',
        tags: [],
        events: { current: [{ eventName: 'page_view', count: 4 }], prior: [] },
    }));
    assert.equal(unavailable.kpis.tagEvents.current, null);
    assert.match(unavailable.copy.tagEvents, /Tag Manager is not connected/);
    assert.equal(unavailable.copy.tagEvents.includes('tagmanager'), false);

    const saved = buildGtmEventsReport(input({
        tagSource: 'saved_list',
        tags: [],
        fallbackEventNames: ['booking_click'],
        events: {
            current: [{ eventName: 'booking_click', count: 5 }, { eventName: 'page_view', count: 2 }],
            prior: [{ eventName: 'booking_click', count: 1 }],
        },
    }));
    assert.equal(saved.kpis.tagEvents.current, 5);
    assert.equal(saved.kpis.tagEvents.source, 'saved_list');
    assert.match(saved.copy.tagEvents, /saved event list/);
});

test('a stored snapshot drops staff fields and rows that have no report-month count', () => {
    const report = buildGtmEventsReport(input({
        events: { current: [{ eventName: 'page_view', count: 2 }], prior: [] },
    }));
    const parsed = parseGtmEventsSnapshot({
        ...report,
        staffNote: 'https://www.googleapis.com/auth/tagmanager.readonly',
        refresh_token: 'secret-token',
        events: [...report.events, { name: 'hidden', current: 0, prior: 4 }],
    });
    assert.ok(parsed);
    const serialized = JSON.stringify(parsed);
    assert.equal(serialized.includes('staffNote'), false);
    assert.equal(serialized.includes('refresh_token'), false);
    assert.equal(serialized.includes('secret-token'), false);
    assert.equal(serialized.includes('tagmanager.readonly'), false);
    assert.equal(parsed?.events.some(row => row.name === 'hidden'), false);
    assert.equal(parseGtmEventsSnapshot({ schemaVersion: 1 }), null);
});
