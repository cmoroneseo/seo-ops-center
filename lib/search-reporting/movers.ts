import { finalDates, type DateSpan } from './range';
import { CLUSTER_IMPRESSION_MINIMUM } from './types';
import type { MoverRow, ReportingSurface, StoredDay, StoredFact } from './types';

/**
 * A prior sample seen on fewer than half the window's final days is not a
 * comparable window. Those rows are mix shift and sort after real movers.
 */
export function priorSampleIsMixShift(priorObservedDays: number, priorFinalDays: number): boolean {
    return priorFinalDays > 0 && priorObservedDays * 2 < priorFinalDays;
}

interface Bucket {
    query: string;
    surface: ReportingSurface;
    current: number;
    prior: number;
    earlier: number;
    priorDays: Set<string>;
}

export function buildMovers(input: {
    facts: StoredFact[];
    dayById: Map<string, StoredDay>;
    days: Pick<StoredDay, 'date' | 'isIncomplete'>[];
    current: DateSpan;
    prior: DateSpan;
    earlier: DateSpan;
    surface: 'all' | 'organic' | 'map';
    windowDistorted: boolean;
}): MoverRow[] {
    const currentDates = finalDates(input.current, input.days);
    const priorDates = finalDates(input.prior, input.days);
    const earlierDates = finalDates(input.earlier, input.days);
    const buckets = new Map<string, Bucket>();
    for (const fact of input.facts) {
        if (fact.grain !== 'query_page') continue;
        if (input.surface === 'organic' && fact.surface !== 'organic') continue;
        if (input.surface === 'map' && fact.surface !== 'gbp_link') continue;
        const day = input.dayById.get(fact.dayId);
        if (!day || day.isIncomplete) continue;
        const query = fact.query.trim().toLowerCase().replace(/\s+/g, ' ');
        const key = `${fact.surface}\u0000${query}`;
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = { query, surface: fact.surface, current: 0, prior: 0, earlier: 0, priorDays: new Set() };
            buckets.set(key, bucket);
        }
        if (currentDates.has(day.date)) bucket.current += fact.impressions;
        else if (priorDates.has(day.date)) {
            bucket.prior += fact.impressions;
            bucket.priorDays.add(day.date);
        } else if (earlierDates.has(day.date)) bucket.earlier += fact.impressions;
    }

    const priorFinalDays = priorDates.size;
    const rows: MoverRow[] = [];
    for (const bucket of buckets.values()) {
        if (bucket.current < CLUSTER_IMPRESSION_MINIMUM || bucket.prior < CLUSTER_IMPRESSION_MINIMUM) continue;
        if (bucket.current === bucket.prior && !input.windowDistorted) continue;
        const mixShift = input.windowDistorted || priorSampleIsMixShift(bucket.priorDays.size, priorFinalDays);
        const earlierImpressions = bucket.earlier >= CLUSTER_IMPRESSION_MINIMUM ? bucket.earlier : null;
        const droppedOnce = bucket.current < bucket.prior;
        const droppedTwice = droppedOnce && earlierImpressions != null && bucket.prior < earlierImpressions;
        const drop = !mixShift && droppedTwice;
        let kind: MoverRow['kind'];
        if (mixShift) kind = 'mix_shift';
        else if (drop) kind = 'drop';
        else if (droppedOnce) kind = 'pending';
        else kind = 'rise';
        rows.push({
            query: bucket.query,
            surface: bucket.surface,
            impressions: bucket.current,
            priorImpressions: bucket.prior,
            earlierImpressions,
            kind,
            drop,
            tag: mixShift ? 'mix_shift' : null,
            reason: mixShift ? 'mix shift' : null,
        });
    }
    rows.sort(compareMovers);
    return rows;
}

export function compareMovers(a: MoverRow, b: MoverRow): number {
    const shift = Number(a.tag === 'mix_shift') - Number(b.tag === 'mix_shift');
    if (shift !== 0) return shift;
    const delta = Math.abs(b.impressions - b.priorImpressions) - Math.abs(a.impressions - a.priorImpressions);
    if (delta !== 0) return delta;
    if (a.surface !== b.surface) return a.surface.localeCompare(b.surface);
    return a.query.localeCompare(b.query);
}
