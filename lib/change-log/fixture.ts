import { dateOffset } from '@/lib/gsc/history';
import { eachDate } from '@/lib/search-reporting/range';

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

export const EXAMPLE_NOTE = "Example data. Not a live Google Search Console or Analytics pull. Shown as of Dec 15, 2026 so the 28-day check can be drawn. On Nov 10, 2026 this change is too early to tell.";
export const EXAMPLE_BASELINE_NOTE = 'Example starting point. Not read from Google Search Console.';

const H1_BEFORE = 'Hardscape, Landscape & Outdoor Living Contractors in Corona, CA';
const H1_AFTER = 'Hardscape & Landscape Contractors in Corona, CA';

export function ecoworkzH1Input(): ChangeInput {
    return {
        title: 'Homepage H1',
        changeType: 'h1',
        beforeText: H1_BEFORE,
        afterText: H1_AFTER,
        liveAtLocal: '2026-11-10T14:04',
        approvedByName: 'Carlos',
        approvedAtLocal: '2026-11-10T14:04',
        backupReference: 'Elementor template 11115',
        revertInstructions: 'Set Elementor widget 47eaa58 on page 7901 back to the long H1: Hardscape, Landscape & Outdoor Living Contractors in Corona, CA.',
        kpi: 'clicks',
        compareLastYear: true,
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
        afterText: 'El Niño promo in the header banner. Not in the H1.',
        liveAtLocal: '2026-11-10T13:28',
        approvedByName: 'Carlos',
        approvedAtLocal: '2026-11-10T13:28',
        backupReference: 'Header template 10654',
        revertInstructions: 'Turn the El Niño banner off. Do not edit the H1.',
        kpi: 'clicks',
        compareLastYear: false,
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

export function exampleConfounders(board: ExampleBoard, id: string) {
    const focus = board.changes.find(change => change.id === id);
    if (!focus) return [];
    return findConfounders(board.changes, focus, 28);
}
