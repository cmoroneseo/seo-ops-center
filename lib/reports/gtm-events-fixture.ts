import type { GtmEventsSnapshot } from './gtm-events';

function spread(total: number, peakDay: number, peak: number): number[] {
    const days = Array.from({ length: 31 }, () => 0);
    const peakIndex = Math.max(0, peakDay - 1);
    days[peakIndex] = Math.min(peak, total);
    let left = total - days[peakIndex];
    for (let step = 0; left > 0; step += 1) {
        const index = step % 31;
        if (index === peakIndex) continue;
        days[index] += 1;
        left -= 1;
    }
    return days;
}

function trend(eventName: string, total: number, peakDay: number, peak: number): GtmEventsSnapshot['trends'][number] {
    return { eventName, total, days: spread(total, peakDay, peak), peakCount: peak, peakDay };
}

/** October 2026 shape from the approved Kentina mockup, for preview and tests. */
export function kentinaOctoberFixture(): GtmEventsSnapshot {
    return {
        schemaVersion: 1,
        capturedAt: '2026-11-09T18:00:00.000Z',
        clientName: 'Kentina Hospitality',
        reportMonth: '2026-10',
        priorMonth: '2026-09',
        periodLabel: 'October 1–31, 2026',
        priorPeriodLabel: 'September 1–30, 2026',
        monthShort: 'Oct',
        priorShort: 'Sep',
        copy: {
            lede: 'Kentina Hospitality · October 1–31, 2026 · compared with September 1–30, 2026',
            totalEvents: 'All events recorded on the site.',
            tagEvents: 'Events recorded by the tags on this site. 5 of 7 tags recorded events.',
            sessions: 'Sessions give context for the event counts.',
            events: 'Every event recorded in October, sorted by count and compared with September. Only events with an October count are listed.',
            outbound: 'Which properties and links were clicked in October, compared with September.',
            links: 'The same clicks, listed by the words on the link. Only links with an October count are listed.',
            booking: 'Booking links clicked in October, compared with September.',
            tickets: 'Ticket links clicked in October, compared with September.',
            trends: 'Daily counts for the busiest events. Each chart has its own scale.',
        },
        kpis: {
            totalEvents: { current: 3010, prior: 2144 },
            tagEvents: { current: 73, prior: 99, source: 'gtm', tagsRecorded: 5, tagsActive: 7 },
            sessions: { current: 592, prior: 361 },
        },
        events: [
            { name: 'page_view', current: 974, prior: 665 },
            { name: 'user_engagement', current: 637, prior: 500 },
            { name: 'session_start', current: 591, prior: 363 },
            { name: 'first_visit', current: 430, prior: 246 },
            { name: 'scroll', current: 187, prior: 118 },
            { name: 'click', current: 73, prior: 107 },
            { name: 'property_outbound_click', current: 41, prior: 63 },
            { name: 'booking_click', current: 24, prior: 24 },
            { name: 'buy_tickets_click', current: 6, prior: 9 },
            { name: 'inquiry_click', current: 1, prior: 3 },
            { name: 'email_click', current: 1, prior: 0 },
        ],
        outbound: {
            eventName: 'property_outbound_click',
            current: 41,
            prior: 63,
            rows: [],
            byProperty: [
                { label: 'Danza del Sol', detail: null, destination: 'danzadelsolwinery.com', current: 14, prior: 19 },
                { label: 'Masia de la Vinya', detail: null, destination: 'masiadelavinya.com', current: 9, prior: 14 },
                { label: 'Native Falls', detail: null, destination: 'nativefalls.com', current: 8, prior: 4 },
                { label: 'Cross Creek Golf', detail: null, destination: 'crosscreekgolfclub.com', current: 6, prior: 6 },
                { label: 'De Portola Wine Trail', detail: null, destination: 'deportolawinetrail.com', current: 2, prior: 0 },
                { label: 'Galway Downs', detail: null, destination: 'galwaydowns.com', current: 1, prior: 3 },
                { label: 'Bookeo', detail: null, destination: 'bookeo.com', current: 1, prior: 0 },
            ],
            byLink: [
                { label: 'See Details', detail: 'Danza del Sol', destination: 'danzadelsolwinery.com', current: 8, prior: 7 },
                { label: 'Book This Experience', detail: 'Danza del Sol', destination: 'danzadelsolwinery.com', current: 5, prior: 1 },
                { label: 'Visit Native Falls Campground', detail: 'Native Falls', destination: 'nativefalls.com', current: 5, prior: 1 },
                { label: 'See Details', detail: 'Masia de la Vinya', destination: 'masiadelavinya.com', current: 4, prior: 6 },
                { label: 'Visit Cross Creek Golf Club', detail: 'Cross Creek Golf', destination: 'crosscreekgolfclub.com', current: 4, prior: 4 },
                { label: 'Buy Tickets', detail: 'De Portola Wine Trail', destination: 'deportolawinetrail.com', current: 2, prior: 0 },
            ],
        },
        booking: {
            eventName: 'booking_click',
            current: 24,
            prior: 24,
            rows: [
                { label: 'Visit Ranch Houses', detail: 'Stay Kentina', destination: 'staykentina.com/accommodation/gd-ranch-house/', current: 10, prior: 11 },
                { label: 'Start Your Booking', detail: 'Native Falls', destination: 'nativefalls.com/book-online/', current: 6, prior: 4 },
                { label: 'Book Your Stay', detail: 'Stay Kentina', destination: 'staykentina.com/accommodation/gd-ranch-house/', current: 4, prior: 1 },
                { label: 'Start Your Booking', detail: 'Stay Kentina', destination: 'staykentina.com/book-online/', current: 3, prior: 2 },
                { label: 'Cross Creek Golf', detail: null, destination: 'crosscreekgolfclub.com/tee-times', current: 1, prior: 0 },
            ],
        },
        tickets: {
            eventName: 'buy_tickets_click',
            current: 6,
            prior: 9,
            rows: [
                { label: 'Harvest Celebration on the De Portola Wine Trail', detail: null, destination: 'deportolawinetrail.com/store/Harvest-Celebration-Ticket', current: 2, prior: 0 },
                { label: 'Sushi Happy Hour', detail: null, destination: 'exploretock.com/masiadevinya/event/626258/sushi-happy-hour', current: 2, prior: 0 },
                { label: 'Blending for a Cause', detail: null, destination: 'exploretock.com/danzadelsolwinery/event/624075/blending-for-a-cause', current: 1, prior: 0 },
                { label: 'Rock the Rosé', detail: null, destination: 'exploretock.com/danzadelsolwinery/event/625570/rock-the-rose', current: 1, prior: 0 },
            ],
        },
        trends: [
            trend('page_view', 974, 1, 133),
            trend('scroll', 187, 1, 22),
            trend('property_outbound_click', 41, 8, 6),
            trend('click', 73, 8, 10),
            trend('booking_click', 24, 16, 6),
            trend('buy_tickets_click', 6, 8, 6),
        ],
    };
}
