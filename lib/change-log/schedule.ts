import { dateOffset } from '@/lib/gsc/history';

import { CHECKPOINTS, GSC_LAG_DAYS, type CheckpointDays } from './thresholds';
import { isIsoDay } from './time';

/**
 * The due date is the go-live date plus the length of the check.
 * A 28-day check that went live on Oct 13 is due Nov 10.
 */
export function checkDueOn(liveOn: string, days: CheckpointDays): string | null {
    if (!isIsoDay(liveOn)) return null;
    return dateOffset(liveOn, days);
}

/**
 * Google's numbers for a check are ready exactly `GSC_LAG_DAYS` after the due
 * date. Due Nov 10 is ready Nov 13. The check's last day is the day before it
 * is due, so adding the lag to that last day lands one day early.
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
