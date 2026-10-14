import { bingWebmasterApiKey, bingWebmasterEnabled } from './flags';
import type { BingManualView } from './manual-view';
import { mapUserSites } from './map';
import { mapAndEnqueueBingOrg, syncBingJob, type BingRunDeps, type BingSyncRank } from './run';

/** A few sites per click, inside a short budget so the request can return. */
export const BING_MANUAL_SITE_LIMIT = 3;
export const BING_MANUAL_BUDGET_MS = 20_000;

export interface BingManualLimits {
    siteLimit?: number;
    budgetMs?: number;
    clock?: () => number;
}

function empty(skipped: BingManualView['skipped']): BingManualView {
    return { sitesMapped: 0, sitesSynced: 0, remaining: 0, errors: [], skipped };
}

/** Never synced, then an incomplete snapshot, then the oldest complete sync. */
export function orderManualClientIds(clientIds: string[], ranks: BingSyncRank[]): string[] {
    const byId = new Map(ranks.map(rank => [rank.clientId, rank]));
    const bucket = (clientId: string): number => {
        const rank = byId.get(clientId);
        if (!rank || rank.lastSyncedAt == null) return 0;
        if (!rank.complete) return 1;
        return 2;
    };
    return clientIds
        .map((clientId, index) => ({ clientId, index }))
        .sort((left, right) => {
            const bucketDiff = bucket(left.clientId) - bucket(right.clientId);
            if (bucketDiff !== 0) return bucketDiff;
            if (bucket(left.clientId) === 2) {
                const leftTime = byId.get(left.clientId)?.lastSyncedAt ?? '';
                const rightTime = byId.get(right.clientId)?.lastSyncedAt ?? '';
                if (leftTime < rightTime) return -1;
                if (leftTime > rightTime) return 1;
            }
            return left.index - right.index;
        })
        .map(item => item.clientId);
}

/**
 * Same map-and-enqueue pass as the daily cron, for one organization, then
 * sync a few of that org's sites in this request. Does not publish a queue
 * message. 429 and 503 stop the rest of the click.
 */
export async function runBingManual(
    organizationId: string,
    deps: BingRunDeps,
    limits: BingManualLimits = {},
): Promise<BingManualView> {
    if (!bingWebmasterEnabled(deps.env, organizationId)) return empty('flag_off');
    if (!bingWebmasterApiKey(deps.env)) return empty('missing_key');
    let sites;
    try {
        sites = mapUserSites(await deps.fetchSites());
    } catch {
        return empty('unavailable');
    }
    const clientIds = orderManualClientIds(
        await mapAndEnqueueBingOrg(organizationId, sites, deps),
        await deps.store.listSyncRanks(organizationId),
    );
    const siteLimit = limits.siteLimit ?? BING_MANUAL_SITE_LIMIT;
    const budgetMs = limits.budgetMs ?? BING_MANUAL_BUDGET_MS;
    const clock = limits.clock ?? Date.now;
    const started = clock();
    let cursor = 0;
    let processed = 0;
    let sitesSynced = 0;
    const errors: number[] = [];
    while (cursor < clientIds.length && processed < siteLimit && clock() - started < budgetMs) {
        const clientId = clientIds[cursor];
        cursor += 1;
        const job = await deps.store.claim(clientId);
        if (!job || job.organizationId !== organizationId) continue;
        processed += 1;
        const result = await syncBingJob(job, deps);
        if (result.kind === 'synced') sitesSynced += 1;
        if (result.status != null) errors.push(result.status);
        if (result.kind === 'backoff' || (result.kind === 'synced' && result.backoff)) break;
    }
    return {
        sitesMapped: clientIds.length,
        sitesSynced,
        remaining: clientIds.length - cursor,
        errors,
        skipped: null,
    };
}
