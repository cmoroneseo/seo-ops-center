import type { ApprovalBatchStatus, ApprovalDocStatus } from '../types';

/**
 * Rolling N per-document decisions up into one batch state.
 *
 * Every document in a batch is approved independently; the batch is only finished when
 * each one has landed on an accepting decision.
 */

export interface DocDecision {
    id: string;
    status: ApprovalDocStatus;
    archivedAt?: string | null;
}

export interface BatchRollup {
    total: number;
    pending: number;
    approved: number;
    changesRequested: number;
    /** Every live document has an accepting decision. */
    complete: boolean;
    status: ApprovalBatchStatus;
}

/**
 * Whether a decision counts the document as delivered.
 *
 * `approved_with_edits` counts: the client has signed off, and the outstanding edits
 * become Tasks. Withholding it would under-report work the client already considers
 * done. This is the rule that drives the deliverable write-back — see
 * `deliverableStatusFor`.
 */
export function isAcceptingDecision(status: ApprovalDocStatus): boolean {
    return status === 'approved' || status === 'approved_with_edits';
}

/**
 * The `deliverables.status` a document's decision implies, or null to leave it alone.
 *
 * 'Approved' is one of `DELIVERED_STATUSES` in lib/supabase/fulfillment.ts, so writing it
 * is the entire mechanism by which an approved batch closes the month's commitment.
 * There is deliberately no stored rollup anywhere — fulfillment is computed on read.
 */
export function deliverableStatusFor(status: ApprovalDocStatus): 'Approved' | 'Review' | null {
    if (isAcceptingDecision(status)) return 'Approved';
    if (status === 'changes_requested') return 'Review';
    return null;
}

export function rollUpBatch(docs: DocDecision[]): BatchRollup {
    const live = docs.filter((d) => !d.archivedAt);
    const approved = live.filter((d) => isAcceptingDecision(d.status)).length;
    const changesRequested = live.filter((d) => d.status === 'changes_requested').length;
    const pending = live.filter((d) => d.status === 'pending').length;
    const complete = live.length > 0 && approved === live.length;

    let status: ApprovalBatchStatus;
    if (live.length === 0) status = 'draft';
    else if (complete) status = 'completed';
    else status = 'in_review';

    return { total: live.length, pending, approved, changesRequested, complete, status };
}

export interface SendabilityInput {
    id: string;
    currentVersionId?: string | null;
    deliverableId?: string | null;
    archivedAt?: string | null;
}

export interface Sendability {
    ok: boolean;
    reasons: string[];
}

/**
 * A batch can only go out when every live document has a published version and a linked
 * deliverable. The deliverable requirement is not bureaucracy: an unlinked document is
 * invisible to the fulfillment matrix, so approving it would close nothing.
 */
export function canSendForReview(docs: SendabilityInput[]): Sendability {
    const live = docs.filter((d) => !d.archivedAt);
    const reasons: string[] = [];

    if (live.length === 0) reasons.push('Batch has no documents.');
    const unpublished = live.filter((d) => !d.currentVersionId);
    if (unpublished.length > 0) {
        reasons.push(
            `${unpublished.length} document(s) have no published version.`,
        );
    }
    const unlinked = live.filter((d) => !d.deliverableId);
    if (unlinked.length > 0) {
        reasons.push(
            `${unlinked.length} document(s) have no linked deliverable — approving them would not close a commitment.`,
        );
    }

    return { ok: reasons.length === 0, reasons };
}
