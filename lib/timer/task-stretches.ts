import type { TimeLogSegment } from '../types.ts';

export interface TaskStretchLine {
    startedAt: string;
    /** Null while this stretch is still running. */
    endedAt: string | null;
    note: string | null;
}

/**
 * Per-stretch lines for a bot timer. Human entries have no segment notes and
 * stay on the grouped session list, so this returns null for them.
 */
export function taskStretchLines(log: {
    status: string;
    description?: string | null;
    timerStartedAt?: string | null;
    segments: Array<Pick<TimeLogSegment, 'startedAt' | 'endedAt' | 'note'>>;
}): TaskStretchLine[] | null {
    const hasNote = log.segments.some(segment => Boolean(segment.note?.trim()));
    if (!hasNote && log.status !== 'paused' && log.status !== 'in_progress') return null;
    if (!hasNote && log.status === 'in_progress') return null;

    const lines: TaskStretchLine[] = log.segments
        .filter(segment => segment.endedAt)
        .map(segment => ({
            startedAt: segment.startedAt,
            endedAt: segment.endedAt ?? null,
            note: segment.note?.trim() || null,
        }));
    if (log.status === 'in_progress' && log.timerStartedAt) {
        lines.push({
            startedAt: log.timerStartedAt,
            endedAt: null,
            note: log.description?.trim() || null,
        });
    }
    return lines.length > 0 ? lines : null;
}
