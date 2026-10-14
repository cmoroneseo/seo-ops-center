import { bingWebmasterAllowlist, bingWebmasterApiKey, bingWebmasterEnabled } from './flags';
import { mapUserSites, type BingSite } from './map';
import { planBingAutoMap, type BingClientRow, type BingIntegrationRow } from './match';
import {
    BING_HARD_FAIL_DELAY_SECONDS, BING_PARK_SECONDS, BING_SITE_DELAY_SECONDS, BING_SYNC_FAILED_MESSAGE,
    bingBackoffSeconds, bingCronStartSend, nextBingQueueSend, parseBingQueueMessage,
    type BingQueueSend, type SiteReadOutcome,
} from './sync';

export interface BingJob {
    id: string;
    organizationId: string;
    clientId: string;
    siteUrl: string;
    leaseToken: string;
    attempts: number;
}

export interface BingRelease {
    id: string;
    leaseToken: string;
    status: 'idle' | 'pending';
    availableAt: string;
    resetAttempts: boolean;
}

export interface BingStore {
    listClients(organizationId: string): Promise<BingClientRow[]>;
    listIntegrations(organizationId: string): Promise<BingIntegrationRow[]>;
    insertMapping(action: { organizationId: string; clientId: string; siteUrl: string }): Promise<boolean>;
    markUnverified(action: { organizationId: string; clientId: string; siteUrl: string }): Promise<void>;
    enqueue(organizationId: string, clientId: string): Promise<boolean>;
    claim(clientId?: string | null): Promise<BingJob | null>;
    release(input: BingRelease): Promise<void>;
    replace(input: {
        organizationId: string;
        clientId: string;
        siteUrl: string;
        fetchedAt: string;
        traffic: Extract<SiteReadOutcome, { action: 'write' }>['traffic'];
        queries: Extract<SiteReadOutcome, { action: 'write' }>['queries'];
        pages: Extract<SiteReadOutcome, { action: 'write' }>['pages'];
    }): Promise<boolean>;
    markSynced(job: BingJob): Promise<void>;
    markFailed(job: BingJob, message: string): Promise<void>;
}

export interface BingRunDeps {
    env: NodeJS.ProcessEnv;
    now: () => Date;
    newRunId: () => string;
    fetchSites: () => Promise<unknown>;
    readSite: (siteUrl: string) => Promise<SiteReadOutcome>;
    store: BingStore;
    publish: (message: BingQueueSend) => Promise<void>;
}

export type BingCronResult =
    | { skipped: true; reason: 'flag_off' | 'missing_key' }
    | { error: string }
    | { enqueued: number; continued: boolean };

export function syncCronGate(env: NodeJS.ProcessEnv): { ok: true } | { ok: false; reason: 'flag_off' | 'missing_key' } {
    if (bingWebmasterAllowlist(env).length === 0) return { ok: false, reason: 'flag_off' };
    if (!bingWebmasterApiKey(env)) return { ok: false, reason: 'missing_key' };
    return { ok: true };
}

export function cronAuthorized(authorization: string | null, secret: string | undefined): boolean {
    return Boolean(secret) && authorization === `Bearer ${secret}`;
}

function plus(now: Date, seconds: number): string {
    return new Date(now.getTime() + seconds * 1000).toISOString();
}

/**
 * List the account once, map verified hosts, and publish the first site.
 * A failed site list does not mark every client unverified.
 */
export async function runBingCron(deps: BingRunDeps): Promise<BingCronResult> {
    const gate = syncCronGate(deps.env);
    if (!gate.ok) return { skipped: true, reason: gate.reason };
    let sites;
    try {
        sites = mapUserSites(await deps.fetchSites());
    } catch {
        return { error: 'Bing sync will retry on the next run.' };
    }
    let enqueued = 0;
    for (const organizationId of bingWebmasterAllowlist(deps.env)) {
        enqueued += (await mapAndEnqueueBingOrg(organizationId, sites, deps)).length;
    }
    const start = bingCronStartSend(deps.now(), deps.newRunId());
    if (!start) return { error: 'Bing sync will retry on the next run.' };
    await deps.publish(start);
    return { enqueued, continued: true };
}

async function releaseJob(deps: BingRunDeps, job: BingJob, status: 'idle' | 'pending', delaySeconds: number, resetAttempts: boolean): Promise<void> {
    await deps.store.release({
        id: job.id,
        leaseToken: job.leaseToken,
        status,
        availableAt: plus(deps.now(), delaySeconds),
        resetAttempts,
    });
}

async function publishNext(deps: BingRunDeps, current: { runId: string; chain: number }, delaySeconds: number): Promise<void> {
    const next = nextBingQueueSend(current, delaySeconds);
    if (!next) return;
    await deps.publish(next);
}

/** Map and enqueue one organization. Does not publish a queue message. */
export async function mapAndEnqueueBingOrg(organizationId: string, sites: BingSite[], deps: BingRunDeps): Promise<string[]> {
    const clients = await deps.store.listClients(organizationId);
    const integrations = await deps.store.listIntegrations(organizationId);
    const actions = planBingAutoMap({ sites, clients, integrations });
    const enqueued: string[] = [];
    for (const action of actions) {
        if (action.kind === 'markUnverified') {
            await deps.store.markUnverified({
                organizationId: action.organizationId,
                clientId: action.clientId,
                siteUrl: action.siteUrl,
            });
            continue;
        }
        if (action.kind === 'insert') {
            const inserted = await deps.store.insertMapping({
                organizationId: action.organizationId,
                clientId: action.clientId,
                siteUrl: action.siteUrl,
            });
            if (!inserted) continue;
        }
        const woke = await deps.store.enqueue(action.organizationId, action.clientId);
        if (woke) enqueued.push(action.clientId);
    }
    return enqueued;
}

export type BingJobSync =
    | { kind: 'synced'; backoff: boolean; status: number | null }
    | { kind: 'backoff'; status: number | null }
    | { kind: 'failed'; status: number | null };

function statusOf(outcome: SiteReadOutcome): number | null {
    return typeof outcome.status === 'number' ? outcome.status : null;
}

/** Read and write one claimed site. Does not publish the next queue message. */
export async function syncBingJob(job: BingJob, deps: BingRunDeps): Promise<BingJobSync> {
    let outcome: SiteReadOutcome;
    try {
        outcome = await deps.readSite(job.siteUrl);
    } catch {
        outcome = { action: 'fail' };
    }
    const status = statusOf(outcome);
    if (outcome.action === 'skip') {
        await releaseJob(deps, job, 'pending', bingBackoffSeconds(job.attempts), false);
        return { kind: 'backoff', status };
    }
    if (outcome.action === 'fail') {
        await deps.store.markFailed(job, BING_SYNC_FAILED_MESSAGE);
        await releaseJob(deps, job, 'idle', BING_HARD_FAIL_DELAY_SECONDS, false);
        return { kind: 'failed', status };
    }
    try {
        await deps.store.replace({
            organizationId: job.organizationId,
            clientId: job.clientId,
            siteUrl: job.siteUrl,
            fetchedAt: deps.now().toISOString(),
            traffic: outcome.traffic,
            queries: outcome.queries,
            pages: outcome.pages,
        });
    } catch {
        await deps.store.markFailed(job, BING_SYNC_FAILED_MESSAGE);
        await releaseJob(deps, job, 'idle', BING_HARD_FAIL_DELAY_SECONDS, false);
        return { kind: 'failed', status: null };
    }
    await deps.store.markSynced(job);
    await releaseJob(deps, job, 'idle', 0, true);
    return { kind: 'synced', backoff: outcome.backoff, status };
}

/** One claimed site. Flag-off and a bad payload return without writing. */
export async function runBingQueueMessage(message: unknown, deps: BingRunDeps): Promise<void> {
    const parsed = parseBingQueueMessage(message);
    if (!parsed) return;
    if (!syncCronGate(deps.env).ok) return;
    const job = await deps.store.claim();
    if (!job) return;
    if (!bingWebmasterEnabled(deps.env, job.organizationId)) {
        await releaseJob(deps, job, 'idle', BING_PARK_SECONDS, false);
        await publishNext(deps, parsed, BING_SITE_DELAY_SECONDS);
        return;
    }
    const result = await syncBingJob(job, deps);
    if (result.kind === 'backoff' || (result.kind === 'synced' && result.backoff)) {
        await publishNext(deps, parsed, bingBackoffSeconds(job.attempts));
        return;
    }
    await publishNext(deps, parsed, BING_SITE_DELAY_SECONDS);
}
