import { dateOffset } from '@/lib/gsc/history';

import { CHECKPOINTS, GSC_LAG_DAYS, type CheckpointDays } from './thresholds';
import { afterWindow, isIsoDay } from './time';

/**
 * A check is due the day after its window closes.
 * A 28-day check that went live on Oct 13 runs Oct 14–Nov 10 and is due Nov 11.
 */
export function checkDueOn(liveOn: string, days: CheckpointDays): string | null {
    if (!isIsoDay(liveOn)) return null;
    return dateOffset(afterWindow(liveOn, days).end, 1);
}

/**
 * Google's numbers for a check are ready exactly `GSC_LAG_DAYS` after the due
 * date. Due Nov 11 is ready Nov 14.
 */
export function dataReadyOn(dueOn: string): string | null {
    if (!isIsoDay(dueOn)) return null;
    return dateOffset(dueOn, GSC_LAG_DAYS);
}

export interface CheckDate {
    days: CheckpointDays;
    dueOn: string;
    dataReadyOn: string;
}

/** Due date and data-ready date for every check, in order. */
export function checkSchedule(liveOn: string): CheckDate[] {
    if (!isIsoDay(liveOn)) return [];
    const rows: CheckDate[] = [];
    for (const days of CHECKPOINTS) {
        const dueOn = checkDueOn(liveOn, days);
        const readyOn = dueOn ? dataReadyOn(dueOn) : null;
        if (!dueOn || !readyOn) continue;
        rows.push({ days, dueOn, dataReadyOn: readyOn });
    }
    return rows;
}
