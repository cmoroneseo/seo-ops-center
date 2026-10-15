/** Pure rollups over stored GA4 daily rows and GSC property-grain facts. */

export interface Ga4DayMetric {
    day: string;
    property: string;
    organicSessions: number | null;
    sessions: number | null;
    engagedSessions: number | null;
    keyEvents: number | null;
}

export interface GscDayMetric {
    day: string;
    property: string;
    clicks: number;
    impressions: number;
    position: number;
}

export interface Ga4Totals {
    organicSessions: number | null;
    sessions: number | null;
    engagedSessions: number | null;
    keyEvents: number | null;
}

export interface GscTotals {
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    position: number | null;
}

export function chooseProperty(properties: string[], configured: string | null): { ok: true; property: string | null } | { ok: false } {
    const distinct = [...new Set(properties.filter(property => property.length > 0))];
    if (configured) return { ok: true, property: configured };
    if (distinct.length <= 1) return { ok: true, property: distinct[0] ?? null };
    return { ok: false };
}

export function aggregateGa4(rows: Ga4DayMetric[]): { totals: Ga4Totals; coverageDays: number; propertyIds: string[] } {
    const days = new Set(rows.map(row => row.day));
    return {
        coverageDays: days.size,
        propertyIds: rows.map(row => row.property),
        totals: {
            organicSessions: roundMetric(sumMetric(rows.map(row => row.organicSessions))),
            sessions: roundMetric(sumMetric(rows.map(row => row.sessions))),
            engagedSessions: roundMetric(sumMetric(rows.map(row => row.engagedSessions))),
            keyEvents: roundMetric(sumMetric(rows.map(row => row.keyEvents))),
        },
    };
}

export function aggregateGsc(rows: GscDayMetric[]): { totals: GscTotals; coverageDays: number; propertyIds: string[] } {
    const days = new Set(rows.map(row => row.day));
    if (rows.length === 0) {
        return {
            coverageDays: 0,
            propertyIds: [],
            totals: { clicks: null, impressions: null, ctr: null, position: null },
        };
    }
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    return {
        coverageDays: days.size,
        propertyIds: rows.map(row => row.property),
        totals: {
            clicks,
            impressions,
            ctr: impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 10_000 : null,
            position: weightedPosition(rows),
        },
    };
}

export function emptyGa4Totals(): Ga4Totals {
    return { organicSessions: null, sessions: null, engagedSessions: null, keyEvents: null };
}

function sumMetric(values: Array<number | null>): number | null {
    let total = 0;
    let seen = false;
    for (const value of values) {
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        seen = true;
        total += value;
    }
    return seen ? total : null;
}

function roundMetric(value: number | null): number | null {
    if (value == null) return null;
    return Math.round(value * 1000) / 1000;
}

function weightedPosition(rows: GscDayMetric[]): number | null {
    let impressions = 0;
    let weighted = 0;
    for (const row of rows) {
        if (!Number.isFinite(row.impressions) || row.impressions <= 0) continue;
        if (!Number.isFinite(row.position)) continue;
        impressions += row.impressions;
        weighted += row.position * row.impressions;
    }
    if (impressions <= 0) return null;
    return Math.round((weighted / impressions) * 10) / 10;
}
