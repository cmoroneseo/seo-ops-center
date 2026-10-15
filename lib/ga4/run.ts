import {
    GA4_LINK_DELAY_SECONDS, ga4CronStartSend, ga4QuotaDelaySeconds, monthRequestRange, nextBackfillMonth, nextGa4QueueSend,
    parseGa4QueueMessage, type Ga4QueueKind, type Ga4QueueMessage, type Ga4QueueSend,
} from './backfill';

export type { Ga4QueueKind };
import { ga4BackfillEnabled, ga4HistoryEnabled, ga4OrgAllowlist } from './flags';
import { resolveGa4KeyEvents } from './key-events';
import {
    GA4_AUTH_DELAY_SECONDS, GA4_DAILY_COOLDOWN_SECONDS, assembleGa4Days, dailyRepairDates, eachUtcDate,
    quotaPauseScope, type Ga4DayWrite, type PropertyQuotaSnapshot,
} from './sync';

export class Ga4AuthError extends Error {
    readonly kind: 'reauth_required' | 'transient';

    constructor(message: string, kind: 'reauth_required' | 'transient') {
        super(message);
        this.name = 'Ga4AuthError';
        this.kind = kind;
    }
}

export interface Ga4ConnectedClient {
    clientId: string;
    propertyId: string;
}

export interface Ga4Job {
    id: string;
    organizationId: string;
    clientId: string;
    property: string;
    kind: Ga4QueueKind;
    leaseToken: string;
    attempts: number;
    cursorDate: string | null;
}

export interface Ga4Release {
    id: string;
    leaseToken: string;
    status: 'idle' | 'pending';
    availableAt: string;
    cursorDate?: string | null;
    lastError: string | null;
}

export interface Ga4ReportBatch {
    totals: unknown;
    organic: unknown;
    events: unknown;
    landing: unknown;
}

export type Ga4ReadResult =
    | { ok: true; reports: Ga4ReportBatch; quota: PropertyQuotaSnapshot | null }
    | { ok: false; status: number; quota: PropertyQuotaSnapshot | null };

export interface Ga4Store {
    listConnected(organizationId: string): Promise<Ga4ConnectedClient[]>;
    enqueueDaily(organizationId: string, clientId: string): Promise<boolean>;
    enqueueBackfill(organizationId: string, clientId: string): Promise<boolean>;
    hasWork(kind: Ga4QueueKind): Promise<boolean>;
    claim(kind: Ga4QueueKind): Promise<Ga4Job | null>;
    release(input: Ga4Release): Promise<void>;
    replaceDay(job: Ga4Job, fetchedAt: string, day: Ga4DayWrite): Promise<boolean>;
    keyEventOverride(job: Ga4Job): Promise<string[] | null>;
    markSynced(job: Ga4Job): Promise<void>;
    markReauth(job: Ga4Job): Promise<void>;
    markFailed(job: Ga4Job): Promise<void>;
}

export interface Ga4RunDeps {
    env: NodeJS.ProcessEnv;
    now: () => Date;
    newRunId: () => string;
    store: Ga4Store;
    publish: (message: Ga4QueueSend) => Promise<void>;
    getToken: (clientId: string) => Promise<{ token: string } | null>;
    listKeyEvents: (token: string, propertyId: string) => Promise<string[]>;
    readRange: (input: {
        token: string;
        propertyId: string;
        start: string;
        end: string;
        keyEvents: string[] | null;
    }) => Promise<Ga4ReadResult>;
}

export type Ga4CronResult =
    | { skipped: true; reason: 'flag_off' }
    | { error: string }
    | { daily: boolean; backfill: boolean };

export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
    return Boolean(secret) && authorization === `Bearer ${secret}`;
}

function plus(now: Date, seconds: number): string {
    return new Date(now.getTime() + seconds * 1000).toISOString();
}

export async function runGa4Cron(deps: Ga4RunDeps): Promise<Ga4CronResult> {
    const organizations = ga4OrgAllowlist(deps.env);
    if (organizations.length === 0) return { skipped: true, reason: 'flag_off' };
    for (const organizationId of organizations) {
        if (!ga4HistoryEnabled(deps.env, organizationId)) continue;
        const clients = await deps.store.listConnected(organizationId);
        for (const client of clients) {
            await deps.store.enqueueDaily(organizationId, client.clientId);
            if (ga4BackfillEnabled(deps.env, organizationId)) {
                await deps.store.enqueueBackfill(organizationId, client.clientId);
            }
        }
    }
    const runId = deps.newRunId();
    let daily = false;
    let backfill = false;
    if (await deps.store.hasWork('daily')) {
        const message = ga4CronStartSend(deps.now(), runId, 'daily');
        if (message) {
            await deps.publish(message);
            daily = true;
        }
    }
    if (organizations.some(organizationId => ga4BackfillEnabled(deps.env, organizationId)) && await deps.store.hasWork('backfill')) {
        const message = ga4CronStartSend(deps.now(), runId, 'backfill');
        if (message) {
            await deps.publish(message);
            backfill = true;
        }
    }
    return { daily, backfill };
}

async function readDays(
    deps: Ga4RunDeps,
    job: Ga4Job,
    dates: string[],
): Promise<
    | { days: Ga4DayWrite[]; pause: ReturnType<typeof quotaPauseScope> }
    | { paused: true; status: number }
    | { auth: Ga4AuthError }
    | { failed: true }
> {
    if (dates.length === 0) return { days: [], pause: null };
    let token: { token: string } | null;
    try {
        token = await deps.getToken(job.clientId);
    } catch (error) {
        if (error instanceof Ga4AuthError) return { auth: error };
        return { failed: true };
    }
    if (!token) return { auth: new Ga4AuthError('GA4 is not connected', 'reauth_required') };
    let listed: string[];
    try {
        listed = await deps.listKeyEvents(token.token, job.property);
    } catch (error) {
        if (error instanceof Ga4AuthError) return { auth: error };
        return { failed: true };
    }
    const keyEvents = resolveGa4KeyEvents(listed, await deps.store.keyEventOverride(job));
    const start = dates[0];
    const end = dates[dates.length - 1];
    if (!start || !end) return { failed: true };
    let read: Ga4ReadResult;
    try {
        read = await deps.readRange({ token: token.token, propertyId: job.property, start, end, keyEvents });
    } catch (error) {
        if (error instanceof Ga4AuthError) return { auth: error };
        return { failed: true };
    }
    if (!read.ok) {
        if (read.status === 401 || read.status === 403) return { auth: new Ga4AuthError('GA4 authorization was rejected', 'reauth_required') };
        if (read.status === 429) return { paused: true, status: read.status };
        return { failed: true };
    }
    const fetchedAt = deps.now().toISOString();
    const days = assembleGa4Days({
        dates,
        now: deps.now(),
        keyEvents,
        totals: read.reports.totals,
        organic: read.reports.organic,
        events: read.reports.events,
        landing: read.reports.landing,
    });
    for (const day of days) {
        await deps.store.replaceDay(job, fetchedAt, day);
    }
    return { days, pause: quotaPauseScope(read.quota) };
}

async function parkAuth(deps: Ga4RunDeps, job: Ga4Job, error: Ga4AuthError, now: Date): Promise<void> {
    if (error.kind === 'reauth_required') await deps.store.markReauth(job);
    await deps.store.release({
        id: job.id,
        leaseToken: job.leaseToken,
        status: error.kind === 'reauth_required' ? 'idle' : 'pending',
        availableAt: plus(now, error.kind === 'reauth_required' ? GA4_AUTH_DELAY_SECONDS : ga4QuotaDelaySeconds(job.attempts)),
        lastError: error.kind === 'reauth_required' ? 'reauth' : 'ga4_sync_failed',
    });
}

async function finishSuccess(deps: Ga4RunDeps, job: Ga4Job, availableAt: string, cursorDate?: string | null): Promise<void> {
    await deps.store.markSynced(job);
    await deps.store.release({
        id: job.id,
        leaseToken: job.leaseToken,
        status: 'idle',
        availableAt,
        lastError: null,
        ...(cursorDate !== undefined ? { cursorDate } : {}),
    });
}

async function continueChain(deps: Ga4RunDeps, current: Ga4QueueMessage, delaySeconds: number): Promise<void> {
    const next = nextGa4QueueSend(current, delaySeconds);
    if (next && await deps.store.hasWork(current.kind)) await deps.publish(next);
}

export async function runGa4QueueMessage(message: unknown, deps: Ga4RunDeps): Promise<void> {
    const parsed = parseGa4QueueMessage(message);
    if (!parsed) return;
    if (ga4OrgAllowlist(deps.env).length === 0) return;
    if (parsed.kind === 'backfill' && !ga4OrgAllowlist(deps.env).some(organizationId => ga4BackfillEnabled(deps.env, organizationId))) return;
    const job = await deps.store.claim(parsed.kind);
    if (!job) return;
    if (!ga4HistoryEnabled(deps.env, job.organizationId) || (parsed.kind === 'backfill' && !ga4BackfillEnabled(deps.env, job.organizationId))) {
        await deps.store.release({
            id: job.id,
            leaseToken: job.leaseToken,
            status: 'idle',
            availableAt: plus(deps.now(), GA4_AUTH_DELAY_SECONDS),
            lastError: null,
        });
        return;
    }

    const now = deps.now();
    if (parsed.kind === 'daily') {
        const dates = [...dailyRepairDates(now)].sort();
        const outcome = await readDays(deps, job, dates);
        if ('auth' in outcome) {
            await parkAuth(deps, job, outcome.auth, now);
            if (outcome.auth.kind === 'reauth_required') await continueChain(deps, parsed, GA4_LINK_DELAY_SECONDS);
            return;
        }
        if ('failed' in outcome) {
            await deps.store.markFailed(job);
            await deps.store.release({
                id: job.id, leaseToken: job.leaseToken, status: 'pending',
                availableAt: plus(now, ga4QuotaDelaySeconds(job.attempts)), lastError: 'ga4_sync_failed',
            });
            return;
        }
        if ('paused' in outcome) {
            await deps.store.release({
                id: job.id, leaseToken: job.leaseToken, status: 'pending',
                availableAt: plus(now, ga4QuotaDelaySeconds(job.attempts)), lastError: 'quota',
            });
            await continueChain(deps, parsed, ga4QuotaDelaySeconds(job.attempts));
            return;
        }
        await finishSuccess(deps, job, plus(now, GA4_DAILY_COOLDOWN_SECONDS));
        await continueChain(deps, parsed, outcome.pause ? ga4QuotaDelaySeconds(job.attempts) : GA4_LINK_DELAY_SECONDS);
        return;
    }

    const month = nextBackfillMonth(job.cursorDate, now);
    if (!month) {
        await finishSuccess(deps, job, now.toISOString(), job.cursorDate);
        return;
    }
    const range = monthRequestRange(month, now);
    if (!range) {
        await deps.store.release({
            id: job.id, leaseToken: job.leaseToken, status: 'pending',
            availableAt: now.toISOString(), cursorDate: month, lastError: null,
        });
        await continueChain(deps, parsed, GA4_LINK_DELAY_SECONDS);
        return;
    }
    const outcome = await readDays(deps, job, eachUtcDate(range.start, range.end));
    if ('auth' in outcome) {
        await parkAuth(deps, job, outcome.auth, now);
        if (outcome.auth.kind === 'reauth_required') await continueChain(deps, parsed, GA4_LINK_DELAY_SECONDS);
        return;
    }
    if ('failed' in outcome) {
        await deps.store.markFailed(job);
        await deps.store.release({
            id: job.id, leaseToken: job.leaseToken, status: 'pending',
            availableAt: plus(now, ga4QuotaDelaySeconds(job.attempts)), lastError: 'ga4_sync_failed',
        });
        return;
    }
    if ('paused' in outcome) {
        await deps.store.release({
            id: job.id, leaseToken: job.leaseToken, status: 'pending',
            availableAt: plus(now, ga4QuotaDelaySeconds(job.attempts)), lastError: 'quota',
        });
        await continueChain(deps, parsed, ga4QuotaDelaySeconds(job.attempts));
        return;
    }
    const next = nextBackfillMonth(month, now);
    const pause = outcome.pause != null;
    await deps.store.markSynced(job);
    await deps.store.release({
        id: job.id,
        leaseToken: job.leaseToken,
        status: next ? 'pending' : 'idle',
        availableAt: pause
            ? plus(now, ga4QuotaDelaySeconds(job.attempts))
            : (next ? now.toISOString() : plus(now, GA4_DAILY_COOLDOWN_SECONDS)),
        cursorDate: month,
        lastError: pause ? 'quota' : null,
    });
    if (next) await continueChain(deps, parsed, pause ? ga4QuotaDelaySeconds(job.attempts) : GA4_LINK_DELAY_SECONDS);
}
