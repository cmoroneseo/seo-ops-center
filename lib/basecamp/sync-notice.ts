import type { ClientBasecampSyncResult } from './client-sync';

/** Fired when a time entry's Basecamp send finishes with something to show. */
export const TIME_LOG_BASECAMP_EVENT = 'time-log:basecamp-sync';

export interface TimeLogBasecampNotice {
    timeLogId: string;
    message: string;
}

/**
 * The sentence for a send that did not land.
 * A skip keeps its reason so the row can say "Skipped: …" instead of "synced".
 */
export function basecampSyncNotice(result: {
    success?: boolean;
    ok?: boolean;
    skipped?: boolean;
    error?: string;
} | null | undefined): string | null {
    if (!result) return null;
    if (result.skipped) {
        const reason = result.error?.trim();
        return reason ? `Skipped: ${reason}` : 'Skipped';
    }
    const ok = result.success === true || result.ok === true;
    if (ok) return null;
    return result.error?.trim() || 'Basecamp sync failed';
}

export function publishTimeLogBasecampNotice(
    notice: TimeLogBasecampNotice,
    dispatch: (event: Event) => void = event => {
        if (typeof window === 'undefined') return;
        window.dispatchEvent(event);
    },
): void {
    dispatch(new CustomEvent(TIME_LOG_BASECAMP_EVENT, { detail: notice }));
}

export function noticeForBasecampResult(
    timeLogId: string,
    result: ClientBasecampSyncResult | { success?: boolean; ok?: boolean; skipped?: boolean; error?: string },
): TimeLogBasecampNotice | null {
    const message = basecampSyncNotice(result);
    return message ? { timeLogId, message } : null;
}
