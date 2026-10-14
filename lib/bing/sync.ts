import { BingRequestError, bingJson, isBingBackoffError, type BingJsonRequest } from './client';
import {
    mapPageWeeks, mapQueryWeeks, mapTraffic,
    type BingPageRow, type BingQueryRow, type BingTrafficRow,
} from './map';

export const BING_QUEUE_TOPIC = 'bing-webmaster-sync';
export const BING_QUEUE_PATH = '/api/queues/bing-webmaster-sync';
export const BING_CRON_PATH = '/api/cron/sync-bing';
/** 12:00 UTC. Hour 10 is Search Console daily. Hour 16 is report sending. */
export const BING_CRON_SCHEDULE = '0 12 * * *';
/** One site, then the next message waits. The wait is a queue delay, not a self-fetch. */
export const BING_SITE_DELAY_SECONDS = 30;
export const BING_CHAIN_LIMIT = 500;
/** Longer than the 6 hour backoff. delaySeconds cannot exceed retention. */
export const BING_QUEUE_RETENTION_SECONDS = 24 * 60 * 60;
export const BING_BACKOFF_BASE_SECONDS = 15 * 60;
export const BING_BACKOFF_CAP_SECONDS = 6 * 60 * 60;
export const BING_HARD_FAIL_DELAY_SECONDS = 6 * 60 * 60;
export const BING_PARK_SECONDS = 24 * 60 * 60;
export const BING_UNVERIFIED_MESSAGE = 'Bing site is not verified';
export const BING_SYNC_FAILED_MESSAGE = 'Bing sync failed';

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BingQueueMessage {
    runId: string;
    chain: number;
}

export interface BingQueueSend extends BingQueueMessage {
    delaySeconds: number;
    idempotencyKey: string;
    retentionSeconds: number;
}

export function bingBackoffSeconds(attempts: number): number {
    const exponent = Math.min(Math.max(Math.floor(attempts) - 1, 0), 5);
    return Math.min(BING_BACKOFF_CAP_SECONDS, BING_BACKOFF_BASE_SECONDS * 2 ** exponent);
}

export function clampBingDelay(seconds: number): number {
    if (!Number.isFinite(seconds) || seconds < 0) return BING_SITE_DELAY_SECONDS;
    return Math.min(Math.floor(seconds), BING_QUEUE_RETENTION_SECONDS);
}

export function parseBingQueueMessage(value: unknown, limit = BING_CHAIN_LIMIT): BingQueueMessage | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { runId?: unknown; chain?: unknown };
    if (typeof candidate.runId !== 'string' || !RUN_ID.test(candidate.runId)) return null;
    if (typeof candidate.chain !== 'number' || !Number.isInteger(candidate.chain) || candidate.chain < 1 || candidate.chain > limit) {
        return null;
    }
    return { runId: candidate.runId, chain: candidate.chain };
}

export function bingQueueSend(message: BingQueueMessage, delaySeconds: number): BingQueueSend | null {
    const parsed = parseBingQueueMessage(message);
    if (!parsed) return null;
    const delay = clampBingDelay(delaySeconds);
    const idempotencyKey = `bing-webmaster-sync:${parsed.runId}:${parsed.chain}`;
    if (idempotencyKey.length > 256) return null;
    return {
        ...parsed,
        delaySeconds: delay,
        idempotencyKey,
        retentionSeconds: BING_QUEUE_RETENTION_SECONDS,
    };
}

/** One start message per UTC day, so a cron retry does not open a second chain. */
export function bingCronStartSend(now: Date, runId: string): BingQueueSend | null {
    if (!RUN_ID.test(runId)) return null;
    const day = now.toISOString().slice(0, 10);
    const message = bingQueueSend({ runId, chain: 1 }, 0);
    if (!message) return null;
    return { ...message, idempotencyKey: `bing-webmaster-sync:${day}:1` };
}

export function nextBingQueueSend(current: BingQueueMessage, delaySeconds: number): BingQueueSend | null {
    const chain = current.chain + 1;
    if (!Number.isInteger(chain) || chain > BING_CHAIN_LIMIT) return null;
    return bingQueueSend({ runId: current.runId, chain }, delaySeconds);
}

export type SiteReadOutcome =
    | {
        action: 'write';
        backoff: boolean;
        /** Set when a later read hit 429 or 503 and the chain should wait. */
        status?: number;
        traffic: BingTrafficRow[];
        queries: BingQueryRow[] | null;
        pages: BingPageRow[] | null;
    }
    | { action: 'skip'; backoff: true; status?: number }
    | { action: 'fail'; status?: number };

function httpStatus(error: unknown): number | undefined {
    return error instanceof BingRequestError ? error.status : undefined;
}

async function readMethod(
    method: BingJsonRequest['method'],
    siteUrl: string,
    apiKey: string,
    fetchImpl: BingJsonRequest['fetchImpl'],
    signal: AbortSignal | undefined,
): Promise<unknown> {
    return bingJson({ method, apiKey, siteUrl, fetchImpl, signal });
}

/**
 * Three reads, in order. A traffic failure writes nothing.
 * A later failure keeps the previous weeks by passing null for that side.
 * 429 and 503 stop the remaining reads and ask the chain to wait.
 */
export async function readBingSite(
    siteUrl: string,
    apiKey: string,
    fetchImpl?: BingJsonRequest['fetchImpl'],
    signal?: AbortSignal,
): Promise<SiteReadOutcome> {
    let trafficPayload: unknown;
    try {
        trafficPayload = await readMethod('GetRankAndTrafficStats', siteUrl, apiKey, fetchImpl, signal);
    } catch (error) {
        if (isBingBackoffError(error)) return { action: 'skip', backoff: true, status: httpStatus(error) };
        return { action: 'fail', status: httpStatus(error) };
    }
    const traffic = mapTraffic(trafficPayload);
    if (!traffic.ok) return { action: 'fail' };

    let queries: BingQueryRow[] | null = null;
    try {
        const mapped = mapQueryWeeks(await readMethod('GetQueryStats', siteUrl, apiKey, fetchImpl, signal));
        if (!mapped.ok) queries = null;
        else queries = mapped.rows;
    } catch (error) {
        if (isBingBackoffError(error)) {
            return { action: 'write', backoff: true, status: httpStatus(error), traffic: traffic.rows, queries: null, pages: null };
        }
        queries = null;
    }

    let pages: BingPageRow[] | null = null;
    try {
        const mapped = mapPageWeeks(await readMethod('GetPageStats', siteUrl, apiKey, fetchImpl, signal));
        if (!mapped.ok) pages = null;
        else pages = mapped.rows;
    } catch (error) {
        if (isBingBackoffError(error)) {
            return { action: 'write', backoff: true, status: httpStatus(error), traffic: traffic.rows, queries, pages: null };
        }
        pages = null;
    }
    return { action: 'write', backoff: false, traffic: traffic.rows, queries, pages };
}
