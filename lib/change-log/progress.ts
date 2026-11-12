import { eachDate } from '@/lib/search-reporting/range';

import { CHECKPOINTS, type CheckpointDays } from './thresholds';
import { afterWindow, isIsoDay } from './time';

/**
 * Test progress is the share of the current target window that already has
 * final Search Console data. It is not the share of calendar time since go-live.
 *
 * The default target is the 28-day check. Once that window's last day is on or
 * before `finalThrough` — the same test a checkpoint uses to become ready —
 * the gauge moves on to the 56-day check. Finished means the current target's
 * last day is final.
 *
 * `checkSchedule().dataReadyOn` is the day we tell people to look. That date
 * is one day after the window's last day plus the lag (see schedule.ts).
 * Progress does not wait for that display date, so 100% lines up with a
 * finished check. The lag is already inside `finalThrough` (`GSC_LAG_DAYS`).
 * There is no second lag number.
 */
export const PROGRESS_TARGET_DAYS = 28 satisfies CheckpointDays;
export const PROGRESS_FOLLOW_DAYS = 56 satisfies CheckpointDays;

export type TestProgressStatus = 'in_progress' | 'finished';

export interface TestProgress {
    targetDays: CheckpointDays;
    /** 0–100. A partial window never rounds up to 100. */
    percent: number;
    status: TestProgressStatus;
    /** After-window days on or before `finalThrough`. Zero when none are final yet. */
    finalDays: number;
    windowDays: number;
    windowStart: string;
    windowEnd: string;
    finalThrough: string;
}

export const TEST_PROGRESS_STATUS_LABEL: Record<TestProgressStatus, string> = {
    in_progress: 'In progress',
    finished: 'Finished',
};

export function testProgress(liveOn: string, finalThroughDate: string): TestProgress | null {
    if (!isIsoDay(liveOn) || !isIsoDay(finalThroughDate)) return null;
    const primary = measure(liveOn, finalThroughDate, PROGRESS_TARGET_DAYS);
    if (!primary) return null;
    if (primary.status === 'finished' && CHECKPOINTS.includes(PROGRESS_FOLLOW_DAYS)) {
        return measure(liveOn, finalThroughDate, PROGRESS_FOLLOW_DAYS);
    }
    return primary;
}

function measure(liveOn: string, finalThroughDate: string, days: CheckpointDays): TestProgress | null {
    const span = afterWindow(liveOn, days);
    if (!isIsoDay(span.start) || !isIsoDay(span.end)) return null;
    const dates = eachDate(span.start, span.end);
    const windowDays = dates.length;
    const finalDays = dates.filter(date => date <= finalThroughDate).length;
    const finished = windowDays > 0 && finalDays >= windowDays;
    let percent = 0;
    if (finished) percent = 100;
    else if (finalDays > 0 && windowDays > 0) {
        percent = Math.round((finalDays / windowDays) * 100);
        if (percent < 1) percent = 1;
        if (percent > 99) percent = 99;
    }
    return {
        targetDays: days,
        percent,
        status: finished ? 'finished' : 'in_progress',
        finalDays,
        windowDays,
        windowStart: span.start,
        windowEnd: span.end,
        finalThrough: finalThroughDate,
    };
}
