import { budgetDefaultFor, describeActivity, findActivity } from './activities.ts';
import { deriveIssues, isReadyToSubmit, type ReviewableRow } from './import-issues.ts';

/**
 * Every state change an imported entry can undergo.
 *
 * Pure: routes authorize and persist, this decides. Keeping the rules here
 * means the same guard runs whether a change arrives from the member's queue,
 * a manager's bulk approve, or a future automation.
 */

export interface Actor {
    userId: string;
    isManager: boolean;
}

export interface EntryEdit {
    activityKey: string;
    detail: string;
    clientId: string | null;
    /** Overrides the activity's budget default when present. */
    countsTowardBudget?: boolean;
}

export type TransitionResult<T> =
    | ({ ok: true } & T)
    | { ok: false; status: 400 | 403 | 409; error: string };

/** States a member may still change. */
function isEditable(row: ReviewableRow): boolean {
    return row.importStatus === 'needs_context' || row.importStatus === 'pending_review';
}

export function buildEntryEdit(
    row: ReviewableRow,
    edit: EntryEdit,
    _actor: Actor,
): TransitionResult<{ updates: Record<string, unknown> }> {
    if (!isEditable(row)) {
        return {
            ok: false,
            status: 409,
            error: 'Only entries in review can be edited here',
        };
    }
    if (!findActivity(edit.activityKey)) {
        return { ok: false, status: 400, error: 'Choose a valid activity' };
    }

    return {
        ok: true,
        updates: {
            activity_key: edit.activityKey,
            description: describeActivity(edit.activityKey, edit.detail),
            // Internal work never consumes a client's SEO budget.
            counts_toward_budget: row.isInternal
                ? false
                : edit.countsTowardBudget ?? budgetDefaultFor(edit.activityKey),
            client_id: edit.clientId,
        },
    };
}

export function buildSubmit(
    rows: ReviewableRow[],
    actor: Actor,
    now: string,
): TransitionResult<{ updates: Record<string, unknown>; ids: string[] }> {
    const candidates = rows.filter(row => row.importStatus === 'needs_context');
    if (candidates.length === 0) {
        return { ok: false, status: 400, error: 'Nothing to submit' };
    }

    const blocked = candidates.filter(row => !isReadyToSubmit(row));
    if (blocked.length > 0) {
        return {
            ok: false,
            status: 409,
            error: `${blocked.length} ${blocked.length === 1 ? 'entry' : 'entries'} still need a client or an activity`,
        };
    }

    return {
        ok: true,
        ids: candidates.map(row => row.id),
        updates: {
            import_status: 'pending_review',
            submitted_at: now,
            submitted_by: actor.userId,
            // A fresh submission clears the previous bounce reason.
            review_note: null,
        },
    };
}

export function buildApproval(
    rows: ReviewableRow[],
    actor: Actor,
    now: string,
): TransitionResult<{ updates: Record<string, unknown>; ids: string[] }> {
    if (!actor.isManager) return { ok: false, status: 403, error: 'Forbidden' };

    const candidates = rows.filter(row => row.importStatus === 'pending_review');
    if (candidates.length !== rows.length || candidates.length === 0) {
        return {
            ok: false,
            status: 409,
            error: 'Only entries submitted for review can be approved',
        };
    }

    // Re-check at the gate: a row could have lost its activity after submit.
    const incomplete = candidates.filter(row =>
        deriveIssues(row).some(issue => issue !== 'no_task_link'));
    if (incomplete.length > 0) {
        return {
            ok: false,
            status: 409,
            error: `${incomplete.length} ${incomplete.length === 1 ? 'entry is' : 'entries are'} missing a client or activity`,
        };
    }

    return {
        ok: true,
        ids: candidates.map(row => row.id),
        updates: {
            import_status: 'mapped',
            reviewed_at: now,
            reviewed_by: actor.userId,
            review_note: null,
        },
    };
}

export function buildBounce(
    rows: ReviewableRow[],
    actor: Actor,
    now: string,
    note: string,
): TransitionResult<{ updates: Record<string, unknown>; ids: string[] }> {
    if (!actor.isManager) return { ok: false, status: 403, error: 'Forbidden' };

    const reason = note.trim();
    if (!reason) {
        return { ok: false, status: 400, error: 'Say why it is going back' };
    }

    const candidates = rows.filter(row => row.importStatus === 'pending_review');
    if (candidates.length === 0) {
        return { ok: false, status: 409, error: 'Nothing awaiting review' };
    }

    return {
        ok: true,
        ids: candidates.map(row => row.id),
        updates: {
            import_status: 'needs_context',
            reviewed_at: now,
            reviewed_by: actor.userId,
            review_note: reason,
        },
    };
}
