import type { SessionNote, TimeLog } from '../types';

/**
 * A hand-logged block of work, placed by the clock the person actually worked.
 *
 * `planned_starts_at` is a different fact: it is the forecast this entry
 * answers, and the planner uses it to hide that forecast. A manual log must
 * not write it. The closed `time_log_segments` row is what puts the work on
 * the calendar.
 */
export interface ManualWorkedWindow {
    startedAt: string;
    endedAt: string;
    /** `time_logs.hours`, rounded to the hundredth. Budgets and Basecamp read this, not the segment. */
    hours: number;
}

export interface ManualWorkedWindowInput {
    /** Calendar day the log is filed under, `YYYY-MM-DD`. */
    date: string;
    /** `HH:mm` from `<input type="time">`. Blank means the person did not place the block. */
    startTime: string;
    finishTime: string;
    /** IANA zone the clock times were chosen in. */
    timeZone: string;
    /** Injected so "not in the future" can be tested. Defaults to the real current instant. */
    now?: Date;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;

interface ZoneParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

function zoneParts(instant: Date, timeZone: string): ZoneParts | null {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }).formatToParts(instant);
        const bag: Record<string, string> = {};
        for (const part of parts) {
            if (part.type !== 'literal') bag[part.type] = part.value;
        }
        let hour = Number(bag.hour);
        if (hour === 24) hour = 0;
        const parsed = {
            year: Number(bag.year),
            month: Number(bag.month),
            day: Number(bag.day),
            hour,
            minute: Number(bag.minute),
            second: Number(bag.second),
        };
        return Object.values(parsed).every(Number.isFinite) ? parsed : null;
    } catch {
        return null;
    }
}

/** Milliseconds to add to a UTC instant to reach the same clock reading in `timeZone`. */
function zoneOffsetMs(instant: Date, timeZone: string): number | null {
    const parts = zoneParts(instant, timeZone);
    if (!parts) return null;
    const wallAsUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second,
    );
    return wallAsUtc - instant.getTime();
}

function calendarDate(parts: ZoneParts): string {
    return [
        String(parts.year).padStart(4, '0'),
        String(parts.month).padStart(2, '0'),
        String(parts.day).padStart(2, '0'),
    ].join('-');
}

function clockTime(parts: ZoneParts): string {
    return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/**
 * The UTC instant for a wall-clock time on a calendar day.
 * Returns null for an invalid zone, an impossible date, or a civil time that
 * does not exist (a spring-forward gap). An ambiguous fall-back hour resolves
 * to the earlier offset, which is the first time that clock reading occurs.
 */
export function zonedWallTimeToUtc(date: string, time: string, timeZone: string): Date | null {
    const dateMatch = DATE_ONLY.exec(date);
    const timeMatch = CLOCK.exec(time.trim());
    if (!dateMatch || !timeMatch) return null;

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
        probe.getUTCFullYear() !== year
        || probe.getUTCMonth() !== month - 1
        || probe.getUTCDate() !== day
    ) {
        return null;
    }

    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    let instant = new Date(utcGuess);
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const offset = zoneOffsetMs(instant, timeZone);
        if (offset === null) return null;
        const next = new Date(utcGuess - offset);
        if (next.getTime() === instant.getTime()) break;
        instant = next;
    }

    const parts = zoneParts(instant, timeZone);
    if (!parts) return null;
    if (calendarDate(parts) !== date || clockTime(parts) !== `${timeMatch[1]}:${timeMatch[2]}`) {
        return null;
    }
    return instant;
}

/** Hundredths of an hour, matching the precision the ledger already stores. */
export function roundLoggedHours(hours: number): number {
    return Math.round(hours * 100) / 100;
}

/**
 * Turn a manual start and finish into the segment to store.
 * Null when either clock is blank, the finish is not after the start, the
 * window leaves `date` (including a midnight crossing), or the finish is still
 * in the future. Hours-only entry stays possible: the form passes blank clocks
 * and stores no segment.
 */
export function manualWorkedWindow(input: ManualWorkedWindowInput): ManualWorkedWindow | null {
    if (!input.startTime.trim() || !input.finishTime.trim()) return null;
    const started = zonedWallTimeToUtc(input.date, input.startTime, input.timeZone);
    const ended = zonedWallTimeToUtc(input.date, input.finishTime, input.timeZone);
    if (!started || !ended) return null;

    const startedParts = zoneParts(started, input.timeZone);
    const endedParts = zoneParts(ended, input.timeZone);
    if (!startedParts || !endedParts) return null;
    if (calendarDate(startedParts) !== input.date || calendarDate(endedParts) !== input.date) {
        return null;
    }

    const elapsedMs = ended.getTime() - started.getTime();
    if (elapsedMs <= 0) return null;
    const hours = roundLoggedHours(elapsedMs / 3_600_000);
    if (!(hours > 0)) return null;

    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime()) || ended.getTime() > now.getTime()) return null;

    return {
        startedAt: started.toISOString(),
        endedAt: ended.toISOString(),
        hours,
    };
}

/** What the manual-log forms should do with the two clock fields. */
export function workedWindowForEdit(input: {
    segmentCount: number;
    date: string;
    startTime: string;
    finishTime: string;
    timeZone: string;
    now?: Date;
}): { window: ManualWorkedWindow | null; error: string | null } {
    if (input.segmentCount > 0) return { window: null, error: null };
    const start = input.startTime.trim();
    const finish = input.finishTime.trim();
    if (!start && !finish) return { window: null, error: null };
    if (!start || !finish) {
        return { window: null, error: 'Enter both a start and a finish, or leave both blank.' };
    }
    const window = manualWorkedWindow({
        date: input.date,
        startTime: start,
        finishTime: finish,
        timeZone: input.timeZone,
        now: input.now,
    });
    if (!window) {
        return {
            window: null,
            error: 'Finish must be later than start, on the same day, and not in the future.',
        };
    }
    return { window, error: null };
}

export function localTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
}

/**
 * The `time_logs` insert. Hours stay on this row — they are what budgets and
 * the Basecamp timesheet send. The worked window is a segment, never a column
 * here, and never `planned_starts_at`.
 */
export function timeLogInsertRow(
    log: Partial<TimeLog> & { organizationId: string; hours: number },
): Record<string, unknown> {
    return {
        organization_id: log.organizationId,
        client_id: log.clientId ?? null,
        project_id: log.projectId,
        task_id: log.taskId,
        planner_event_id: log.plannerEventId ?? null,
        // Destination for internal time; client logs resolve theirs
        // from the client's config at sync time.
        basecamp_project_id: log.basecampProjectId ?? null,
        user_id: log.userId,
        date: log.date,
        hours: log.hours,
        description: log.description,
        billable: log.billable ?? true,
        counts_toward_budget: log.countsTowardBudget ?? true,
        status: 'logged',
        category: log.category,
        // The forecast this entry answers, when it was logged against a
        // scheduled block. This is not the worked window — that is a segment.
        planned_starts_at: log.plannedStartsAt ?? null,
        planned_minutes: log.plannedMinutes ?? null,
    };
}

export interface ClosedSegmentInsert {
    time_log_id: string;
    organization_id: string;
    user_id: string;
    started_at: string;
    ended_at: string;
}

export interface BasecampPushResult {
    success: boolean;
    error?: string;
    providerId?: string;
    skipped?: boolean;
}

export interface ManualLogStore {
    insertLog(row: Record<string, unknown>): Promise<{
        data: Record<string, unknown> | null;
        error: { message: string } | null;
    }>;
    insertSegment(row: ClosedSegmentInsert): Promise<{ error: { message: string } | null }>;
    pushBasecamp(
        timeLogId: string,
        createIfMissing: boolean,
    ): Promise<BasecampPushResult> | void;
}

export interface RecordManualTimeLogOptions {
    syncToBasecamp?: boolean;
    waitForBasecampSync?: boolean;
    /** Omitted or null: hours-only. The log is saved and no segment is written. */
    workedWindow?: { startedAt: string; endedAt: string } | null;
    /** Called when the send finishes, including the fire-and-forget path. */
    onBasecampResult?: (timeLogId: string, result: BasecampPushResult) => void;
}

const SEGMENT_WARNING = 'Saved the hours, but could not place them on the calendar.';

/**
 * Insert the ledger row, then one closed segment, and only then tell Basecamp.
 * A segment failure keeps the log: the hours are already the source of truth,
 * and the form surfaces `segmentWarning` instead of pretending the save failed.
 */
export async function recordManualTimeLog(
    store: ManualLogStore,
    row: Record<string, unknown>,
    opts: RecordManualTimeLogOptions = {},
): Promise<{
    success: boolean;
    data?: Record<string, unknown>;
    error?: string;
    segmentWarning?: string;
    basecampSync?: BasecampPushResult;
}> {
    const inserted = await store.insertLog(row);
    if (inserted.error || !inserted.data?.id) {
        return { success: false, error: inserted.error?.message ?? 'Time entry was not saved' };
    }

    let segmentWarning: string | undefined;
    if (opts.workedWindow) {
        const segment = await store.insertSegment({
            time_log_id: String(inserted.data.id),
            organization_id: String(inserted.data.organization_id ?? ''),
            user_id: String(inserted.data.user_id ?? ''),
            started_at: opts.workedWindow.startedAt,
            ended_at: opts.workedWindow.endedAt,
        });
        if (segment.error) segmentWarning = `${SEGMENT_WARNING} ${segment.error.message}`.trim();
    }

    let basecampSync: BasecampPushResult | undefined;
    if (opts.syncToBasecamp) {
        const timeLogId = String(inserted.data.id);
        const push = store.pushBasecamp(timeLogId, true);
        const report = (result: BasecampPushResult) => {
            opts.onBasecampResult?.(timeLogId, result);
            if (!result.success && !opts.onBasecampResult) {
                console.error('[Basecamp timesheet] push failed:', result.error);
            }
            return result;
        };
        if (opts.waitForBasecampSync && push) {
            basecampSync = report(await push);
        } else if (push) {
            void push.then(report);
        }
    }

    return {
        success: true,
        data: inserted.data,
        ...(segmentWarning ? { segmentWarning } : {}),
        ...(basecampSync ? { basecampSync } : {}),
    };
}

export interface WorkedWindowStore {
    currentUserId(): Promise<string | null>;
    getLog(timeLogId: string): Promise<{
        data: { id: string; organization_id: string; user_id: string } | null;
        error: { message: string } | null;
    }>;
    listSegments(timeLogId: string): Promise<{
        data: { id: string }[] | null;
        error: { message: string } | null;
    }>;
    insertSegment(row: ClosedSegmentInsert): Promise<{ error: { message: string } | null }>;
    /**
     * Back-fill must not sync. The property exists so a test can prove this
     * function never creates or updates a Basecamp entry. Hours edits go
     * through `updateTimeLog`, which already pushes with `createIfMissing: false`.
     */
    pushBasecamp?(timeLogId: string, createIfMissing: boolean): void;
}

/**
 * Attach one closed segment to a log that has none. Refuses someone else's
 * log and any log that already has segments, so a timer attempt cannot gain
 * a second, hand-waved window. Does not change hours and does not call Basecamp.
 */
export async function attachWorkedWindow(
    store: WorkedWindowStore,
    timeLogId: string,
    window: { startedAt: string; endedAt: string },
): Promise<{ success: boolean; error?: string }> {
    const userId = await store.currentUserId();
    if (!userId) return { success: false, error: 'You need to be signed in.' };

    const log = await store.getLog(timeLogId);
    if (log.error) return { success: false, error: log.error.message };
    if (!log.data) return { success: false, error: 'Time entry not found.' };
    if (log.data.user_id !== userId) {
        return { success: false, error: 'You can only place worked time on your own entry.' };
    }

    const segments = await store.listSegments(timeLogId);
    if (segments.error) return { success: false, error: segments.error.message };
    if ((segments.data ?? []).length > 0) {
        return { success: false, error: 'This entry already has worked time on the calendar.' };
    }

    const inserted = await store.insertSegment({
        time_log_id: log.data.id,
        organization_id: log.data.organization_id,
        user_id: log.data.user_id,
        started_at: window.startedAt,
        ended_at: window.endedAt,
    });
    if (inserted.error) return { success: false, error: inserted.error.message };
    return { success: true };
}

export interface TimeLogEditPatch {
    description: string;
    hours: number;
    billable: boolean;
    category?: string;
    date: string;
    sessionNotes: SessionNote[];
}

/**
 * Save an existing entry, and optionally place it on the calendar.
 *
 * Hours go through `updateLog` (bound to `updateTimeLog`). That path syncs
 * Basecamp in place when `basecamp_entry_id` is already set, and the route
 * skips a create when it is not. This function never asks Basecamp to create
 * an entry. The segment insert cannot change hours, so it cannot open a
 * second timesheet row either.
 */
export async function saveTimeLogEdit(
    deps: {
        updateLog: (id: string, patch: TimeLogEditPatch) => Promise<{ success: boolean; error?: string }>;
        attachWindow: (
            id: string,
            window: { startedAt: string; endedAt: string },
        ) => Promise<{ success: boolean; error?: string }>;
    },
    input: {
        id: string;
        patch: TimeLogEditPatch;
        workedWindow: { startedAt: string; endedAt: string; hours: number } | null;
    },
): Promise<{
    success: boolean;
    error?: string;
    segmentWarning?: string;
    hours: number;
    basecampCreateIfMissing: false;
}> {
    const hours = input.workedWindow ? input.workedWindow.hours : input.patch.hours;
    const updated = await deps.updateLog(input.id, { ...input.patch, hours });
    if (!updated.success) {
        return {
            success: false,
            error: updated.error,
            hours,
            basecampCreateIfMissing: false,
        };
    }
    if (!input.workedWindow) {
        return { success: true, hours, basecampCreateIfMissing: false };
    }
    const attached = await deps.attachWindow(input.id, {
        startedAt: input.workedWindow.startedAt,
        endedAt: input.workedWindow.endedAt,
    });
    if (!attached.success) {
        return {
            success: true,
            hours,
            basecampCreateIfMissing: false,
            segmentWarning: attached.error
                ? `${SEGMENT_WARNING} ${attached.error}`
                : SEGMENT_WARNING,
        };
    }
    return { success: true, hours, basecampCreateIfMissing: false };
}
