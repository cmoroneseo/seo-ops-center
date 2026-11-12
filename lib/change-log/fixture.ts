import { dateOffset } from '@/lib/gsc/history';
import { eachDate } from '@/lib/search-reporting/range';

import { buildPageImpactRows, sumDaySeries } from './group';
import { buildImpact, findConfounders, timelineItem } from './impact';
import type { DayPoint, ImpactModel, SeoChange, TimelineItem } from './types';
import { normalizeChange, type ChangeInput } from './validate';

/**
 * Example clock, not the real one. Dec 15, 2026 noon Pacific so a Nov 10
 * change has a finished 28-day window. Numbers below are synthetic.
 */
export const EXAMPLE_AS_OF = new Date('2026-12-15T20:00:00.000Z');
/** Pacific date of EXAMPLE_AS_OF. Example screens use this as "today". */
export const EXAMPLE_TODAY = '2026-12-15';
/**
 * Nov 12, 2026 noon Pacific. The Ecoworkz H1 went live Nov 10, and Search
 * Console is final through Nov 9, so test progress is 0%.
 */
export const EARLY_AS_OF = new Date('2026-11-12T20:00:00.000Z');
export const EARLY_TODAY = '2026-11-12';
export const EARLY_NOTE = 'Example clock set to Nov 12, 2026. This went live Nov 10. Search Console is final through Nov 9, so test progress is 0%. Not a live pull.';
export const GROUP_NOTE = 'Example group test. Synthetic numbers so the test period can be drawn. Not a live Search Console pull, and not the Ecoworkz homepage.';

export const EXAMPLE_NOTE = "Example data. Not a live Google Search Console or Analytics pull. Shown as of Dec 15, 2026 so the 28-day check can be drawn. On Nov 10, 2026 this change is too early to tell.";
export const EXAMPLE_BASELINE_NOTE = 'Example starting point. Not read from Google Search Console.';

const H1_BEFORE = 'Hardscape, Landscape & Outdoor Living Contractors in Corona, CA';
const H1_AFTER = 'Hardscape & Landscape Contractors in Corona, CA';

export function ecoworkzH1Input(): ChangeInput {
    return {
        title: 'Homepage main heading',
        changeType: 'h1',
        beforeText: H1_BEFORE,
        afterText: H1_AFTER,
        liveAtLocal: '2026-11-10T14:04',
        approvedByName: 'Carlos',
        approvedAtLocal: '2026-11-10T14:04',
        backupReference: 'Saved copy of the old homepage heading',
        revertInstructions: 'Put the main heading back to: Hardscape, Landscape & Outdoor Living Contractors in Corona, CA.',
        kpi: 'clicks',
        compareLastYear: true,
        testKind: 'single',
        treatment: '',
        pages: [{
            url: 'https://www.ecoworkz.net/',
            label: 'Homepage',
            cmsPageId: '7901',
            cmsWidgetId: '47eaa58',
        }],
        queries: [
            'hardscape contractors corona',
            'landscape contractors corona',
            'corona landscaping',
        ],
    };
}

export function elNinoInput(): ChangeInput {
    return {
        title: 'El Niño promo banner',
        changeType: 'cro_block',
        beforeText: 'No El Niño sale banner.',
        afterText: 'El Niño promo in the header banner. Not in the main heading.',
        liveAtLocal: '2026-11-10T13:28',
        approvedByName: 'Carlos',
        approvedAtLocal: '2026-11-10T13:28',
        backupReference: 'Saved copy of the old header',
        revertInstructions: 'Turn the El Niño banner off. Do not edit the main heading.',
        kpi: 'clicks',
        compareLastYear: false,
        testKind: 'single',
        treatment: '',
        pages: [{
            url: 'https://www.ecoworkz.net/',
            label: 'Homepage',
            cmsPageId: '7901',
            cmsWidgetId: '',
        }],
        queries: [],
    };
}

interface Daily {
    clicks: number;
    impressions: number;
    position: number;
    organicSessions: number | null;
    keyEvents: number | null;
}

function fill(start: string, end: string, daily: Daily): DayPoint[] {
    return eachDate(start, end).map(date => ({ date, ...daily }));
}

function changeFrom(id: string, input: ChangeInput): SeoChange {
    const normalized = normalizeChange(input);
    if (!normalized) throw new Error(`Example change ${id} is invalid`);
    return { id, clientId: 'example-ecoworkz', ...normalized };
}

export interface ExampleBoard {
    asOf: Date;
    note: string;
    changes: SeoChange[];
    impacts: Record<string, ImpactModel>;
    items: TimelineItem[];
}

export function exampleBoard(now: Date = EXAMPLE_AS_OF): ExampleBoard {
    const h1 = changeFrom('example-ecoworkz-h1', ecoworkzH1Input());
    const promo = changeFrom('example-ecoworkz-elnino', elNinoInput());
    const liveOn = h1.liveOn;
    const beforeStart = dateOffset(liveOn, -28);
    const beforeEnd = dateOffset(liveOn, -1);
    const afterStart = liveOn;
    const afterEnd = '2026-12-12';

    const siteBefore: Daily = { clicks: 88, impressions: 2200, position: 19, organicSessions: 40, keyEvents: 4 };
    const siteAfter: Daily = { clicks: 94, impressions: 2230, position: 18.5, organicSessions: 42, keyEvents: 4 };
    const sitewide = [
        ...fill(beforeStart, beforeEnd, siteBefore),
        ...fill(afterStart, afterEnd, siteAfter),
    ];
    const h1Page = [
        ...fill(beforeStart, beforeEnd, { clicks: 8, impressions: 200, position: 22, organicSessions: 4, keyEvents: 0.5 }),
        ...fill(afterStart, afterEnd, { clicks: 12, impressions: 210, position: 16, organicSessions: 6, keyEvents: 0.8 }),
    ];
    const promoPage = [
        ...fill(beforeStart, beforeEnd, { clicks: 10, impressions: 300, position: 20, organicSessions: 3, keyEvents: 0.2 }),
        ...fill(afterStart, afterEnd, { clicks: 10, impressions: 300, position: 20, organicSessions: 3, keyEvents: 0.2 }),
    ];
    const yoyStart = dateOffset('2025-11-10', -28);
    const yoyEnd = dateOffset('2025-11-10', -1);
    const yoyPage = fill(yoyStart, yoyEnd, { clicks: 5, impressions: 180, position: 26, organicSessions: 3, keyEvents: 0.2 });

    function queries(scale: number) {
        return [
            { query: 'hardscape contractors corona', before: { clicks: 0, impressions: 2, position: 16 }, after: { clicks: 1, impressions: 3, position: 12 } },
            { query: 'landscape contractors corona', before: { clicks: 0, impressions: 1, position: 24 }, after: { clicks: 1, impressions: 2, position: 18 } },
            { query: 'corona landscaping', before: { clicks: 0, impressions: 2, position: 28 }, after: { clicks: 0, impressions: 3, position: 20 } },
        ].map(row => ({
            query: row.query,
            days: [
                ...fill(beforeStart, beforeEnd, { ...row.before, organicSessions: null, keyEvents: null, clicks: row.before.clicks * scale, impressions: row.before.impressions * scale }),
                ...fill(afterStart, afterEnd, { ...row.after, organicSessions: null, keyEvents: null, clicks: row.after.clicks * scale, impressions: row.after.impressions * scale }),
            ],
        }));
    }

    const h1Impact = buildImpact({
        liveOn,
        kpi: 'clicks',
        now,
        compareLastYear: true,
        gscConnected: true,
        ga4Connected: true,
        pageDays: h1Page,
        sitewideDays: sitewide,
        yoyPageDays: yoyPage,
        queries: queries(1),
    });
    const promoImpact = buildImpact({
        liveOn: promo.liveOn,
        kpi: 'clicks',
        now,
        compareLastYear: false,
        gscConnected: true,
        ga4Connected: true,
        pageDays: promoPage,
        sitewideDays: sitewide,
    });
    const changes = [h1, promo];
    const impacts = { [h1.id]: h1Impact, [promo.id]: promoImpact };
    return {
        asOf: now,
        note: EXAMPLE_NOTE,
        changes,
        impacts,
        items: changes
            .map(change => timelineItem(change, impacts[change.id]))
            .sort((a, b) => b.liveAt.localeCompare(a.liveAt) || a.title.localeCompare(b.title)),
    };
}

const GROUP_LIVE = '2026-09-15T09:00';

/** Synthetic group. Live Sep 15 so the 56-day window is final by the example clock. */
export function exampleGroupInput(): ChangeInput {
    return {
        title: 'Title and meta description format',
        changeType: 'other',
        beforeText: 'City | Service | Brand',
        afterText: 'Service in City | Brand',
        liveAtLocal: GROUP_LIVE,
        approvedByName: 'Carlos',
        approvedAtLocal: GROUP_LIVE,
        backupReference: 'Saved copy of the old titles and descriptions',
        revertInstructions: 'Put the old title and description back on each page.',
        kpi: 'clicks',
        compareLastYear: false,
        testKind: 'group',
        treatment: 'title_meta',
        pages: [
            { url: 'https://www.northshore-example.test/services/hardscape', label: 'Hardscape', cmsPageId: '', cmsWidgetId: '' },
            { url: 'https://www.northshore-example.test/services/landscape', label: 'Landscape', cmsPageId: '', cmsWidgetId: '' },
            { url: 'https://www.northshore-example.test/services/pavers', label: 'Pavers', cmsPageId: '', cmsWidgetId: '' },
        ],
        queries: [],
    };
}

export function exampleGroupBoard(now: Date = EXAMPLE_AS_OF): ExampleBoard {
    const change = changeFrom('example-group-title-meta', exampleGroupInput());
    const liveOn = change.liveOn;
    const beforeStart = dateOffset(liveOn, -28);
    const beforeEnd = dateOffset(liveOn, -1);
    const afterStart = liveOn;
    const afterEnd = '2026-12-12';
    const members: Array<{ before: Daily; after: Daily }> = [
        {
            before: { clicks: 5, impressions: 120, position: 18, organicSessions: 2, keyEvents: 0.2 },
            after: { clicks: 8, impressions: 140, position: 14, organicSessions: 3, keyEvents: 0.4 },
        },
        {
            before: { clicks: 6, impressions: 150, position: 16, organicSessions: 2, keyEvents: 0.2 },
            after: { clicks: 6, impressions: 155, position: 16, organicSessions: 2, keyEvents: 0.2 },
        },
        {
            before: { clicks: 3, impressions: 90, position: 24, organicSessions: 1, keyEvents: 0.1 },
            after: { clicks: 2, impressions: 80, position: 27, organicSessions: 1, keyEvents: 0.1 },
        },
    ];
    const series = members.map(member => [
        ...fill(beforeStart, beforeEnd, member.before),
        ...fill(afterStart, afterEnd, member.after),
    ]);
    const sitewide = [
        ...fill(beforeStart, beforeEnd, { clicks: 80, impressions: 2000, position: 20, organicSessions: 40, keyEvents: 4 }),
        ...fill(afterStart, afterEnd, { clicks: 84, impressions: 2050, position: 19.5, organicSessions: 42, keyEvents: 4 }),
    ];
    const impact = buildImpact({
        liveOn,
        kpi: 'clicks',
        now,
        compareLastYear: false,
        gscConnected: true,
        ga4Connected: true,
        pageDays: sumDaySeries(series),
        sitewideDays: sitewide,
    });
    impact.pageRows = buildPageImpactRows({
        pages: change.pages,
        series,
        liveOn,
        finalThrough: impact.finalThrough,
        afterDays: impact.headline.ready ? impact.headline.days : null,
    });
    return {
        asOf: now,
        note: GROUP_NOTE,
        changes: [change],
        impacts: { [change.id]: impact },
        items: [timelineItem(change, impact)],
    };
}

export function exampleConfounders(board: ExampleBoard, id: string) {
    const focus = board.changes.find(change => change.id === id);
    if (!focus) return [];
    return findConfounders(board.changes, focus, 28);
}
