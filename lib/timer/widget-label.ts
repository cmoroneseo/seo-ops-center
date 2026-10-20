/**
 * What the floating timer says about an open attempt.
 * The clock is the open segment when one is running, otherwise the last start.
 */

export function timerTaskLabel(attempt: {
    taskTitle?: string | null;
    description?: string | null;
}): string {
    const title = attempt.taskTitle?.trim();
    if (title) return title;
    const description = attempt.description?.trim();
    if (description) return description;
    return 'Untitled task';
}

export function runningSegmentStartedAt(attempt: {
    timerStartedAt?: string | null;
    segments?: readonly { startedAt: string; endedAt?: string | null }[];
}): string | null {
    const open = (attempt.segments ?? [])
        .filter(segment => segment.startedAt && !segment.endedAt)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
    return open[open.length - 1]?.startedAt ?? attempt.timerStartedAt ?? null;
}

/** Local clock, with the date when the segment did not start today. */
export function formatTimerStartClock(iso: string | null | undefined, today = new Date()): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const sameDay = date.getFullYear() === today.getFullYear()
        && date.getMonth() === today.getMonth()
        && date.getDate() === today.getDate();
    if (sameDay) return `Started ${time}`;
    const day = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `Started ${day} ${time}`;
}
