import { matchIdeaToPage, pageKey } from './page-match';
import {
    EMPTY_PERFORMANCE,
    isMoneyPage,
    mainCluster,
    matchedPageVerdict,
    refreshRead,
    refreshReason,
    type PerformanceRead,
    type QueryOnPage,
    type RefreshRead,
    type RefreshSignal,
} from './page-performance';

export interface ReconciliationPage {
    pageId: string;
    normalizedUrl: string;
    title?: string;
    h1s: string[];
    wordCount?: number;
}

export interface GscQueryEvidence {
    query: string;
    pageUrl: string;
    position?: number;
    impressions?: number;
}

export interface RecordInput {
    targetQuery: string;
    title: string;
    suggestedUrl?: string;
    supportingQueries?: string[];
    pageType?: string;
}

export interface ReconcileContext {
    /** Brand and domain tokens that never make a match on their own. */
    ignoreTokens?: ReadonlySet<string>;
    /** Page-grain 90-day periods. */
    performance?: PerformanceRead;
    /** query_page rows over the recent window, keyed by pageKey. */
    pageQueries?: ReadonlyMap<string, QueryOnPage[]>;
    /** Days the pageQueries cover. */
    queryDays?: number;
    /** True when stored Search Console data was read. Without it, page-1 checks are skipped. */
    gscConnected?: boolean;
}

export interface ReconciliationResult {
    action: 'create' | 'replace' | 'improve' | 'keep';
    sitePageId?: string;
    matchedUrl?: string;
    /** Why the existing page needs work, in plain English. */
    refresh?: { reason: string; signals: RefreshSignal[] };
}

/** Refresh signals for one existing page. */
export function pageRefreshRead(
    url: string,
    page: { wordCount?: number | null; pageType?: string | null; targetQuery?: string },
    ctx: ReconcileContext,
): RefreshRead {
    const performance = ctx.performance ?? EMPTY_PERFORMANCE;
    const cluster = mainCluster(ctx.pageQueries?.get(pageKey(url)), page.targetQuery);
    return refreshRead({
        url,
        performance: performance.pages.get(pageKey(url)) ?? null,
        recentDays: performance.recentDays,
        priorDays: performance.priorDays,
        cluster: cluster ? { query: cluster.query, position: cluster.position, impressions: cluster.impressions } : null,
        clusterDays: ctx.queryDays,
        wordCount: page.wordCount ?? null,
        moneyPage: isMoneyPage(url, page.pageType),
    });
}

/**
 * Match an idea to an existing page (see matchIdeaToPage) and decide the action.
 * No match: create. A very short or untitled crawled page: replace.
 * Otherwise the page's Google performance decides (see matchedPageVerdict):
 * improve with a reason, or keep when it is on page 1 with no refresh signal.
 */
export function reconcileRecord(
    record: RecordInput,
    pages: ReconciliationPage[],
    gscQueries: GscQueryEvidence[],
    ctx: ReconcileContext = {},
): ReconciliationResult {
    const match = matchIdeaToPage(record, pages, gscQueries, ctx.ignoreTokens);
    if (!match) return { action: 'create' };

    const page = match.page;
    const base = { sitePageId: page?.pageId, matchedUrl: match.url };
    const read = pageRefreshRead(match.url, {
        wordCount: page?.wordCount,
        pageType: record.pageType,
        targetQuery: record.targetQuery,
    }, ctx);
    const verdict = matchedPageVerdict(read, ctx.gscConnected ?? false);

    if (page && determineAction(page, 0) === 'replace') {
        const reason = refreshReason(read);
        return reason ? { action: 'replace', ...base, refresh: { reason, signals: read.signals } } : { action: 'replace', ...base };
    }
    if (verdict?.action === 'improve') {
        return verdict.reason
            ? { action: 'improve', ...base, refresh: { reason: verdict.reason, signals: verdict.signals } }
            : { action: 'improve', ...base };
    }
    return { action: 'keep', ...base };
}

/** Counts stored in topical_maps.generation_metadata.duplicate_gate. */
export interface DuplicateGateSummary {
    /** Ideas the generator returned. */
    ideas: number;
    /** Ideas that matched a page already on the site, so are not new pages. */
    matched_existing_pages: number;
    already_live: number;
    improve: number;
    replace: number;
    /** Ideas dropped because an earlier idea had the same search or the same page. */
    duplicate_ideas_dropped: number;
    /** Existing pages added as refresh ideas without a matching idea. */
    refresh_pages_added: number;
}

export function duplicateGateSummary(
    results: ReadonlyArray<ReconciliationResult>,
    duplicateIdeasDropped: number,
    refreshPagesAdded: number,
): DuplicateGateSummary {
    return {
        ideas: results.length,
        matched_existing_pages: results.filter(result => Boolean(result.matchedUrl)).length,
        already_live: results.filter(result => result.action === 'keep').length,
        improve: results.filter(result => result.action === 'improve').length,
        replace: results.filter(result => result.action === 'replace').length,
        duplicate_ideas_dropped: duplicateIdeasDropped,
        refresh_pages_added: refreshPagesAdded,
    };
}

/** Record id → refresh reason, from generation_metadata.refresh_reasons. Anything malformed is skipped. */
export function readRefreshReasons(metadata: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!metadata || typeof metadata !== 'object') return out;
    const raw = (metadata as { refresh_reasons?: unknown }).refresh_reasons;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        const reason = value && typeof value === 'object' ? (value as { reason?: unknown }).reason : null;
        if (typeof reason === 'string' && reason.trim()) out[id] = reason.trim();
    }
    return out;
}

export function determineAction(
    page: { wordCount?: number; title?: string; h1s: string[] },
    targetWordCountMin: number,
): 'replace' | 'improve' | 'keep' {
    if (!page.wordCount || page.wordCount < 300) return 'replace';
    if (!page.title && page.h1s.length === 0) return 'replace';
    if (targetWordCountMin > 0 && page.wordCount < targetWordCountMin) return 'improve';
    return 'keep';
}
