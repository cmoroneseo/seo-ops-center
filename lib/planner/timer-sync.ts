/**
 * timer-sync.ts
 * -----------------------------------------------------------------------------
 * Rules for keeping a task's planner block in step with the timer.
 *
 * The intent: the calendar should show when work actually happened, not only
 * when you meant it to. Starting a timer at 2:20 on a block you planned for
 * 2:00 should move the block to 2:20.
 *
 * The limit: that must not quietly destroy a plan. If you planned something for
 * Friday and start the timer on Monday, moving the block would erase the Friday
 * intent. So same-day starts snap to reality; cross-day starts leave the plan
 * alone and only record the time.
 */

/** Same calendar day in local time — the axis the planner grid is drawn on. */
export function isSameLocalDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

/**
 * Should starting a timer right now reposition this task's block?
 *
 *   unscheduled      → yes; the work is happening, so put it on the calendar
 *   planned today    → yes; snap to when you actually began
 *   planned another day → no; respect the plan, just track the time
 */
export function shouldMoveBlockToNow(taskStartDate: string | undefined, now: Date): boolean {
    if (!taskStartDate) return true;
    const planned = new Date(taskStartDate);
    if (Number.isNaN(planned.getTime())) return true;
    return isSameLocalDay(planned, now);
}

/** Minimum block a stopped timer can leave behind, so it stays visible. */
export const MIN_TRACKED_MINUTES = 15;

/**
 * How long the block should be once the timer stops.
 *
 * Rounded to whole minutes and floored at MIN_TRACKED_MINUTES — a two-minute
 * session would otherwise collapse the card to an unreadable sliver.
 */
export function trackedBlockMinutes(elapsedSeconds: number): number {
    return Math.max(MIN_TRACKED_MINUTES, Math.round(elapsedSeconds / 60));
}
