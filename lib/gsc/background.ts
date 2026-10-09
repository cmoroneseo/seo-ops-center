import { dateOffset, historyWindow } from './history';
import { gscHistoryV2BackfillEnabled } from './flags';

/** Today's daily sync. The 16-month window is a separate backfill flag. */
export const DAILY_HISTORY_DAYS = 480;
/** GSC keeps about 16 months. 486 days includes today, so the oldest offset is 485. */
export const V2_BACKFILL_HISTORY_DAYS = 486;
export const V2_BACKFILL_DAYS_PER_CLAIM = 2;
/** 100ms gap is at most 600 requests/minute, under the 1,200 QPM per-site quota. */
export const V2_REQUEST_GAP_MS = 100;
export const V2_DAY_BUDGET_MS = 70_000;

export function backgroundWindowLength(env: NodeJS.ProcessEnv = process.env): number {
    return gscHistoryV2BackfillEnabled(env) ? V2_BACKFILL_HISTORY_DAYS : DAILY_HISTORY_DAYS;
}

/** Recent data first; retain a conservative window inside GSC's available history. */
export function backgroundHistoryDates(now = new Date(), windowDays = DAILY_HISTORY_DAYS): string[] {
    const { end } = historyWindow(now);
    return Array.from({ length: windowDays }, (_, index) => dateOffset(end, -index));
}

/**
 * Newest-first chunk. `cursor` is the last day successfully saved.
 * Null starts at the newest day. A killed run resumes at the next older day.
 */
export function planV2Backfill(
    dates: string[],
    cursor: string | null,
    limit = V2_BACKFILL_DAYS_PER_CLAIM,
): { dates: string[]; cursor: string | null; done: boolean } {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid backfill limit');
    let start = 0;
    if (cursor) {
        const saved = dates.indexOf(cursor);
        if (saved >= 0) start = saved + 1;
        else {
            start = dates.findIndex(date => date < cursor);
            if (start < 0) start = dates.length;
        }
    }
    const slice = dates.slice(start, start + limit);
    const done = slice.length === 0;
    return { dates: slice, cursor: done ? cursor : slice[slice.length - 1], done };
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
