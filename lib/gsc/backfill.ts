import { backgroundHistoryDates } from './background';
import { GSC_DAY_MAX_PAGES, GSC_DAY_ROW_LIMIT, GSC_HISTORY_FACT_LIMIT } from './history';

/** 486-day window. cursor_date is the newest day already saved. */
export const BACKFILL_WINDOW_DAYS = 486;
/**
 * One link fetches several days, then waits out the rest of this interval
 * before the next link. That spreads Search Analytics load through the hour
 * instead of bursting the 10-minute quota.
 */
export const BACKFILL_LINK_SPACING_MS = 4 * 60 * 1000;
/** Leave room inside a 300s function for the spacing wait and the next kick. */
export const BACKFILL_BUDGET_MS = 170_000;
/** A day that cannot finish before the deadline is left for the next link. */
export const BACKFILL_MIN_DAY_MS = 20_000;
/** Several property-days per invocation, still a small slice of the 10-minute load window. */
export const BACKFILL_MAX_DAYS = 8;
/**
 * Safety cap for one wake. Links are 4 minutes apart, so this is about a day.
 * The chain stops earlier when a link saves nothing or Google returns a quota error.
 */
export const BACKFILL_CHAIN_LIMIT = 360;
/** A crashed chain stops blocking the next hourly wake after this. */
export const BACKFILL_LOCK_STALE_MS = 10 * 60 * 1000;
/** Google says to wait 15 minutes after a short-term load-quota error. */
export const QUOTA_BACKOFF_BASE_SECONDS = 15 * 60;
export const QUOTA_BACKOFF_CAP_SECONDS = 6 * 60 * 60;
/** A missing or revoked Google token should not be retried on every link. */
export const AUTH_SKIP_DELAY_SECONDS = 6 * 60 * 60;

export function v2DayFactUpperBound(
    rowLimit = GSC_DAY_ROW_LIMIT,
    maxPages = GSC_DAY_MAX_PAGES,
): number {
    // property + property_device + property_country, plus the four paginated grains
    // (page, query_page, page_device, page_organic). replace_gsc_history_day rejects 25k.
    return 1 + 3 + 10 + 4 * rowLimit * maxPages;
}

export function historyFactsWithinLimit(count: number): boolean {
    return Number.isInteger(count) && count >= 0 && count <= GSC_HISTORY_FACT_LIMIT;
}

export function canStartBackfillDay(input: {
    remainingMs: number;
    daysThisRun: number;
    maxDays?: number;
    minDayMs?: number;
}): boolean {
    const maxDays = input.maxDays ?? BACKFILL_MAX_DAYS;
    const minDayMs = input.minDayMs ?? BACKFILL_MIN_DAY_MS;
    if (!Number.isInteger(input.daysThisRun) || input.daysThisRun < 0) return false;
    if (input.daysThisRun >= maxDays) return false;
    return input.remainingMs >= minDayMs;
}

/** Stay inside a 300s function after the link's own work. */
export const BACKFILL_MAX_HOLD_MS = 270_000;

export function chainGapMs(
    elapsedMs: number,
    spacingMs = BACKFILL_LINK_SPACING_MS,
    maxHoldMs = BACKFILL_MAX_HOLD_MS,
): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return Math.min(spacingMs, maxHoldMs);
    const gap = Math.max(0, spacingMs - elapsedMs);
    return Math.min(gap, Math.max(0, maxHoldMs - elapsedMs));
}

export function continuationAccepted(status: number, body: { skipped?: boolean } | null): boolean {
    return status >= 200 && status < 300 && body?.skipped !== true;
}

export function parseBackfillChain(value: string | null, limit = BACKFILL_CHAIN_LIMIT): number | null {
    if (value == null || value === '') return 0;
    if (!/^\d+$/.test(value)) return null;
    const chain = Number(value);
    if (chain > limit) return null;
    return chain;
}

export function quotaDelaySeconds(attempts: number): number {
    const exponent = Math.min(Math.max(Math.floor(attempts) - 1, 0), 5);
    return Math.min(QUOTA_BACKOFF_CAP_SECONDS, QUOTA_BACKOFF_BASE_SECONDS * 2 ** exponent);
}

export function isGscQuotaError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /\bHTTP 429\b/.test(error.message) || /\bquota\b/i.test(error.message);
}

export function daysDoneFromCursor(cursor: string | null, now = new Date(), windowDays = BACKFILL_WINDOW_DAYS): {
    daysDone: number;
    daysTotal: number;
} {
    const dates = backgroundHistoryDates(now, windowDays);
    const daysTotal = dates.length;
    if (!cursor) return { daysDone: 0, daysTotal };
    const index = dates.indexOf(cursor);
    if (index >= 0) return { daysDone: index + 1, daysTotal };
    const oldest = dates[dates.length - 1];
    if (oldest && cursor < oldest) return { daysDone: daysTotal, daysTotal };
    const nextOlder = dates.findIndex(date => date < cursor);
    return { daysDone: nextOlder < 0 ? daysTotal : nextOlder, daysTotal };
}

export interface BackfillClaimJob {
    kind: 'daily' | 'v2_backfill';
    status: 'pending' | 'running' | 'idle';
    availableAt: string;
    leaseUntil: string | null;
    property: string;
    integration: { syncStatus: string; siteUrl: string | null } | null;
}

/**
 * Mirrors claim_gsc_sync. Idle rows are never claimed, including parked demo
 * jobs whose available_at is in the future. A pending row with a future
 * available_at (quota or auth backoff) is also left alone.
 */
export function gscBackfillJobClaimable(
    job: BackfillClaimJob,
    now: Date,
    requestedKind: 'daily' | 'v2_backfill' = 'v2_backfill',
): boolean {
    if (job.kind !== requestedKind) return false;
    const integration = job.integration;
    if (!integration) return false;
    if (integration.syncStatus !== 'active' && integration.syncStatus !== 'error') return false;
    if (!integration.siteUrl || integration.siteUrl !== job.property) return false;
    if (Date.parse(job.availableAt) > now.getTime()) return false;
    if (job.status === 'pending') return true;
    return job.status === 'running' && !!job.leaseUntil && Date.parse(job.leaseUntil) < now.getTime();
}

export function backfillWorkRemains(
    jobs: { status: string; availableAt: string; daysDone: number; daysTotal: number }[],
    now: number,
): boolean {
    return jobs.some(job =>
        job.daysDone < job.daysTotal
        && job.status !== 'idle'
        && Date.parse(job.availableAt) <= now,
    );
}

export function shouldContinueBackfill(input: {
    chain: number;
    chainLimit?: number;
    imported: number;
    quotaPaused: boolean;
    workRemains: boolean;
}): boolean {
    const chainLimit = input.chainLimit ?? BACKFILL_CHAIN_LIMIT;
    return input.imported > 0
        && !input.quotaPaused
        && input.workRemains
        && input.chain < chainLimit;
}

export function backfillLockIsLive(heartbeatIso: string | null, now: number, staleMs = BACKFILL_LOCK_STALE_MS): boolean {
    if (!heartbeatIso) return false;
    const beat = Date.parse(heartbeatIso);
    return Number.isFinite(beat) && now - beat >= 0 && now - beat < staleMs;
}
