import type { RankTrackerResult } from '@/lib/sync/fetchAhrefsRankTracker';

export type RankTrackerViewResult = RankTrackerResult & { dateStart?: string; dateEnd?: string };

const STATUSES = new Set(['ok', 'error', 'not_configured']);

/**
 * A client session receives 403 JSON with no `status` field. Reading `.rows`
 * on that body throws. Anything without a known status is an error result.
 */
export function rankTrackerViewResult(body: unknown): RankTrackerViewResult {
    const failed = { status: 'error' as const, message: 'Could not load keyword rankings.' };
    if (!body || typeof body !== 'object' || Array.isArray(body)) return failed;
    const status = (body as { status?: unknown }).status;
    if (typeof status !== 'string' || !STATUSES.has(status)) return failed;
    if (status === 'ok' && !Array.isArray((body as { rows?: unknown }).rows)) return failed;
    return body as RankTrackerViewResult;
}
