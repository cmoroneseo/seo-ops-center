/**
 * How a time log's Basecamp push should be described, and whether it can be
 * pushed by hand.
 *
 * The state that had no name until it happened: a log that was never SENT.
 * The row only distinguished "synced" from "failed", so a log written without
 * asking for a push at all showed nothing — no status, and no retry, because
 * retry was gated on there being a stored error. The hours were correct and
 * permanently stranded outside Basecamp with no way back short of SQL.
 */

export type TimeLogSyncState = 'synced' | 'failed' | 'unsent' | 'not_applicable';

export interface SyncableTimeLog {
    basecampEntryId?: string | number | null;
    basecampSyncedAt?: string | null;
    basecampSyncError?: string | null;
}

/**
 * `basecampAvailable` is whether this client syncs timesheets at all. Without
 * it every log for a non-syncing client would advertise itself as unsent,
 * which is noise rather than a problem.
 */
export function timeLogSyncState(
    log: SyncableTimeLog,
    basecampAvailable: boolean,
): TimeLogSyncState {
    // A failure is worth reporting whether or not sync is currently on: it
    // says something was attempted and did not land.
    if (log.basecampSyncError) return 'failed';
    if (log.basecampSyncedAt || log.basecampEntryId) return 'synced';
    return basecampAvailable ? 'unsent' : 'not_applicable';
}

/** Whether the person should be offered a manual push. */
export function canPushToBasecamp(state: TimeLogSyncState): boolean {
    return state === 'failed' || state === 'unsent';
}
