import { backgroundHistoryDates } from './background';
import { GSC_DAY_MAX_PAGES, GSC_DAY_ROW_LIMIT, GSC_HISTORY_FACT_LIMIT } from './history';

/** 486-day window. cursor_date is the newest day already saved. */
export const BACKFILL_WINDOW_DAYS = 486;
/**
 * One message saves a batch, then the next message waits out the rest of this
 * interval. The wait is a queue delay, not a request back into this deployment,
 * so Vercel loop detection never sees a chain. It also keeps a 10-minute
 * Search Analytics window to a few batches.
 */
export const BACKFILL_LINK_SPACING_MS = 3 * 60 * 1000;
/** Leave about a minute of the 300s limit for the database writes and the queue send. */
export const BACKFILL_BUDGET_MS = 240_000;
/** A day that cannot finish before the deadline is left for the next message. */
export const BACKFILL_MIN_DAY_MS = 20_000;
/** Cap one message so a burst stays well under the per-site queries-per-minute limit. */
export const BACKFILL_MAX_DAYS = 12;
/**
 * Safety cap for one wake. Messages are about 3 minutes apart, so this is
 * a little more than a day. The chain stops earlier when a message saves
 * nothing or Google returns a quota error.
 */
export const BACKFILL_CHAIN_LIMIT = 600;
/** A delayed queue message can still own the run. The next hourly cron resumes after this. */
export const BACKFILL_LOCK_STALE_MS = 20 * 60 * 1000;
export const BACKFILL_QUEUE_TOPIC = 'gsc-v2-backfill';
export const BACKFILL_QUEUE_FAILURE_NOTICE = 'continuation_queue_failed';
export const BACKFILL_QUEUE_RETENTION_SECONDS = 6 * 60 * 60;
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

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Seconds until the next queue message. The function itself does not sleep. */
export function backfillQueueDelaySeconds(elapsedMs: number, spacingMs = BACKFILL_LINK_SPACING_MS): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return Math.ceil(spacingMs / 1000);
    return Math.ceil(Math.max(0, spacingMs - elapsedMs) / 1000);
}

export function backfillPropertyDaysPerHour(daysPerMessage: number, spacingMs = BACKFILL_LINK_SPACING_MS): number {
    if (!Number.isFinite(daysPerMessage) || daysPerMessage <= 0 || spacingMs <= 0) return 0;
    return daysPerMessage * (3_600_000 / spacingMs);
}

export function backfillContinuationKey(runId: string, chain: number): string {
    return `gsc-v2-backfill:${runId}:${chain}`;
}

export interface BackfillQueueMessage {
    runId: string;
    chain: number;
}

export function parseBackfillQueueMessage(value: unknown, limit = BACKFILL_CHAIN_LIMIT): BackfillQueueMessage | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { runId?: unknown; chain?: unknown };
    if (typeof candidate.runId !== 'string' || !RUN_ID.test(candidate.runId)) return null;
    if (typeof candidate.chain !== 'number' || !Number.isInteger(candidate.chain) || candidate.chain < 1 || candidate.chain > limit) return null;
    return { runId: candidate.runId, chain: candidate.chain };
}

export function nextBackfillQueueMessage(input: {
    runId: string;
    chain: number;
    elapsedMs: number;
    continueChain: boolean;
    chainLimit?: number;
}): (BackfillQueueMessage & { delaySeconds: number; idempotencyKey: string; retentionSeconds: number }) | null {
    if (!input.continueChain) return null;
    const chain = input.chain + 1;
    const limit = input.chainLimit ?? BACKFILL_CHAIN_LIMIT;
    if (!RUN_ID.test(input.runId) || !Number.isInteger(chain) || chain < 1 || chain > limit) return null;
    return {
        runId: input.runId,
        chain,
        delaySeconds: backfillQueueDelaySeconds(input.elapsedMs),
        idempotencyKey: backfillContinuationKey(input.runId, chain),
        retentionSeconds: BACKFILL_QUEUE_RETENTION_SECONDS,
    };
}

export function backfillLockStatusAfterContinuation(
    status: 'completed' | 'partial' | 'failed',
    notice: string | null,
): 'completed' | 'partial' | 'failed' {
    if (!notice) return status;
    return status === 'failed' ? 'failed' : 'partial';
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
