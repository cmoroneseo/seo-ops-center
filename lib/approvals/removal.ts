/**
 * Removing batches and documents.
 *
 * An approval is a record, not a view — the same principle the timesheet client-month
 * snapshots follow. Once a batch has gone to a client, who approved what and when is
 * evidence, so it is archived rather than destroyed. A batch that was never sent has no
 * such history and can simply go.
 */

export interface RemovableBatch {
    sentAt?: string | null;
    status: string;
}

export type RemovalMode = 'delete' | 'archive';

export function batchRemovalMode(batch: RemovableBatch): RemovalMode {
    // Never sent means nothing was ever shown to a client and nothing was decided.
    return batch.sentAt ? 'archive' : 'delete';
}

export function batchRemovalLabel(mode: RemovalMode): string {
    return mode === 'delete' ? 'Delete' : 'Archive';
}

export function batchRemovalConfirm(mode: RemovalMode, name: string): string {
    if (mode === 'delete') {
        return `Delete “${name}”? It was never sent, so nothing is lost — its documents and any drafts go with it. This cannot be undone.`;
    }
    return `Archive “${name}”? It has already gone to the client, so the approvals and comments are kept as a record — archiving only hides it from this list. Any live review link stops working.`;
}

export interface RemovableDoc {
    status: string;
    currentVersionId?: string | null;
}

/**
 * A document that has been decided on is archived, never deleted — the decision is the
 * record. An undecided draft can go.
 */
export function docRemovalMode(doc: RemovableDoc): RemovalMode {
    return doc.status === 'pending' ? 'delete' : 'archive';
}

export function docRemovalConfirm(mode: RemovalMode, title: string): string {
    if (mode === 'delete') {
        return `Remove “${title}” from this batch? No decision has been made on it yet, so nothing is lost.`;
    }
    return `Archive “${title}”? The client's decision and comments are kept as a record; archiving removes it from the batch and from anything the client still has open.`;
}
