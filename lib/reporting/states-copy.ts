/**
 * States-matrix copy for reporting surfaces.
 * These strings are the label. Color never carries the state by itself.
 */

export const STATES_COPY = {
    fresh: 'Fresh',
    notConnected: 'Not connected',
    missingValue: '—',
    emptyValue: '0',
    empty: 'A real zero for this window.',
    missing: 'No data for this window.',
    partialHistory: "History doesn't cover this window.",
    partialBackfill: 'The backfill is still running.',
    staleGsc: 'Search Console data is more than 36 hours old.',
    staleGbp: 'Business Profile data is more than 72 hours old.',
    staleDfs: 'This snapshot is more than 7 days old.',
    staleDefault: 'Data is more than 36 hours old.',
    staleError: 'The last sync errored.',
    noSuccessfulSync: 'No successful sync yet.',
    prelimTag: 'prelim',
    snapshotTag: 'snapshot',
    refTag: 'ref',
} as const;

export type ReceiptTag = typeof STATES_COPY.prelimTag | typeof STATES_COPY.snapshotTag | typeof STATES_COPY.refTag;

export function staleAsOf(dateLabel: string): string {
    return `as of ${dateLabel}`;
}

export function snapshotLocked(dateLabel: string): string {
    return `Snapshot locked ${dateLabel}`;
}

/** Not connected renders an em dash plus the reason, never a fake zero. */
export function notConnectedPresentation(reason: string): string {
    return `${STATES_COPY.missingValue} ${reason}`;
}
