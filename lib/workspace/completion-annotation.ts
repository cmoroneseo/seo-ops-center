import { STAGE_LIST_TIME_ZONE } from '../seo-plan/this-month';
import { completionCalendarDay } from '../tasks/completion-date';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Statuses that record a finish. `approved` is the retired name for done and
 * still appears in older status_history rows.
 */
const FINISH_STATUSES = new Set(['done', 'approved']);

export interface TaskCompletionRecord {
    status: string | null;
    completedAt: string | null;
    statusHistory: readonly { status?: string | null; at?: string | null }[];
}

export interface CompletionActivityEvent {
    id: string;
    eventType: string;
    occurredAt: string;
    metadata: Record<string, unknown>;
}

/**
 * The viewer's clock, which is the clock the completion prompt uses.
 * Workspace overview days are Pacific; when the browser cannot name a zone,
 * stay on that clock instead of UTC.
 */
export function activityTimeZone(): string {
    try {
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!zone) return STAGE_LIST_TIME_ZONE;
        Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
        return zone;
    } catch {
        return STAGE_LIST_TIME_ZONE;
    }
}

function parseInstant(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return null;
    return new Date(time).toISOString();
}

function finishStamps(history: TaskCompletionRecord['statusHistory']): string[] {
    const stamps: string[] = [];
    for (const entry of history) {
        if (!FINISH_STATUSES.has(entry?.status ?? '')) continue;
        const at = parseInstant(entry?.at);
        if (at) stamps.push(at);
    }
    return stamps;
}

function taskIdOf(event: CompletionActivityEvent): string | null {
    const taskId = event.metadata.taskId;
    return typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
}

/**
 * Phrase for a finish whose calendar day is not the day the feed row was
 * written. Null when the days match, so a same-day completion is unchanged.
 * The year is included only when it is not the current year in `timeZone`.
 */
export function finishedOnAnnotation(input: {
    occurredAt: string;
    completedAt: string | null | undefined;
    timeZone: string;
    now?: Date;
}): string | null {
    const occurred = completionCalendarDay(new Date(input.occurredAt), input.timeZone);
    const completed = input.completedAt
        ? completionCalendarDay(new Date(input.completedAt), input.timeZone)
        : null;
    if (!occurred || !completed || occurred === completed) return null;

    const currentYear = completionCalendarDay(input.now ?? new Date(), input.timeZone)?.slice(0, 4);
    const [year, month, day] = completed.split('-');
    const monthName = MONTHS[Number(month) - 1];
    if (!monthName || !year || !day) return null;
    const label = currentYear && year !== currentYear
        ? `${monthName} ${Number(day)}, ${year}`
        : `${monthName} ${Number(day)}`;
    return `finished ${label}`;
}

/**
 * Copy `completedAt` onto task.completed events that were stored before the
 * feed carried the chosen finish instant.
 *
 * The row stays at `occurredAt` (when the action was recorded). This instant
 * is only the finish date. An event that already has one keeps it. Otherwise
 * a task that is still done contributes `tasks.completed_at` to its newest
 * completion, and a reopened task (that column is null) contributes the
 * matching done row in status_history. Completions are aligned from the
 * newest, so an older history row does not relabel the entry on screen and a
 * later finish does not relabel an earlier one.
 */
export function attachRecordedCompletions<T extends CompletionActivityEvent>(
    events: readonly T[],
    records: ReadonlyMap<string, TaskCompletionRecord>,
): T[] {
    const byTask = new Map<string, T[]>();
    for (const event of events) {
        if (event.eventType !== 'task.completed') continue;
        const taskId = taskIdOf(event);
        if (!taskId) continue;
        const group = byTask.get(taskId) ?? [];
        group.push(event);
        byTask.set(taskId, group);
    }

    const assigned = new Map<string, string>();
    for (const [taskId, group] of byTask) {
        const sorted = [...group].sort((a, b) => (
            a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id)
        ));
        const unresolved: T[] = [];
        for (const event of sorted) {
            const fromEvent = parseInstant(event.metadata.completedAt);
            if (fromEvent) assigned.set(event.id, fromEvent);
            else unresolved.push(event);
        }
        const record = records.get(taskId);
        if (!record || unresolved.length === 0) continue;

        let stamps = finishStamps(record.statusHistory);
        const column = record.status === 'done' ? parseInstant(record.completedAt) : null;
        let pending = unresolved;
        if (column) {
            const latest = pending[pending.length - 1];
            pending = pending.slice(0, -1);
            assigned.set(latest.id, column);
            const index = stamps.lastIndexOf(column);
            if (index >= 0) stamps = stamps.slice(0, index).concat(stamps.slice(index + 1));
            else if (stamps.length > 0) stamps = stamps.slice(0, -1);
        }
        const offset = Math.max(0, stamps.length - pending.length);
        pending.forEach((event, index) => {
            const stamp = stamps[offset + index];
            if (stamp) assigned.set(event.id, stamp);
        });
    }

    return events.map(event => {
        const completedAt = assigned.get(event.id);
        if (!completedAt || parseInstant(event.metadata.completedAt) === completedAt) return event;
        return { ...event, metadata: { ...event.metadata, completedAt } };
    });
}
