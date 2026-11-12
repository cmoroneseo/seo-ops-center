import type { SupabaseClient } from '@supabase/supabase-js';

import { canonicalDuplicateOf, discoverSitemapPages, isHtmlContentType } from './discovery';
import { extractHtmlEvidence } from './extract';
import { parseRobots, robotsAllows, type ParsedRobots } from './robots';
import { safeSiteFetch } from './safe-fetch';
import { configuredSiteScope, isKnownNonPageAssetUrl, isUrlInSiteScope, normalizeSiteUrl, type SiteScope } from './url';
import { rowToSiteCrawlRun } from '@/lib/supabase/site-inventory';
import type { SiteCrawlRun, SiteDiscoverySource } from '@/lib/types';

const CRAWLER_USER_AGENT = 'SEO-Ops-Center-Crawler';

async function enqueue(admin: SupabaseClient, runId: string, rawUrl: string, sources: SiteDiscoverySource[], depth: number) {
    const normalizedUrl = normalizeSiteUrl(rawUrl);
    const procedure = isKnownNonPageAssetUrl(normalizedUrl) ? 'record_site_crawl_asset_exclusion' : 'enqueue_site_crawl_target';
    const { data, error } = await admin.rpc(procedure, {
        p_run_id: runId, p_raw_url: rawUrl, p_normalized_url: normalizedUrl, p_sources: sources, p_depth: depth,
    });
    if (error) throw error;
    return Boolean(data);
}

async function ensurePage(admin: SupabaseClient, input: {
    organizationId: string;
    clientId: string;
    rawUrl: string;
    sources: SiteDiscoverySource[];
}) {
    const normalizedUrl = normalizeSiteUrl(input.rawUrl);
    const { data, error } = await admin.rpc('ensure_site_page_url', {
        p_organization_id: input.organizationId,
        p_client_id: input.clientId,
        p_raw_url: input.rawUrl,
        p_normalized_url: normalizedUrl,
        p_sources: input.sources,
        p_is_primary: true,
    });
    if (error || !data) throw error ?? new Error('Unable to establish page identity');
    const row = Array.isArray(data) ? data[0] : data;
    return { id: String(row.id), pageId: String(row.site_page_id), normalizedUrl };
}

export async function startSiteCrawl(admin: SupabaseClient, input: {
    organizationId: string;
    clientId: string;
    userId: string;
    domain: string;
    urlLimit?: number;
}): Promise<SiteCrawlRun> {
    const scope = configuredSiteScope(input.domain);
    const urlLimit = Math.max(10, Math.min(500, Math.trunc(input.urlLimit ?? 200)));
    const { data: existing, error: existingError } = await admin.from('site_crawl_runs').select('*')
        .eq('organization_id', input.organizationId).eq('client_id', input.clientId).in('status', ['queued', 'running', 'paused']).maybeSingle();
    if (existingError) throw existingError;
    if (existing) return rowToSiteCrawlRun(existing);

    const { data: run, error: runError } = await admin.from('site_crawl_runs').insert({
        organization_id: input.organizationId,
        client_id: input.clientId,
        seed_url: scope.seedUrl,
        configured_host: scope.configuredHost,
        url_limit: urlLimit,
        status: 'queued',
        created_by: input.userId,
    }).select('*').single();
    if (runError || !run) throw runError ?? new Error('Unable to create crawl run');
    // Targets are enqueued on the first batch: sitemap pages first, link-crawl seeds only if no sitemap lists a page.
    return rowToSiteCrawlRun(run);
}

/** Link-crawl fallback seeds (homepage + recent GSC pages), used only when no sitemap lists any page. */
async function enqueueFallbackSeeds(admin: SupabaseClient, run: Record<string, unknown>, scope: SiteScope) {
    const organizationId = String(run.organization_id);
    const clientId = String(run.client_id);
    const seeds = new Map<string, { raw: string; sources: SiteDiscoverySource[] }>();
    seeds.set(scope.seedUrl, { raw: scope.seedUrl, sources: ['seed'] });
    const { data: connection } = await admin.from('client_integrations').select('site_url:credentials->>site_url')
        .eq('organization_id', organizationId).eq('client_id', clientId).eq('service', 'gsc').maybeSingle();
    if (connection?.site_url) {
        const { data: days } = await admin.from('gsc_history_days').select('id').eq('organization_id', organizationId)
            .eq('client_id', clientId).eq('property', connection.site_url).order('data_date', { ascending: false }).limit(28);
        const dayIds = (days ?? []).map(day => day.id);
        if (dayIds.length > 0) {
            const { data: facts } = await admin.from('gsc_history_facts').select('page').in('day_id', dayIds)
                .in('grain', ['page', 'query_page']).neq('page', '').limit(2000);
            for (const fact of facts ?? []) {
                try {
                    const normalized = normalizeSiteUrl(fact.page);
                    if (!isUrlInSiteScope(normalized, scope)) continue;
                    const current = seeds.get(normalized);
                    seeds.set(normalized, { raw: fact.page, sources: [...new Set([...(current?.sources ?? []), 'gsc' as const])] });
                } catch { /* Keep malformed GSC URLs out of network scope. */ }
            }
        }
    }
    for (const seed of [...seeds.values()].slice(0, Number(run.url_limit))) await enqueue(admin, String(run.id), seed.raw, seed.sources, 0);
}

async function initializeRobotsAndSitemaps(admin: SupabaseClient, run: Record<string, unknown>) {
    if (run.robots_rules) return run.robots_rules as ParsedRobots;
    const scope = configuredSiteScope(String(run.seed_url));
    const robotsUrl = new URL('/robots.txt', scope.seedUrl).toString();
    let parsed: ParsedRobots;
    let robotsStatus: number | undefined;
    try {
        const response = await safeSiteFetch(robotsUrl, scope, undefined, { maxBytes: 512_000, timeoutMs: 5_000, userAgent: CRAWLER_USER_AGENT });
        robotsStatus = response.status;
        if (response.status >= 500) throw new Error('robots.txt returned a server error');
        parsed = response.status === 401 || response.status === 403
            ? parseRobots('User-agent: *\nDisallow: /')
            : response.status >= 200 && response.status < 300 ? parseRobots(response.body.toString('utf8')) : parseRobots('');
    } catch {
        await admin.from('site_crawl_runs').update({ status: 'failed', error_summary: 'Unable to verify robots.txt safely', updated_at: new Date().toISOString() }).eq('id', run.id);
        throw new Error('Unable to verify robots.txt safely');
    }

    const sitemap = await discoverSitemapPages(scope, parsed.sitemaps, async url => {
        const response = await safeSiteFetch(url, scope, undefined, { maxBytes: 2_000_000, timeoutMs: 5_000, userAgent: CRAWLER_USER_AGENT });
        return response.status >= 200 && response.status < 300 ? response.body.toString('utf8') : undefined;
    });
    if (sitemap.pages.length > 0) {
        for (const page of sitemap.pages.slice(0, Number(run.url_limit))) await enqueue(admin, String(run.id), page, ['sitemap'], 0);
    } else {
        await enqueueFallbackSeeds(admin, run, scope);
    }
    const { error } = await admin.from('site_crawl_runs').update({
        robots_url: robotsUrl,
        robots_fetched_at: new Date().toISOString(),
        robots_status: robotsStatus,
        robots_rules: parsed,
        sitemap_count: sitemap.sitemapsRead,
        updated_at: new Date().toISOString(),
    }).eq('id', run.id);
    if (error) throw error;
    return parsed;
}

async function insertSnapshot(admin: SupabaseClient, values: Record<string, unknown>) {
    const { data, error } = await admin.from('site_page_snapshots').insert(values).select('*').single();
    if (error || !data) throw error ?? new Error('Unable to record crawl observation');
    return data;
}

export async function processSiteCrawlBatch(admin: SupabaseClient, input: {
    organizationId: string;
    clientId: string;
    runId: string;
    batchSize?: number;
}) {
    const { data: run, error: runError } = await admin.from('site_crawl_runs').select('*').eq('id', input.runId)
        .eq('organization_id', input.organizationId).eq('client_id', input.clientId).maybeSingle();
    if (runError) throw runError;
    if (!run) throw new Error('Crawl run not found');
    if (!['queued', 'running', 'paused'].includes(run.status)) return { run: rowToSiteCrawlRun(run), processed: 0 };
    const scope = configuredSiteScope(run.seed_url);
    const robots = await initializeRobotsAndSitemaps(admin, run);
    // Sitemap mode iff discovery enqueued sitemap pages; otherwise this run is the link-crawl fallback.
    const { count: sitemapTargets, error: modeError } = await admin.from('site_crawl_targets').select('id', { count: 'exact', head: true })
        .eq('run_id', input.runId).contains('discovery_sources', ['sitemap']);
    if (modeError) throw modeError;
    const sitemapMode = (sitemapTargets ?? 0) > 0;
    const leaseToken = crypto.randomUUID();
    const { data: targets, error: claimError } = await admin.rpc('claim_site_crawl_targets', {
        p_run_id: input.runId, p_lease_token: leaseToken, p_limit: normalizeSiteCrawlBatchSize(input.batchSize),
    });
    if (claimError) throw claimError;

    for (const target of targets ?? []) {
        const { data: existingSnapshot } = await admin.from('site_page_snapshots').select('fetch_status,site_page_id,site_page_url_id')
            .eq('run_id', input.runId).eq('target_id', target.id).maybeSingle();
        if (existingSnapshot) {
            await admin.from('site_crawl_targets').update({
                status: existingSnapshot.fetch_status === 'failed' ? 'failed' : 'completed', lease_token: null, lease_expires_at: null,
                site_page_id: existingSnapshot.site_page_id, site_page_url_id: existingSnapshot.site_page_url_id, updated_at: new Date().toISOString(),
            }).eq('id', target.id).eq('lease_token', leaseToken);
            continue;
        }
        // Page identity is created only once we know the URL is a real page worth recording.
        let identity: Awaited<ReturnType<typeof ensurePage>> | undefined;
        const common = async () => {
            identity ??= await ensurePage(admin, {
                organizationId: input.organizationId, clientId: input.clientId, rawUrl: target.raw_url, sources: target.discovery_sources,
            });
            return {
                organization_id: input.organizationId, client_id: input.clientId, run_id: input.runId, target_id: target.id,
                site_page_id: identity.pageId, site_page_url_id: identity.id, requested_url: target.normalized_url,
            };
        };
        let targetStatus: 'completed' | 'failed' | 'skipped' = 'completed';
        let skipReason: string | undefined;
        try {
            if (!robotsAllows(target.normalized_url, robots, CRAWLER_USER_AGENT)) {
                await insertSnapshot(admin, { ...(await common()), fetch_status: 'blocked', robots_allowed: false, redirect_hops: [], limitation_flags: ['robots_blocked'] });
            } else {
                const response = await safeSiteFetch(target.normalized_url, scope, undefined, { userAgent: CRAWLER_USER_AGENT });
                const contentType = response.headers['content-type']?.split(';')[0].trim().toLowerCase();
                const isHtml = isHtmlContentType(contentType);
                const html = isHtml && response.status < 400 ? response.body.toString('utf8') : '';
                const evidence = extractHtmlEvidence(html, response.finalUrl);
                const duplicateOf = sitemapMode ? undefined : canonicalDuplicateOf(response.finalUrl, evidence.canonicalUrl, scope);
                if (response.status < 400 && (!isHtml || duplicateOf)) {
                    // Non-HTML files and canonical duplicates are not pages: free their slot under the page cap.
                    targetStatus = 'skipped';
                    skipReason = isHtml ? 'canonical_duplicate' : 'non_html_response';
                    if (duplicateOf) await enqueue(admin, input.runId, duplicateOf, ['internal'], Number(target.depth));
                } else if (response.status >= 400) {
                    targetStatus = 'failed';
                    await insertSnapshot(admin, { ...(await common()), final_url: response.finalUrl, fetch_status: 'failed', status_code: response.status, content_type: contentType, response_bytes: response.body.length, redirect_hops: response.redirects, robots_allowed: true, limitation_flags: ['http_error'] });
                } else {
                    const jsUnresolved = evidence.wordCount < 20 && /<script\b/i.test(html);
                    const canonicalIssue = !evidence.canonicalUrl ? 'missing' : !isUrlInSiteScope(evidence.canonicalUrl, scope) ? 'off_scope' : 'none';
                    const internalLinks = evidence.links.filter(link => isUrlInSiteScope(link.url, scope) && !isKnownNonPageAssetUrl(link.url));
                    const excludedAssetLinks = evidence.links.filter(link => isUrlInSiteScope(link.url, scope) && isKnownNonPageAssetUrl(link.url));
                    const snapshot = await insertSnapshot(admin, {
                        ...(await common()), final_url: response.finalUrl, fetch_status: jsUnresolved ? 'js_unresolved' : 'success', status_code: response.status,
                        content_type: contentType, response_bytes: response.body.length, redirect_hops: response.redirects, robots_allowed: true,
                        robots_directives: evidence.robotsDirectives, canonical_url: evidence.canonicalUrl, canonical_issue: canonicalIssue,
                        title: evidence.title, meta_description: evidence.metaDescription, h1s: evidence.h1s, word_count: evidence.wordCount,
                        outbound_internal_links: internalLinks.length, limitation_flags: jsUnresolved ? ['javascript_may_be_required'] : [],
                    });
                    const grouped = new Map<string, { raw: string; normalized: string; anchor: string; nofollow: boolean; count: number }>();
                    for (const link of internalLinks) {
                        const normalized = normalizeSiteUrl(link.url);
                        const key = `${normalized}\u001f${link.anchorText}\u001f${link.nofollow}`;
                        const current = grouped.get(key);
                        grouped.set(key, { raw: link.url, normalized, anchor: link.anchorText.slice(0, 2000), nofollow: link.nofollow, count: (current?.count ?? 0) + 1 });
                    }
                    // Sitemap mode crawls only sitemap URLs; links are still observed but never followed.
                    for (const link of sitemapMode ? [] : excludedAssetLinks) {
                        try {
                            await enqueue(admin, input.runId, link.url, ['internal'], Number(target.depth) + 1);
                        } catch {
                            console.error('[site-crawl] asset exclusion failed');
                            await admin.from('site_crawl_runs').update({ error_summary: 'Some non-page asset exclusions could not be stored', updated_at: new Date().toISOString() }).eq('id', input.runId);
                        }
                    }
                    for (const link of grouped.values()) {
                        try {
                            const destination = await ensurePage(admin, { organizationId: input.organizationId, clientId: input.clientId, rawUrl: link.raw, sources: ['internal'] });
                            if (!sitemapMode) await enqueue(admin, input.runId, link.raw, ['internal'], Number(target.depth) + 1);
                            const { error: linkError } = await admin.from('site_link_observations').upsert({
                                organization_id: input.organizationId, client_id: input.clientId, run_id: input.runId,
                                source_snapshot_id: snapshot.id, source_page_id: snapshot.site_page_id, destination_raw_url: link.raw,
                                destination_normalized_url: link.normalized, destination_page_id: destination.pageId,
                                anchor_text: link.anchor, nofollow: link.nofollow, occurrence_count: link.count,
                            }, { onConflict: 'source_snapshot_id,destination_normalized_url,anchor_text,nofollow' });
                            if (linkError) throw linkError;
                        } catch {
                            console.error('[site-crawl] link observation failed');
                            await admin.from('site_crawl_runs').update({ error_summary: 'Some internal-link observations could not be stored', updated_at: new Date().toISOString() }).eq('id', input.runId);
                        }
                    }
                    if (!sitemapMode && response.finalUrl !== target.normalized_url) {
                        try {
                            if (isKnownNonPageAssetUrl(response.finalUrl)) {
                                await enqueue(admin, input.runId, response.finalUrl, ['redirect'], Number(target.depth));
                            } else {
                                await ensurePage(admin, { organizationId: input.organizationId, clientId: input.clientId, rawUrl: response.finalUrl, sources: ['redirect'] });
                                await enqueue(admin, input.runId, response.finalUrl, ['redirect'], Number(target.depth));
                            }
                        } catch {
                            console.error('[site-crawl] redirect identity failed');
                            await admin.from('site_crawl_runs').update({ error_summary: 'Some redirect identities could not be stored', updated_at: new Date().toISOString() }).eq('id', input.runId);
                        }
                    }
                }
            }
        } catch (error) {
            targetStatus = 'failed';
            const oversized = error instanceof Error && /size limit/i.test(error.message);
            await insertSnapshot(admin, { ...(await common()), fetch_status: oversized ? 'oversized' : 'failed', robots_allowed: true, redirect_hops: [], limitation_flags: [oversized ? 'response_too_large' : 'fetch_failed'] });
        }
        await admin.from('site_crawl_targets').update({
            status: targetStatus, lease_token: null, lease_expires_at: null,
            terminal_classification: skipReason ?? (targetStatus === 'failed' ? 'fetch_failed' : 'observed'),
            site_page_id: identity?.pageId ?? null, site_page_url_id: identity?.id ?? null, updated_at: new Date().toISOString(),
        }).eq('id', target.id).eq('lease_token', leaseToken);
    }

    const { data: allTargets, error: targetsError } = await admin.from('site_crawl_targets').select('status').eq('run_id', input.runId);
    if (targetsError) throw targetsError;
    const statuses = allTargets ?? [];
    const queued = statuses.filter(item => item.status === 'queued' || item.status === 'processing').length;
    const processed = statuses.filter(item => ['completed', 'failed'].includes(item.status)).length;
    const failed = statuses.filter(item => item.status === 'failed').length;
    const { count: blocked = 0 } = await admin.from('site_page_snapshots').select('*', { count: 'exact', head: true }).eq('run_id', input.runId).eq('fetch_status', 'blocked');
    const { data: currentRun } = await admin.from('site_crawl_runs').select('cap_reached').eq('id', input.runId).single();
    const update = {
        discovered_count: statuses.filter(item => item.status !== 'skipped').length,
        processed_count: processed,
        failed_count: failed,
        blocked_count: blocked ?? 0,
        status: queued === 0 ? 'completed' : 'running',
        ...(queued === 0 ? { completed_at: new Date().toISOString(), stop_reason: currentRun?.cap_reached ? 'url_limit_reached' : 'queue_exhausted' } : {}),
        updated_at: new Date().toISOString(),
    };
    const { data: updated, error: updateError } = await admin.from('site_crawl_runs').update(update).eq('id', input.runId).select('*').single();
    if (updateError || !updated) throw updateError ?? new Error('Unable to update crawl run');
    return { run: rowToSiteCrawlRun(updated), processed: (targets ?? []).length };
}

export function normalizeSiteCrawlBatchSize(batchSize?: number) {
    return Math.max(1, Math.min(5, batchSize ?? 1));
}
