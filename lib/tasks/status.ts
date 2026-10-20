/**
 * Task status is todo, in progress, or done.
 *
 * Review and approved are retired. Blocked is a label (`blockedReason`), not
 * a status: the task stays todo or in progress until someone marks it done,
 * and done clears the label. Migration 110 maps the old rows.
 */

export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;

export type CanonicalTaskStatus = (typeof TASK_STATUSES)[number];

/** Written onto a blocked row that had no reason of its own. */
export const MIGRATED_BLOCKED_REASON = 'Migrated from Blocked status';

export const BLOCKED_REASON_MAX = 200;

export interface TaskStatusHistoryEntryLike {
    status?: string | null;
    at?: string | null;
}

export interface LegacyTaskStatusInput {
    status: string;
    statusHistory?: readonly TaskStatusHistoryEntryLike[] | null;
    completedAt?: string | null;
    /** tasks.created_at. There is no tasks.updated_at column. */
    createdAt?: string | null;
    blockedReason?: string | null;
    /** Used only when a done row has no history stamp and no created_at. */
    now: string;
}

export interface LegacyTaskStatusResult {
    status: CanonicalTaskStatus;
    completedAt: string | null;
    blockedReason: string | null;
    statusChanged: boolean;
}

export function normalizeBlockedReason(
    value: string,
): { ok: true; reason: string } | { ok: false; error: string } {
    if (/[\r\n]/.test(value)) {
        return { ok: false, error: 'Keep the blocked reason to one line.' };
    }
    const reason = value.trim().replace(/[ \t]+/g, ' ');
    if (!reason) return { ok: false, error: 'Add a one-line reason for the block.' };
    if (reason.length > BLOCKED_REASON_MAX) {
        return { ok: false, error: 'Keep the blocked reason to one line.' };
    }
    return { ok: true, reason };
}

function history(input: LegacyTaskStatusInput): readonly TaskStatusHistoryEntryLike[] {
    return Array.isArray(input.statusHistory) ? input.statusHistory : [];
}

/** Latest history status that is not the blocked label-status. */
export function previousNonBlockedStatus(
    entries: readonly TaskStatusHistoryEntryLike[],
): string | null {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const status = entries[index]?.status;
        if (typeof status === 'string' && status.length > 0 && status !== 'blocked') return status;
    }
    return null;
}

function mapKnownStatus(status: string | null): CanonicalTaskStatus {
    if (status === 'todo' || status === 'in_progress' || status === 'done') return status;
    if (status === 'review') return 'in_progress';
    if (status === 'approved') return 'done';
    return 'todo';
}

function parseInstant(value: string | null | undefined): string | null {
    if (!value) return null;
    const time = Date.parse(value);
    if (Number.isNaN(time)) return null;
    return new Date(time).toISOString();
}

function latestHistoryStamp(
    entries: readonly TaskStatusHistoryEntryLike[],
    statuses?: ReadonlySet<string>,
): string | null {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (statuses && !statuses.has(entry?.status ?? '')) continue;
        const at = parseInstant(entry?.at);
        if (at) return at;
    }
    return null;
}

function completionStamp(input: LegacyTaskStatusInput): string {
    const existing = parseInstant(input.completedAt);
    if (existing) return existing;
    const entries = history(input);
    return latestHistoryStamp(entries, new Set(['done', 'approved']))
        ?? latestHistoryStamp(entries)
        ?? parseInstant(input.createdAt)
        ?? input.now;
}

/**
 * One-time mapping for migration 110.
 * A blocked row restored to done does not keep the label: marking done clears it.
 * Open restored rows get the migrated reason only when they do not already have one.
 */
export function migrateLegacyTaskStatus(input: LegacyTaskStatusInput): LegacyTaskStatusResult {
    const entries = history(input);
    const fromBlocked = input.status === 'blocked';
    const status = fromBlocked
        ? mapKnownStatus(previousNonBlockedStatus(entries))
        : mapKnownStatus(input.status);
    const existingReason = input.blockedReason?.trim() ? input.blockedReason.trim() : null;
    const blockedReason = status === 'done'
        ? null
        : fromBlocked
            ? (existingReason ?? MIGRATED_BLOCKED_REASON)
            : existingReason;
    return {
        status,
        completedAt: status === 'done' ? completionStamp(input) : null,
        blockedReason,
        statusChanged: status !== input.status,
    };
}

/**
 * Columns every completion writer should send.
 * Done stamps completed_at (keeping an explicit stamp) and clears the blocked
 * label. Any other status clears completed_at and leaves the label alone.
 */
export function taskStatusColumns(input: {
    status: CanonicalTaskStatus;
    now: string;
    completedAt?: string | null;
}): {
    status: CanonicalTaskStatus;
    completed_at: string | null;
    blocked_reason?: null;
} {
    if (input.status === 'done') {
        const stamp = input.completedAt && input.completedAt.length > 0 ? input.completedAt : input.now;
        return { status: 'done', completed_at: stamp, blocked_reason: null };
    }
    return { status: input.status, completed_at: null };
}

/** The first timer start on a to-do task moves it to in progress. Done stays done. */
export function statusAfterTimerStart(status: string): CanonicalTaskStatus {
    if (status === 'done') return 'done';
    if (status === 'in_progress') return 'in_progress';
    return 'in_progress';
}
