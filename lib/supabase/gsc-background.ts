import { createAdminClient } from './admin';
import { getGoogleAccessToken, GoogleAuthError } from '@/lib/sync/token';
import { fetchGscDay, gbpLandingUrlsFromCustomFields, GSC_HISTORY_FACT_LIMIT } from '@/lib/gsc/history';
import {
    backgroundHistoryDates, backgroundWindowLength, planBackgroundDays, planV2Backfill, retryDelaySeconds,
    V2_BACKFILL_HISTORY_DAYS, V2_REQUEST_GAP_MS,
} from '@/lib/gsc/background';
import {
    AUTH_SKIP_DELAY_SECONDS, BACKFILL_BUDGET_MS, BACKFILL_LOCK_STALE_MS, BACKFILL_MAX_DAYS, BACKFILL_MIN_DAY_MS,
    backfillLockIsLive, canStartBackfillDay, daysDoneFromCursor, isGscQuotaError, quotaDelaySeconds,
} from '@/lib/gsc/backfill';
import { gscHistoryV2BackfillEnabled, gscHistoryV2Enabled } from '@/lib/gsc/flags';

const BACKFILL_LOCK_SERVICE = 'gsc_v2_backfill_lock';

export async function enqueueGscSync(organizationId: string, clientId: string): Promise<boolean> {
    const { data, error } = await createAdminClient().rpc('enqueue_gsc_sync', {
        p_organization_id: organizationId, p_client_id: clientId,
    });
    if (error) throw new Error('Unable to schedule search performance');
    return data === true;
}

export async function enqueueGscV2Backfill(organizationId: string, clientId: string): Promise<boolean> {
    if (!gscHistoryV2BackfillEnabled()) return false;
    const { data, error } = await createAdminClient().rpc('enqueue_gsc_v2_backfill', {
        p_organization_id: organizationId, p_client_id: clientId,
    });
    if (error) throw new Error('Unable to schedule search performance');
    return data === true;
}

/** Paginate the catalog so a large agency does not lose clients after row 1000. */
export async function enqueueConnectedGscJobs(): Promise<number> {
    const admin = createAdminClient();
    let queued = 0;
    for (let offset = 0; ; offset += 500) {
        const { data, error } = await admin.from('client_integrations').select('client_id,organization_id')
            .eq('service', 'gsc').in('sync_status', ['active', 'error']).order('id').range(offset, offset + 499);
        if (error) throw new Error('Unable to load connections');
        for (const row of data ?? []) {
            await enqueueGscSync(row.organization_id, row.client_id);
            if (gscHistoryV2BackfillEnabled()) await enqueueGscV2Backfill(row.organization_id, row.client_id);
            queued += 1;
        }
        if ((data?.length ?? 0) < 500) break;
    }
    return queued;
}

interface JobRow {
    id: string;
    organization_id: string;
    client_id: string;
    property: string;
    lease_token: string;
    attempts: number;
    cursor_date?: string | null;
}
function rowToJob(row: JobRow) {
    return {
        id: row.id, organizationId: row.organization_id, clientId: row.client_id,
        property: row.property, leaseToken: row.lease_token, attempts: row.attempts,
        cursorDate: row.cursor_date ?? null,
    };
}

async function landingUrlsFor(admin: ReturnType<typeof createAdminClient>, organizationId: string, clientId: string) {
    const { data } = await admin.from('clients').select('custom_fields').eq('id', clientId).eq('organization_id', organizationId).maybeSingle();
    return gbpLandingUrlsFromCustomFields(data?.custom_fields);
}

/** Leased batches survive request cancellation, crashes, retries, and overlapping workers. */
export async function runGscSyncWorker(options: { clientId?: string; budgetMs?: number } = {}) {
    const deadline = Date.now() + (options.budgetMs ?? 240000);
    const admin = createAdminClient();
    let imported = 0;
    let failed = 0;
    while (Date.now() + 20000 < deadline) {
        const { data, error } = await admin.rpc('claim_gsc_sync', { p_client_id: options.clientId ?? null });
        if (error) throw new Error('Unable to claim search performance work');
        const row = (data as JobRow[] | null)?.[0];
        if (!row) break;
        const job = rowToJob(row);
        let remaining = false;
        let delay = 0;
        let succeeded = false;
        try {
            const now = new Date();
            const dates = backgroundHistoryDates(now, backgroundWindowLength());
            const v2 = gscHistoryV2Enabled();
            const auth = await getGoogleAccessToken(job.clientId, 'gsc');
            if (!auth || auth.creds.site_url !== job.property) throw new Error('Connection changed');
            const { data: days, error: coverageError } = await admin.from('gsc_history_days')
                .select('data_date,imported_at').eq('organization_id', job.organizationId)
                .eq('client_id', job.clientId).eq('property', job.property)
                .gte('data_date', dates.at(-1)!).lte('data_date', dates[0]);
            if (coverageError) throw new Error('Unable to read coverage');
            const selected = planBackgroundDays(dates, days ?? [], now);
            const sharedSignal = v2 ? null : AbortSignal.timeout(Math.max(1, Math.min(60000, deadline - Date.now() - 2000)));
            const savedDates = new Set((days ?? []).map(day => day.data_date));
            const gbpLandingUrls = v2 ? await landingUrlsFor(admin, job.organizationId, job.clientId) : [];
            for (const date of selected) {
                // v1 keeps one shared timeout. v2 days make more requests, so each day gets its own.
                const signal = sharedSignal ?? AbortSignal.timeout(Math.max(1, Math.min(60000, deadline - Date.now() - 2000)));
                const day = await fetchGscDay(job.property, auth.token, date, {
                    signal, v2, gbpLandingUrls, minIntervalMs: v2 ? V2_REQUEST_GAP_MS : 0,
                });
                const { data: saved, error: saveError } = await admin.rpc('replace_gsc_history_day', {
                    p_organization_id: job.organizationId, p_client_id: job.clientId, p_property: job.property,
                    p_date: date, p_fetched_at: day.fetchedAt, p_page_limited: day.pageLimited,
                    p_query_limited: day.queryLimited, p_facts: day.facts, p_is_incomplete: day.isIncomplete,
                });
                if (saveError || saved !== true) throw new Error('Snapshot was not saved');
                savedDates.add(date);
                imported += 1;
            }
            if (selected.length > 0) {
                // Clear recovered connection errors only for the property we just fetched.
                const { error: connectionError } = await admin.from('client_integrations').update({
                    sync_status: 'active', error_message: null, last_synced_at: new Date().toISOString(),
                }).eq('organization_id', job.organizationId).eq('client_id', job.clientId)
                    .eq('service', 'gsc').eq('credentials->>site_url', job.property);
                if (connectionError) throw new Error('Unable to update connection health');
            }
            remaining = dates.some(date => !savedDates.has(date));
            succeeded = true;
            delay = remaining ? 0 : 3600;
        } catch {
            // No raw API responses or tokens enter job records or client-visible errors.
            failed += 1;
            remaining = true;
            delay = retryDelaySeconds(job.attempts);
        }
        const { error: finishError } = await admin.from('gsc_sync_jobs').update({
            status: remaining ? 'pending' : 'idle', available_at: new Date(Date.now() + delay * 1000).toISOString(),
            lease_token: null, lease_until: null, updated_at: new Date().toISOString(),
            ...(succeeded ? { attempts: 0 } : {}),
        }).eq('id', job.id).eq('lease_token', job.leaseToken);
        if (finishError) throw new Error('Unable to release search performance work');
    }
    return { imported, failed };
}

export interface GscBackfillWorkerResult {
    imported: number;
    failed: number;
    skipped: number;
    quotaPaused: boolean;
    disabled: boolean;
    notices: { organizationId: string; clientId: string; message: string }[];
}

interface JobRelease {
    remaining: boolean;
    delaySeconds: number;
    succeeded: boolean;
    cursor: string | null;
}

/**
 * Leased, newest-first. Each claim saves several days while the time budget
 * allows, then releases the row so the next claim can rotate to another client.
 * Quota errors keep cursor_date on the last saved day and pause this invocation.
 */
export async function runGscV2BackfillWorker(options: {
    clientId?: string;
    budgetMs?: number;
    minDayMs?: number;
    maxDays?: number;
} = {}): Promise<GscBackfillWorkerResult> {
    if (!gscHistoryV2BackfillEnabled()) {
        return { imported: 0, failed: 0, skipped: 0, quotaPaused: false, disabled: true, notices: [] };
    }
    const budgetMs = options.budgetMs ?? BACKFILL_BUDGET_MS;
    const minDayMs = options.minDayMs ?? BACKFILL_MIN_DAY_MS;
    const maxDays = options.maxDays ?? BACKFILL_MAX_DAYS;
    const deadline = Date.now() + budgetMs;
    const admin = createAdminClient();
    let imported = 0;
    let failed = 0;
    let skipped = 0;
    let quotaPaused = false;
    let daysThisRun = 0;
    const notices: GscBackfillWorkerResult['notices'] = [];

    const release = async (job: ReturnType<typeof rowToJob>, next: JobRelease) => {
        const { error } = await admin.from('gsc_sync_jobs').update({
            status: next.remaining ? 'pending' : 'idle',
            available_at: new Date(Date.now() + next.delaySeconds * 1000).toISOString(),
            lease_token: null,
            lease_until: null,
            cursor_date: next.cursor,
            updated_at: new Date().toISOString(),
            ...(next.succeeded ? { attempts: 0 } : {}),
        }).eq('id', job.id).eq('lease_token', job.leaseToken);
        if (error) throw new Error('Unable to release search performance work');
    };

    while (canStartBackfillDay({ remainingMs: deadline - Date.now(), daysThisRun, maxDays, minDayMs })) {
        const { data, error } = await admin.rpc('claim_gsc_sync', { p_client_id: options.clientId ?? null, p_kind: 'v2_backfill' });
        if (error) throw new Error('Unable to claim search performance work');
        const row = (data as JobRow[] | null)?.[0];
        if (!row) break;
        const job = rowToJob(row);
        let cursor = job.cursorDate;
        try {
            let auth: Awaited<ReturnType<typeof getGoogleAccessToken>>;
            try {
                auth = await getGoogleAccessToken(job.clientId, 'gsc');
            } catch (error) {
                if (error instanceof GoogleAuthError && error.kind === 'reauth_required') {
                    skipped += 1;
                    notices.push({ organizationId: job.organizationId, clientId: job.clientId, message: 'Search Console authorization is missing. Backfill will retry later.' });
                    await release(job, { remaining: true, delaySeconds: AUTH_SKIP_DELAY_SECONDS, succeeded: false, cursor });
                    continue;
                }
                throw error;
            }
            if (!auth || auth.creds.site_url !== job.property) {
                skipped += 1;
                notices.push({ organizationId: job.organizationId, clientId: job.clientId, message: 'Search Console authorization is missing. Backfill will retry later.' });
                await release(job, { remaining: true, delaySeconds: AUTH_SKIP_DELAY_SECONDS, succeeded: false, cursor });
                continue;
            }
            const now = new Date();
            const dates = backgroundHistoryDates(now, V2_BACKFILL_HISTORY_DAYS);
            const gbpLandingUrls = await landingUrlsFor(admin, job.organizationId, job.clientId);
            const plan = planV2Backfill(dates, cursor, maxDays);
            if (plan.done) {
                await release(job, { remaining: false, delaySeconds: 86400, succeeded: true, cursor: plan.cursor });
                continue;
            }
            let savedAny = false;
            for (const date of plan.dates) {
                if (!canStartBackfillDay({ remainingMs: deadline - Date.now(), daysThisRun, maxDays, minDayMs })) break;
                const signal = AbortSignal.timeout(Math.max(1, Math.min(60000, deadline - Date.now() - 2000)));
                const day = await fetchGscDay(job.property, auth.token, date, {
                    signal, v2: true, gbpLandingUrls, minIntervalMs: V2_REQUEST_GAP_MS,
                });
                if (!Number.isInteger(day.facts.length) || day.facts.length > GSC_HISTORY_FACT_LIMIT) {
                    throw new Error('Invalid history batch');
                }
                const { data: saved, error: saveError } = await admin.rpc('replace_gsc_history_day', {
                    p_organization_id: job.organizationId, p_client_id: job.clientId, p_property: job.property,
                    p_date: date, p_fetched_at: day.fetchedAt, p_page_limited: day.pageLimited,
                    p_query_limited: day.queryLimited, p_facts: day.facts, p_is_incomplete: day.isIncomplete,
                });
                if (saveError || saved !== true) throw new Error('Snapshot was not saved');
                cursor = date;
                savedAny = true;
                imported += 1;
                daysThisRun += 1;
                const { data: held, error: holdError } = await admin.from('gsc_sync_jobs').update({
                    lease_until: new Date(Date.now() + 90000).toISOString(),
                    cursor_date: cursor,
                    updated_at: new Date().toISOString(),
                }).eq('id', job.id).eq('lease_token', job.leaseToken).select('id');
                if (holdError || (held?.length ?? 0) !== 1) throw new Error('Search performance lease expired');
            }
            const done = planV2Backfill(dates, cursor, 1).done;
            await release(job, {
                remaining: !done,
                delaySeconds: done ? 86400 : 0,
                succeeded: savedAny || done,
                cursor,
            });
        } catch (error) {
            const quota = isGscQuotaError(error);
            if (quota) {
                quotaPaused = true;
                notices.push({ organizationId: job.organizationId, clientId: job.clientId, message: 'Search Console quota reached. Backfill will resume from the saved day.' });
            }
            failed += 1;
            await release(job, {
                remaining: true,
                delaySeconds: quota ? quotaDelaySeconds(job.attempts) : retryDelaySeconds(job.attempts),
                succeeded: false,
                cursor,
            });
            if (quota) break;
        }
    }
    return { imported, failed, skipped, quotaPaused, disabled: false, notices };
}

export interface GscBackfillProgressRow {
    organizationId: string;
    clientId: string;
    status: string;
    cursorDate: string | null;
    availableAt: string;
    daysDone: number;
    daysTotal: number;
}

/** Cumulative days saved for every v2 backfill job, including parked idle rows. */
export async function listGscV2BackfillProgress(now = new Date()): Promise<GscBackfillProgressRow[]> {
    const admin = createAdminClient();
    const { data, error } = await admin.from('gsc_sync_jobs')
        .select('organization_id, client_id, status, cursor_date, available_at')
        .eq('kind', 'v2_backfill')
        .order('client_id');
    if (error) throw new Error('Unable to read search performance progress');
    return (data ?? []).map(row => ({
        organizationId: row.organization_id,
        clientId: row.client_id,
        status: row.status,
        cursorDate: row.cursor_date,
        availableAt: row.available_at,
        ...daysDoneFromCursor(row.cursor_date, now),
    }));
}

interface LockOutcome { service?: unknown; heartbeat?: unknown }

function lockHeartbeat(sourceOutcomes: unknown, startedAt: string): string | null {
    const outcomes = Array.isArray(sourceOutcomes) ? sourceOutcomes : [];
    const lock = outcomes.find((item): item is LockOutcome =>
        !!item && typeof item === 'object' && (item as LockOutcome).service === BACKFILL_LOCK_SERVICE);
    if (!lock) return null;
    return typeof lock.heartbeat === 'string' ? lock.heartbeat : startedAt;
}

async function listGscBackfillLocks(now: number): Promise<{ id: string; live: boolean }[]> {
    const admin = createAdminClient();
    const { data, error } = await admin.from('sync_runs')
        .select('id, source_outcomes, started_at')
        .eq('status', 'running')
        .order('started_at', { ascending: false })
        .limit(30);
    if (error) throw new Error('Unable to read search performance lock');
    const locks: { id: string; live: boolean }[] = [];
    for (const row of data ?? []) {
        const heartbeat = lockHeartbeat(row.source_outcomes, row.started_at);
        if (heartbeat == null) continue;
        locks.push({ id: row.id, live: backfillLockIsLive(heartbeat, now, BACKFILL_LOCK_STALE_MS) });
    }
    return locks;
}

export async function gscBackfillLockIsHeld(now = Date.now()): Promise<boolean> {
    const locks = await listGscBackfillLocks(now);
    return locks.some(lock => lock.live);
}

export async function gscBackfillLockHeldBy(runId: string, now = Date.now()): Promise<boolean> {
    const locks = await listGscBackfillLocks(now);
    return locks.some(lock => lock.live && lock.id === runId);
}

export async function closeStaleGscBackfillLocks(now = Date.now()): Promise<void> {
    const stale = (await listGscBackfillLocks(now)).filter(lock => !lock.live);
    if (stale.length === 0) return;
    const admin = createAdminClient();
    for (const lock of stale) {
        await admin.from('sync_runs').update({
            status: 'failed',
            finished_at: new Date(now).toISOString(),
            error_summary: [{ service: 'gsc', message: 'Backfill run did not finish' }],
        }).eq('id', lock.id).eq('status', 'running');
    }
}

export async function openGscBackfillLock(organizationId: string, now = new Date()): Promise<string> {
    const admin = createAdminClient();
    const heartbeat = now.toISOString();
    const { data, error } = await admin.from('sync_runs').insert({
        organization_id: organizationId,
        status: 'running',
        trigger: 'cron',
        started_at: heartbeat,
        source_outcomes: [{ service: BACKFILL_LOCK_SERVICE, heartbeat }],
    }).select('id').single();
    if (error || !data) throw new Error('Unable to start search performance backfill');
    return data.id;
}

export async function touchGscBackfillLock(runId: string, now = new Date()): Promise<void> {
    const admin = createAdminClient();
    const heartbeat = now.toISOString();
    const { error } = await admin.from('sync_runs').update({
        started_at: heartbeat,
        source_outcomes: [{ service: BACKFILL_LOCK_SERVICE, heartbeat }],
    }).eq('id', runId).eq('status', 'running');
    if (error) throw new Error('Unable to refresh search performance backfill');
}

function progressPayload(rows: GscBackfillProgressRow[]) {
    return {
        service: 'gsc_v2_backfill',
        days_total: V2_BACKFILL_HISTORY_DAYS,
        clients: rows.map(row => ({
            client_id: row.clientId,
            days_done: row.daysDone,
            days_total: row.daysTotal,
            cursor_date: row.cursorDate,
            status: row.status,
        })),
    };
}

/**
 * One completed sync_runs row per organization. Org members can read their own
 * rows, so each row lists only that organization's clients.
 */
export async function recordGscBackfillProgress(input: {
    imported: number;
    failed: number;
    skipped: number;
    notices: { organizationId: string; clientId: string; message: string }[];
    progress: GscBackfillProgressRow[];
}): Promise<void> {
    if (input.imported === 0 && input.failed === 0 && input.skipped === 0 && input.notices.length === 0) return;
    const admin = createAdminClient();
    const byOrg = new Map<string, GscBackfillProgressRow[]>();
    for (const row of input.progress) {
        const list = byOrg.get(row.organizationId) ?? [];
        list.push(row);
        byOrg.set(row.organizationId, list);
    }
    for (const [organizationId, rows] of byOrg) {
        const notices = input.notices.filter(notice => notice.organizationId === organizationId);
        const { error } = await admin.from('sync_runs').insert({
            organization_id: organizationId,
            status: notices.length > 0 ? 'partial' : 'completed',
            finished_at: new Date().toISOString(),
            trigger: 'cron',
            clients_synced: rows.length,
            clients_errored: notices.length,
            clients_skipped: notices.filter(notice => notice.message.includes('authorization')).length,
            error_summary: notices.map(notice => ({ client_id: notice.clientId, service: 'gsc', message: notice.message })),
            source_outcomes: [{
                ...progressPayload(rows),
                imported_days: input.imported,
                failed: input.failed,
                skipped: input.skipped,
            }],
        });
        if (error) console.warn('gsc_v2_backfill progress was not recorded');
    }
}

export async function finishGscBackfillLock(runId: string, status: 'completed' | 'partial' | 'failed'): Promise<void> {
    const admin = createAdminClient();
    const { error } = await admin.from('sync_runs').update({
        status,
        finished_at: new Date().toISOString(),
    }).eq('id', runId).eq('status', 'running');
    if (error) console.warn('gsc_v2_backfill lock was not released');
}

export async function firstConnectedGscOrganizationId(): Promise<string | null> {
    const admin = createAdminClient();
    const { data, error } = await admin.from('client_integrations')
        .select('organization_id')
        .eq('service', 'gsc')
        .in('sync_status', ['active', 'error'])
        .order('id')
        .limit(1);
    if (error) throw new Error('Unable to load connections');
    return data?.[0]?.organization_id ?? null;
}
