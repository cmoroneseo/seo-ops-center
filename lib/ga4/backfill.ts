import { addUtcDays, ga4BackoffSeconds, utcDay } from './sync';

/** Sixteen calendar months, one month per queue message. */
export const GA4_BACKFILL_MONTHS = 16;
export const GA4_QUEUE_TOPIC = 'ga4-backfill';
export const GA4_QUEUE_PATH = '/api/queues/ga4-backfill';
export const GA4_CRON_PATH = '/api/cron/sync-ga4';
/** 11:00 UTC, after the 10:00 Search Console daily sync. */
export const GA4_CRON_SCHEDULE = '0 11 * * *';
export const GA4_CHAIN_LIMIT = 2000;
export const GA4_LINK_DELAY_SECONDS = 20;
export const GA4_QUEUE_RETENTION_SECONDS = 24 * 60 * 60;

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export type Ga4QueueKind = 'daily' | 'backfill';

export interface Ga4QueueMessage {
    runId: string;
    chain: number;
    kind: Ga4QueueKind;
}

export interface Ga4QueueSend extends Ga4QueueMessage {
    delaySeconds: number;
    idempotencyKey: string;
    retentionSeconds: number;
}

export function monthStart(iso: string): string {
    return `${iso.slice(0, 7)}-01`;
}

export function addUtcMonths(monthStartIso: string, delta: number): string {
    const [year, month] = monthStartIso.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 10);
}

export function lastDayOfMonth(monthStartIso: string): string {
    return addUtcDays(addUtcMonths(monthStartIso, 1), -1);
}

/** Newest month first. Includes the current month. */
export function backfillMonthStarts(now: Date, months = GA4_BACKFILL_MONTHS): string[] {
    const current = monthStart(utcDay(now));
    return Array.from({ length: months }, (_, index) => addUtcMonths(current, -index));
}

/**
 * cursor_date is the month start just saved. The next message walks one month
 * older. A cursor on or before the oldest month means the 16-month pass is done.
 */
export function nextBackfillMonth(cursor: string | null, now: Date): string | null {
    const months = backfillMonthStarts(now);
    const oldest = months[months.length - 1];
    if (!oldest) return null;
    if (!cursor) return months[0] ?? null;
    if (!ISO_DAY.test(cursor)) return null;
    const cursorMonth = monthStart(cursor);
    const index = months.indexOf(cursorMonth);
    if (index >= 0) return months[index + 1] ?? null;
    if (cursorMonth < oldest) return null;
    return months.find(month => month < cursorMonth) ?? null;
}

/** One calendar month, never including today. Null when the month has no closed day yet. */
export function monthRequestRange(month: string, now: Date): { start: string; end: string } | null {
    const start = monthStart(month);
    const yesterday = addUtcDays(utcDay(now), -1);
    const end = lastDayOfMonth(start) < yesterday ? lastDayOfMonth(start) : yesterday;
    if (end < start) return null;
    return { start, end };
}

export function parseGa4QueueMessage(value: unknown, limit = GA4_CHAIN_LIMIT): Ga4QueueMessage | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as { runId?: unknown; chain?: unknown; kind?: unknown };
    if (typeof candidate.runId !== 'string' || !RUN_ID.test(candidate.runId)) return null;
    if (typeof candidate.chain !== 'number' || !Number.isInteger(candidate.chain) || candidate.chain < 1 || candidate.chain > limit) {
        return null;
    }
    if (candidate.kind !== 'daily' && candidate.kind !== 'backfill') return null;
    return { runId: candidate.runId, chain: candidate.chain, kind: candidate.kind };
}

export function ga4QueueSend(message: Ga4QueueMessage, delaySeconds: number): Ga4QueueSend | null {
    const parsed = parseGa4QueueMessage(message);
    if (!parsed) return null;
    const delay = Number.isFinite(delaySeconds) && delaySeconds > 0 ? Math.min(Math.floor(delaySeconds), GA4_QUEUE_RETENTION_SECONDS) : 0;
    const idempotencyKey = `ga4-backfill:${parsed.runId}:${parsed.kind}:${parsed.chain}`;
    if (idempotencyKey.length > 256) return null;
    return { ...parsed, delaySeconds: delay, idempotencyKey, retentionSeconds: GA4_QUEUE_RETENTION_SECONDS };
}

/**
 * One start message per run and kind. The run id is part of the key, so running
 * the cron again the same day publishes a new chain and can restart one that died.
 * The same run id stays idempotent.
 */
export function ga4CronStartSend(now: Date, runId: string, kind: Ga4QueueKind): Ga4QueueSend | null {
    const message = ga4QueueSend({ runId, chain: 1, kind }, 0);
    if (!message) return null;
    return { ...message, idempotencyKey: `ga4-backfill:${utcDay(now)}:${runId}:${kind}:1` };
}

export function nextGa4QueueSend(current: Ga4QueueMessage, delaySeconds: number): Ga4QueueSend | null {
    const chain = current.chain + 1;
    if (!Number.isInteger(chain) || chain > GA4_CHAIN_LIMIT) return null;
    return ga4QueueSend({ runId: current.runId, chain, kind: current.kind }, delaySeconds);
}

export function ga4QuotaDelaySeconds(attempts: number): number {
    return ga4BackoffSeconds(attempts);
}
