import type { SearchMetrics, StoredDay, StoredFact } from './types';

/** Same rounding as `deriveMonthlyGsc`, so a final month matches the report. */
export function sumMetrics(rows: { clicks: number; impressions: number; position: number }[]): SearchMetrics {
    let clicks = 0;
    let impressions = 0;
    let positionSum = 0;
    for (const row of rows) {
        clicks += row.clicks;
        impressions += row.impressions;
        positionSum += row.position * row.impressions;
    }
    return {
        clicks,
        impressions,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 10000 : null,
        position: impressions > 0 ? Math.round((positionSum / impressions) * 10) / 10 : null,
    };
}

export function dayIndex(days: StoredDay[]): { byId: Map<string, StoredDay>; byDate: Map<string, StoredDay> } {
    const byId = new Map<string, StoredDay>();
    const byDate = new Map<string, StoredDay>();
    for (const day of days) {
        byId.set(day.id, day);
        byDate.set(day.date, day);
    }
    return { byId, byDate };
}

export function datedFacts(facts: StoredFact[], byId: Map<string, StoredDay>): (StoredFact & { date: string; isIncomplete: boolean })[] {
    const dated = [];
    for (const fact of facts) {
        const day = byId.get(fact.dayId);
        if (!day) continue;
        dated.push({ ...fact, date: day.date, isIncomplete: day.isIncomplete });
    }
    return dated;
}
