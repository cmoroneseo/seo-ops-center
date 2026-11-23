import { dateOffset, finalHistoryDate, historyWindow } from './history';
import { gscHistoryV2BackfillEnabled } from './flags';

/** Today's daily sync. The 16-month window is a separate backfill flag. */
export const DAILY_HISTORY_DAYS = 480;
/** GSC keeps about 16 months. 486 days includes today, so the oldest offset is 485. */
export const V2_BACKFILL_HISTORY_DAYS = 486;
export const V2_BACKFILL_DAYS_PER_CLAIM = 2;
/** 100ms gap is at most 600 requests/minute, under the 1,200 QPM per-site quota. */
export const V2_REQUEST_GAP_MS = 100;
/**
 * The old daily cron would not start a day unless this much time remained, so a
 * 90s budget saved one day. The backfill route uses BACKFILL_MIN_DAY_MS instead.
 */
export const V2_DAY_BUDGET_MS = 70_000;
const HOURLY_REFRESH_MS = 60 * 60 * 1000;

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
    dates: string[], existing: { data_date: string; imported_at: string; is_incomplete: boolean }[], now = new Date(), limit = 4,
): string[] {
    const known = new Map(existing.map(day => [day.data_date, day]));
    const finalThrough = finalHistoryDate(now);
    const nowMs = now.getTime();
    const needsFinal = (date: string) => date <= finalThrough && known.get(date)?.is_incomplete === true;
    const dueForFinal = dates.filter(date => needsFinal(date)
        && Date.parse(known.get(date)?.imported_at ?? '') <= nowMs - HOURLY_REFRESH_MS);
    const recent = dates.slice(0, 7);
    const recentMissing = recent.filter(date => !known.has(date));
    const olderMissing = dates.slice(recent.length).filter(date => !known.has(date));
    const stale = recent.flatMap(date => {
        const imported = Date.parse(known.get(date)?.imported_at ?? '');
        const maxAgeMs = date > finalThrough ? HOURLY_REFRESH_MS : 86400000;
        return !needsFinal(date) && imported <= nowMs - maxAgeMs ? [{ date, imported }] : [];
    }).sort((a, b) => a.imported - b.imported).map(day => day.date);
    // Reserve recent work ahead of historical fill and rotate stale revisions by import age.
    return [
        ...dueForFinal, ...recentMissing.slice(0, 1), ...stale.slice(0, 1),
        ...recentMissing.slice(1), ...olderMissing, ...stale.slice(1),
    ].slice(0, limit);
}

export function retryDelaySeconds(attempts: number): number {
    return Math.min(86400, 60 * 2 ** Math.min(Math.max(attempts - 1, 0), 11));
}
