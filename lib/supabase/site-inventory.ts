import type { SupabaseClient } from '@supabase/supabase-js';

import { calculateCrawlHealth } from '@/lib/site-inventory/health';
import type { SiteCrawlRun, SiteCrawlRunStatus, SiteDiscoverySource, SiteInventoryPayload, SitePageObservation } from '@/lib/types';

export function rowToSiteCrawlRun(row: Record<string, unknown>): SiteCrawlRun {
    return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        clientId: String(row.client_id),
        seedUrl: String(row.seed_url),
        configuredHost: String(row.configured_host),
        urlLimit: Number(row.url_limit),
        status: row.status as SiteCrawlRunStatus,
        discoveredCount: Number(row.discovered_count),
        processedCount: Number(row.processed_count),
        failedCount: Number(row.failed_count),
        blockedCount: Number(row.blocked_count),
        capReached: Boolean(row.cap_reached),
        ...(row.stop_reason ? { stopReason: String(row.stop_reason) } : {}),
        ...(row.error_summary ? { errorSummary: String(row.error_summary) } : {}),
        ...(row.started_at ? { startedAt: String(row.started_at) } : {}),
        ...(row.completed_at ? { completedAt: String(row.completed_at) } : {}),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
    };
}

export function rowsToSitePageObservations(input: {
    seedUrl: string;
    snapshots: Array<Record<string, unknown>>;
    urls: Array<Record<string, unknown>>;
    links: Array<Record<string, unknown>>;
}): SitePageObservation[] {
    const urls = new Map(input.urls.map(row => [String(row.id), row]));
    const inbound = new Map<string, number>();
    for (const link of input.links) {
        const destination = String(link.destination_normalized_url);
        inbound.set(destination, (inbound.get(destination) ?? 0) + 1);
    }
    return input.snapshots.map(row => {
        const url = urls.get(String(row.site_page_url_id)) ?? {};
        const normalizedUrl = String(url.normalized_url ?? row.requested_url);
        return {
            snapshotId: String(row.id),
            pageId: String(row.site_page_id),
            pageUrlId: String(row.site_page_url_id),
            requestedUrl: String(row.requested_url),
            ...(row.final_url ? { finalUrl: String(row.final_url) } : {}),
            normalizedUrl,
            isHomepage: normalizedUrl === input.seedUrl,
            discoverySources: (url.discovery_sources ?? []) as SiteDiscoverySource[],
            observedAt: String(row.observed_at),
            fetchStatus: row.fetch_status as SitePageObservation['fetchStatus'],
            ...(row.status_code !== null && row.status_code !== undefined ? { statusCode: Number(row.status_code) } : {}),
            ...(row.content_type ? { contentType: String(row.content_type) } : {}),
            ...(row.response_bytes !== null && row.response_bytes !== undefined ? { responseBytes: Number(row.response_bytes) } : {}),
            redirectHops: Array.isArray(row.redirect_hops) ? row.redirect_hops.map(String) : [],
            ...(typeof row.robots_allowed === 'boolean' ? { robotsAllowed: row.robots_allowed } : {}),
            robotsDirectives: (row.robots_directives ?? []) as string[],
            ...(row.canonical_url ? { canonicalUrl: String(row.canonical_url) } : {}),
            ...(row.canonical_issue ? { canonicalIssue: row.canonical_issue as SitePageObservation['canonicalIssue'] } : {}),
            ...(row.title ? { title: String(row.title) } : {}),
            ...(row.meta_description ? { metaDescription: String(row.meta_description) } : {}),
            h1s: (row.h1s ?? []) as string[],
            ...(row.word_count !== null && row.word_count !== undefined ? { wordCount: Number(row.word_count) } : {}),
            inboundInternalLinks: inbound.get(normalizedUrl) ?? 0,
            outboundInternalLinks: Number(row.outbound_internal_links ?? 0),
            limitationFlags: (row.limitation_flags ?? []) as string[],
        };
    });
}

export async function getSiteInventory(
    admin: SupabaseClient,
    organizationId: string,
    clientId: string,
): Promise<SiteInventoryPayload> {
    const { data: runRows, error: runsError } = await admin.from('site_crawl_runs').select('*')
        .eq('organization_id', organizationId).eq('client_id', clientId).order('created_at', { ascending: false }).limit(10);
    if (runsError) throw runsError;
    const runs = (runRows ?? []).map(rowToSiteCrawlRun);
    const activeRun = runs.find(run => ['queued', 'running', 'paused'].includes(run.status));
    const latestCompletedRun = runs.find(run => run.status === 'completed');
    if (!latestCompletedRun) {
        return {
            ...(activeRun ? { activeRun } : {}),
            previousRuns: runs,
            pages: [],
            health: calculateCrawlHealth({ status: activeRun?.status ?? 'queued', capped: false, observations: [] }),
        };
    }

    const [snapshotsResult, urlsResult, linksResult] = await Promise.all([
        admin.from('site_page_snapshots').select('*').eq('organization_id', organizationId).eq('client_id', clientId).eq('run_id', latestCompletedRun.id).order('observed_at'),
        admin.from('site_page_urls').select('*').eq('organization_id', organizationId).eq('client_id', clientId),
        admin.from('site_link_observations').select('destination_normalized_url').eq('organization_id', organizationId).eq('client_id', clientId).eq('run_id', latestCompletedRun.id),
    ]);
    if (snapshotsResult.error || urlsResult.error || linksResult.error) throw snapshotsResult.error ?? urlsResult.error ?? linksResult.error;
    let pages = rowsToSitePageObservations({
        seedUrl: latestCompletedRun.seedUrl,
        snapshots: snapshotsResult.data ?? [],
        urls: urlsResult.data ?? [],
        links: linksResult.data ?? [],
    });
    const pageIds = pages.map(page => page.pageId);
    if (pageIds.length > 0) {
        const { data: historyRows, error: historyError } = await admin.from('site_page_snapshots')
            .select('id,site_page_id,observed_at,fetch_status,status_code,title')
            .eq('organization_id', organizationId).eq('client_id', clientId).in('site_page_id', pageIds)
            .order('observed_at', { ascending: false }).limit(5000);
        if (historyError) throw historyError;
        pages = pages.map(page => ({
            ...page,
            history: (historyRows ?? []).filter(row => row.site_page_id === page.pageId).map(row => ({
                snapshotId: row.id,
                observedAt: row.observed_at,
                fetchStatus: row.fetch_status,
                ...(row.status_code !== null ? { statusCode: row.status_code } : {}),
                ...(row.title ? { title: row.title } : {}),
            })),
        }));
    }
    const health = calculateCrawlHealth({
        status: 'completed',
        capped: latestCompletedRun.capReached,
        observations: pages.map(page => ({
            pageId: page.pageId,
            url: page.normalizedUrl,
            isHomepage: page.isHomepage,
            sources: page.discoverySources,
            fetchStatus: page.fetchStatus,
            statusCode: page.statusCode,
            contentType: page.contentType,
            redirectCount: page.redirectHops.length,
            robotsAllowed: page.robotsAllowed,
            noindex: page.robotsDirectives.includes('noindex'),
            canonicalIssue: page.canonicalIssue,
            title: page.title,
            h1Count: page.h1s.length,
            inboundInternalLinks: page.inboundInternalLinks,
        })),
    });
    return { ...(activeRun ? { activeRun } : {}), latestCompletedRun, previousRuns: runs, pages, health };
}
