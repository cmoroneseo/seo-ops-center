import type {
    SessionNote,
    TimeLogSegment,
    TimeLogStatus,
    TimerAttempt,
} from '../types';

export type TimerMutationRequest =
    | { action: 'start'; taskId: string; now?: string }
    | { action: 'pause'; timeLogId: string; now?: string }
    | { action: 'resume'; timeLogId: string; now?: string }
    | {
        action: 'switch';
        fromTimeLogId: string;
        toTimeLogId?: string;
        toTaskId?: string;
        now?: string;
    }
    | { action: 'begin_stop'; timeLogId: string; now?: string }
    | {
        action: 'finalize';
        timeLogId: string;
        description: string;
        billable: boolean;
        countsTowardBudget: boolean;
        syncToBasecamp: boolean;
        markTaskComplete: boolean;
        timeZone: string;
    }
    | { action: 'discard'; timeLogId: string }
    | { action: 'retry_basecamp'; timeLogId: string };

export interface TimerStateResponse {
    running: TimerAttempt | null;
    paused: TimerAttempt[];
    finalizedTimeLogIds?: string[];
    completionWarning?: string;
    recoveryWarning?: string;
    basecampStatus?: 'not_requested' | 'syncing' | 'synced' | 'failed';
}

type DatabaseRow = Record<string, unknown>;

function objectRow(value: unknown): DatabaseRow | undefined {
    if (Array.isArray(value)) return objectRow(value[0]);
    return typeof value === 'object' && value !== null
        ? value as DatabaseRow
        : undefined;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function segmentFromRow(value: unknown): TimeLogSegment | null {
    const row = objectRow(value);
    if (!row) return null;
    const id = optionalString(row.id);
    const timeLogId = optionalString(row.time_log_id);
    const organizationId = optionalString(row.organization_id);
    const userId = optionalString(row.user_id);
    const startedAt = optionalString(row.started_at);
    if (!id || !timeLogId || !organizationId || !userId || !startedAt) return null;
    return {
        id,
        timeLogId,
        organizationId,
        userId,
        startedAt,
        endedAt: optionalString(row.ended_at),
    };
}

/** Normalize trusted query rows once at the data boundary. */
export function timerAttemptFromRow(value: unknown): TimerAttempt {
    const row = objectRow(value) ?? {};
    const client = objectRow(row.clients);
    const task = objectRow(row.tasks);
    const segmentRows = Array.isArray(row.time_log_segments) ? row.time_log_segments : [];
    return {
        id: String(row.id ?? ''),
        organizationId: String(row.organization_id ?? ''),
        clientId: optionalString(row.client_id),
        clientName: optionalString(client?.name),
        projectId: optionalString(row.project_id),
        taskId: optionalString(row.task_id),
        taskTitle: optionalString(task?.title),
        plannerEventId: optionalString(row.planner_event_id),
        userId: String(row.user_id ?? ''),
        date: String(row.date ?? ''),
        hours: Number(row.hours) || 0,
        description: typeof row.description === 'string' ? row.description : '',
        billable: typeof row.billable === 'boolean' ? row.billable : true,
        countsTowardBudget: typeof row.counts_toward_budget === 'boolean'
            ? row.counts_toward_budget
            : true,
        status: (optionalString(row.status) as TimeLogStatus | undefined) ?? 'logged',
        operationId: optionalString(row.operation_id),
        plannedStartsAt: optionalString(row.planned_starts_at),
        plannedMinutes: optionalNumber(row.planned_minutes),
        reviewingAt: optionalString(row.reviewing_at),
        timerStartedAt: optionalString(row.timer_started_at),
        elapsedSeconds: Number(row.elapsed_seconds) || 0,
        category: optionalString(row.category),
        sessionNotes: Array.isArray(row.session_notes) ? row.session_notes as SessionNote[] : [],
        basecampEntryId: optionalNumber(row.basecamp_entry_id),
        basecampProjectId: optionalNumber(row.basecamp_project_id),
        basecampSyncedAt: optionalString(row.basecamp_synced_at),
        basecampSyncError: optionalString(row.basecamp_sync_error),
        segments: segmentRows
            .map(segmentFromRow)
            .filter((segment): segment is TimeLogSegment => segment !== null)
            .sort((left, right) => left.startedAt.localeCompare(right.startedAt)),
    };
}

export function timerStateFromRows(rows: unknown[]): TimerStateResponse {
    const attempts = rows.map(timerAttemptFromRow);
    const running = attempts.find(attempt => attempt.timerStartedAt && !attempt.reviewingAt) ?? null;
    return {
        running,
        paused: attempts.filter(attempt => attempt.id !== running?.id),
    };
}
