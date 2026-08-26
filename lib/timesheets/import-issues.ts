import type { TimeLogImportStatus } from '../types.ts';

/**
 * What is still missing from an imported entry.
 *
 * Derived on read, never stored, so an issue list can never go stale against
 * the row it describes.
 *
 * `no_task_link` is deliberately advisory. Measured against real data, zero of
 * fourteen imported entries link to a to-do — making it a hard gate would mean
 * nothing ever imports.
 */

export type ImportIssue = 'no_member' | 'no_client' | 'no_activity' | 'no_task_link';

/** Blocking issues, in the order they are surfaced. */
const BLOCKING: ImportIssue[] = ['no_member', 'no_client', 'no_activity'];

export interface ReviewableRow {
    id: string;
    /**
     * The org member this time belongs to. Null when the Basecamp person who
     * logged it has never been mapped to an org member in Settings — the row
     * is unattributed and must never be approvable.
     */
    userId: string | null;
    clientId: string | null;
    /** Time on a project marked `internal` — legitimately has no client. */
    isInternal: boolean;
    /**
     * Every activity this block of time was tagged with. A single block often
     * spans several — real reviewed data has a 2h block that was GBP
     * Optimization + Keyword Research & Strategy + Content Strategy. The hours
     * are never split; the whole block carries all of its tags.
     */
    activityKeys: string[];
    taskId: string | null;
    importStatus: TimeLogImportStatus;
}

/** States where a row is still being worked on and issues are meaningful. */
function isOpen(status: TimeLogImportStatus): boolean {
    return status === 'needs_context' || status === 'pending_review';
}

export function deriveIssues(row: ReviewableRow): ImportIssue[] {
    if (!isOpen(row.importStatus)) return [];

    const issues: ImportIssue[] = [];
    if (!row.userId) issues.push('no_member');
    if (!row.clientId && !row.isInternal) issues.push('no_client');
    if (row.activityKeys.length === 0) issues.push('no_activity');
    if (!row.taskId) issues.push('no_task_link');
    return issues;
}

/** True when a member may hand this row to a manager. */
export function isReadyToSubmit(row: ReviewableRow): boolean {
    if (row.importStatus !== 'needs_context') return false;
    return !deriveIssues(row).some(issue => BLOCKING.includes(issue));
}
