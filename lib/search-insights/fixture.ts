/**
 * Example Search Insights payload for tests and the EXAMPLE preview.
 * Built through the same assembler as `GET ?view=v2`, so the screen cannot
 * drift from the read model. It is not live client data.
 */

import { dateOffset } from '@/lib/gsc/history';
import { buildSearchReporting, type BuildInput } from '@/lib/search-reporting/assemble';
import type { SearchReportingResponse, StoredDay, StoredFact } from '@/lib/search-reporting/types';

export const EXAMPLE_NOW = new Date('2026-10-09T20:00:00.000Z');
export const EXAMPLE_PROPERTY = 'sc-domain:scottcoleplumbing.com';
export const EXAMPLE_CLIENT = 'Scott Cole Plumbing';

function day(id: string, date: string, isIncomplete = false): StoredDay {
    return { id, date, isIncomplete, importedAt: '2026-10-09T00:03:00.000Z', pageLimited: false, queryLimited: false };
}

function fact(dayId: string, patch: Partial<StoredFact> & Pick<StoredFact, 'grain'>): StoredFact {
    return {
        dayId,
        page: '',
        query: '',
        clicks: 0,
        impressions: 0,
        position: 8,
        device: null,
        country: null,
        surface: 'organic',
        ...patch,
    };
}

function eachDate(start: string, end: string): string[] {
    const count = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
    return Array.from({ length: count }, (_, index) => dateOffset(start, index));
}

function factsFor(stored: StoredDay, scale: number): StoredFact[] {
    const organicImpressions = stored.date === '2026-10-03' ? 8_000 : 420 + scale;
    const mapImpressions = stored.date === '2026-10-03' ? 900 : 80 + (scale % 40);
    return [
        fact(stored.id, { grain: 'property', clicks: Math.round(organicImpressions / 80), impressions: organicImpressions + mapImpressions, position: 11 }),
        fact(stored.id, {
            grain: 'page',
            page: 'https://scottcoleplumbing.com/services',
            clicks: Math.max(1, Math.round(organicImpressions / 120)),
            impressions: organicImpressions,
            position: 12.4,
            surface: 'organic',
        }),
        fact(stored.id, {
            grain: 'page',
            page: 'https://scottcoleplumbing.com/contact?utm_medium=gbp',
            clicks: Math.max(1, Math.round(mapImpressions / 30)),
            impressions: mapImpressions,
            position: 3.2,
            surface: 'gbp_link',
        }),
        fact(stored.id, {
            grain: 'query_page',
            query: 'plumber eastvale',
            page: 'https://scottcoleplumbing.com/services',
            clicks: 2,
            impressions: 80,
            position: 4.2,
            surface: 'organic',
        }),
        fact(stored.id, {
            grain: 'query_page',
            query: 'emergency plumber corona',
            page: 'https://scottcoleplumbing.com/corona',
            clicks: 1,
            impressions: 55,
            position: 9,
            surface: 'organic',
        }),
        fact(stored.id, {
            grain: 'query_page',
            query: 'plumber chino',
            page: 'https://scottcoleplumbing.com/contact?utm_medium=gbp',
            clicks: 1,
            impressions: 30,
            position: 2.4,
            surface: 'gbp_link',
        }),
    ];
}

export function exampleReportingInput(): BuildInput {
    const september = eachDate('2026-09-01', '2026-09-30').map((date, index) => day(`sep-${index}`, date));
    const october = eachDate('2026-10-01', '2026-10-09')
        .filter(date => date !== '2026-10-04')
        .map((date, index) => day(`oct-${index}`, date, date >= '2026-10-07'));
    const days = [...september, ...october];
    const facts = days.flatMap((stored, index) => factsFor(stored, index % 17));
    return {
        now: EXAMPLE_NOW,
        range: '2026-10',
        surface: 'all',
        device: null,
        cityTokens: ['Eastvale', 'Corona', 'Chino', 'Yorba Linda'],
        connected: true,
        property: EXAMPLE_PROPERTY,
        clientName: EXAMPLE_CLIENT,
        days,
        facts,
        ahrefsRows: [
            { query: 'plumber eastvale', position: 27 },
            { query: 'emergency plumber corona', position: 8 },
        ],
        ahrefsSyncedAt: '2026-09-30T17:00:00.000Z',
        lastSyncAt: '2026-10-09T00:03:00.000Z',
        lastSyncErrored: false,
    };
}

export function exampleInsights(): SearchReportingResponse {
    return buildSearchReporting(exampleReportingInput());
}

export function disconnectedInsights(): SearchReportingResponse {
    return buildSearchReporting({
        ...exampleReportingInput(),
        connected: false,
        property: null,
        days: [],
        facts: [],
        ahrefsRows: [],
    });
}
