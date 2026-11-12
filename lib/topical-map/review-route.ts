/**
 * GET /api/topical-map/review?clientId=…
 *
 * Search Console evidence for the ideas in the client's current topic map.
 * Read-only, so every member of the client's organization (viewers included)
 * can call it. Data comes only from gsc_history_facts (query_page grain).
 */

import { readGrainedFacts } from '../search-reporting/fact-read';
import type { SearchReportingAdmin } from '../search-reporting/load';
import { requireClientOrgMember } from '../security/tenant-authz';
import { createAdminClient } from '../supabase/admin';
import type { CannibalFact } from '../keyword-tracking/cannibalization';
import { normalizeUrl } from '../url/normalize-url';
import { clusterQueryFacts } from './architect-gsc';
import { intentKey } from './page-match';
import { buildReviewEvidence, EMPTY_EVIDENCE, factsFromRows, REVIEW_DAY_WINDOW, type SearchGroup } from './review';

export interface ReviewFacts {
    connected: boolean;
    days: number;
    facts: CannibalFact[];
}

export interface ReviewRouteDeps {
    authorize: (clientId: unknown) => Promise<
        | { ok: true; organizationId: string; clientId: string }
        | { ok: false; status: number; error: string }
    >;
    /** Target searches of the ideas in the client's current (not archived) topic map. */
    loadTargetQueries: (organizationId: string, clientId: string) => Promise<string[]>;
    loadFacts: (organizationId: string, clientId: string) => Promise<ReviewFacts>;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function createReviewHandlers(deps: ReviewRouteDeps) {
    return {
        async get(request: Request) {
            const clientId = new URL(request.url).searchParams.get('clientId');
            const auth = await deps.authorize(clientId);
            if (!auth.ok) return json({ error: auth.error }, auth.status);
            const targetQueries = await deps.loadTargetQueries(auth.organizationId, auth.clientId);
            if (targetQueries.length === 0) return json({ evidence: EMPTY_EVIDENCE });
            const facts = await deps.loadFacts(auth.organizationId, auth.clientId);
            const evidence = buildReviewEvidence({
                targetQueries,
                facts: facts.facts,
                days: facts.days,
                connected: facts.connected,
            });
            return json({
                evidence: evidence.connected ? { ...evidence, groups: searchGroupsFromFacts(facts.facts) } : evidence,
            });
        },
    };
}

/** Search groups sent to the review, enough to leave a top 10 after covered ones are removed. */
export const SEARCH_GROUP_LIMIT = 60;

/**
 * Every search in the loaded facts grouped by intent (the topic map's own
 * clusterQueryFacts), most impressions first, each with the page Google
 * showed most for it.
 */
export function searchGroupsFromFacts(facts: readonly CannibalFact[], limit = SEARCH_GROUP_LIMIT): SearchGroup[] {
    const rows = facts.filter(fact => fact.grain == null || fact.grain === 'query_page');
    const top = clusterQueryFacts(rows as unknown as Record<string, unknown>[]).slice(0, limit);
    const wanted = new Set(top.map(group => group.key));
    const pages = new Map<string, Map<string, { impressions: number; weighted: number }>>();
    for (const fact of rows) {
        if (fact.impressions == null || fact.position == null || fact.impressions <= 0) continue;
        const key = intentKey(fact.query);
        if (!wanted.has(key)) continue;
        const page = normalizeUrl(fact.page);
        if (!page || page.surface !== 'organic') continue;
        const byPage = pages.get(key) ?? new Map<string, { impressions: number; weighted: number }>();
        const stats = byPage.get(page.url) ?? { impressions: 0, weighted: 0 };
        stats.impressions += fact.impressions;
        stats.weighted += fact.position * fact.impressions;
        byPage.set(page.url, stats);
        pages.set(key, byPage);
    }
    return top.map(group => {
        const best = [...(pages.get(group.key) ?? new Map()).entries()]
            .sort((a, b) => b[1].impressions - a[1].impressions || a[0].localeCompare(b[0]))[0];
        return {
            query: group.query,
            variants: group.variants,
            impressions: group.impressions,
            position: Number.isFinite(group.position) ? group.position : null,
            page: best ? best[0] : null,
            pagePosition: best ? best[1].weighted / best[1].impressions : null,
        };
    });
}

function siteUrlOf(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const siteUrl = (value as { site_url?: unknown }).site_url;
    return typeof siteUrl === 'string' && siteUrl.trim() ? siteUrl.trim() : null;
}

/** Same property and day window as the topic map's Search Console context. */
export async function loadReviewFacts(
    admin: SearchReportingAdmin,
    input: { organizationId: string; clientId: string },
): Promise<ReviewFacts> {
    const none: ReviewFacts = { connected: false, days: 0, facts: [] };
    try {
        const integration = await admin.from('client_integrations')
            .select('site_url:credentials->>site_url')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('service', 'gsc')
            .maybeSingle();
        if (integration.error) return none;
        const property = siteUrlOf(integration.data);
        if (!property) return none;

        const days = await admin.from('gsc_history_days')
            .select('id, data_date')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .order('data_date', { ascending: false })
            .range(0, REVIEW_DAY_WINDOW - 1);
        if (days.error) return none;
        const dateOfDay = new Map<string, string>();
        for (const row of (days.data ?? []) as Array<{ id?: unknown; data_date?: unknown }>) {
            if (typeof row.id === 'string' && typeof row.data_date === 'string') dateOfDay.set(row.id, row.data_date.slice(0, 10));
        }
        if (dateOfDay.size === 0) return { connected: true, days: 0, facts: [] };

        const read = await readGrainedFacts(admin, {
            dayIds: [...dateOfDay.keys()],
            grains: ['query_page'],
            columns: 'day_id, query, page, clicks, impressions, position',
        });
        if (read.failedGrains.includes('query_page')) return none;
        return { connected: true, days: dateOfDay.size, facts: factsFromRows(read.rows, dateOfDay) };
    } catch {
        return none;
    }
}

export function reviewRouteDeps(): ReviewRouteDeps {
    return {
        authorize: async clientId => {
            const auth = await requireClientOrgMember(clientId);
            if (!auth.ok) return auth;
            return { ok: true, organizationId: auth.organizationId, clientId: auth.clientId };
        },
        loadTargetQueries: async (organizationId, clientId) => {
            const admin = createAdminClient();
            const { data: map } = await admin
                .from('topical_maps')
                .select('id')
                .eq('organization_id', organizationId)
                .eq('client_id', clientId)
                .neq('status', 'archived')
                .order('version', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (!map?.id) return [];
            const { data } = await admin
                .from('topical_map_records')
                .select('target_query')
                .eq('map_id', map.id)
                .eq('organization_id', organizationId);
            return (data ?? [])
                .map(row => (typeof row.target_query === 'string' ? row.target_query : ''))
                .filter(query => query.trim().length > 0);
        },
        loadFacts: (organizationId, clientId) => loadReviewFacts(
            createAdminClient() as unknown as SearchReportingAdmin,
            { organizationId, clientId },
        ),
    };
}
