import { eachDate } from './range';
import { sumMetrics } from './metrics';
import type { DateSpan } from './range';
import type { DayPoint, ReportingSurface, SearchMetrics, StoredDay } from './types';

export interface DatedMetric {
    date: string;
    isIncomplete: boolean;
    grain: string;
    surface: ReportingSurface | 'property';
    device: string | null;
    clicks: number;
    impressions: number;
    position: number;
}

export function pointsFor(
    span: DateSpan,
    daysByDate: Map<string, StoredDay>,
    rows: DatedMetric[],
    predicate: (row: DatedMetric) => boolean,
): { series: DayPoint[]; totals: SearchMetrics | null; mask: { date: string; reason: 'preliminary' | 'missing' }[] } {
    const byDate = new Map<string, DatedMetric[]>();
    for (const row of rows) {
        if (!predicate(row) || row.date < span.start || row.date > span.end) continue;
        const list = byDate.get(row.date);
        if (list) list.push(row);
        else byDate.set(row.date, [row]);
    }
    const series: DayPoint[] = [];
    const mask: { date: string; reason: 'preliminary' | 'missing' }[] = [];
    const totalRows: DatedMetric[] = [];
    let covered = false;
    for (const date of eachDate(span.start, span.end)) {
        const day = daysByDate.get(date);
        const dayRows = byDate.get(date) ?? [];
        if (!day) {
            series.push({ date, clicks: null, impressions: null, position: null, preliminary: false, missing: true });
            mask.push({ date, reason: 'missing' });
            continue;
        }
        const metrics = sumMetrics(dayRows);
        if (day.isIncomplete) {
            series.push({ date, clicks: metrics.clicks, impressions: metrics.impressions, position: metrics.position, preliminary: true, missing: false });
            mask.push({ date, reason: 'preliminary' });
            continue;
        }
        series.push({ date, clicks: metrics.clicks, impressions: metrics.impressions, position: metrics.position, preliminary: false, missing: false });
        totalRows.push(...dayRows);
        covered = true;
    }
    return { series, totals: covered ? sumMetrics(totalRows) : null, mask };
}
