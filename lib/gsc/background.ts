import { dateOffset, historyWindow } from './history';

/** Recent data first; retain a conservative window inside GSC's available history. */
export function backgroundHistoryDates(now = new Date()): string[] {
    const { end } = historyWindow(now);
    return Array.from({ length: 480 }, (_, index) => dateOffset(end, -index));
}

export function planBackgroundDays(
    dates: string[], existing: { data_date: string; imported_at: string }[], now = new Date(), limit = 4,
): string[] {
    const known = new Map(existing.map(day => [day.data_date, day.imported_at]));
    const missing = dates.filter(date => !known.has(date));
    const stale = dates.slice(0, 7).filter(date => known.has(date) && Date.parse(known.get(date)!) <= now.getTime() - (date > dateOffset(dates[0], -3) ? 3600000 : 86400000));
    // Never starve recent revisions while older history is still being filled.
    return [...missing.slice(0, 1), ...stale.slice(0, 1), ...missing.slice(1), ...stale.slice(1)].slice(0, limit);
}

export function retryDelaySeconds(attempts: number): number {
    return Math.min(86400, 60 * 2 ** Math.min(Math.max(attempts - 1, 0), 11));
}
