/**
 * Opportunity scores are computed when the backlog is read. They are not stored.
 *
 * Est. clicks comes from this property's own CTR at each rounded position,
 * summed from stored query-page rows. A position bucket is used only when it
 * has at least MIN_CURVE_BUCKET_IMPRESSIONS impressions and its clicks do not
 * exceed its impressions. The estimate is null unless the curve and the row
 * each have at least MIN_CTR_CURVE_DAYS distinct observed days, a better
 * position exists on that curve, and the incremental clicks are zero or
 * positive. A missing input stays null. It is never replaced with a global CTR.
 *
 * Improve ranking, capture demand, and Search Console overlap are omitted
 * when `evidenceIsComplete` is false for the query grain. Page rollups are
 * ignored when the page grain is incomplete or expanded evidence is absent.
 * Crawl findings still score from the crawl. Their est. clicks stay null
 * when the curve cannot be built.
 */

import {
    evidenceIsComplete,
    filterOverlapCandidates,
    filterPageCandidates,
    filterRankingCandidates,
    filterVisibilityCandidates,
    isExcludedPage,
    type Candidate,
    type HistoryDay,
    type OverlapCandidate,
    type PageCandidate,
} from '../gsc/insights';
import type { CannibalizationReport } from '../keyword-tracking/cannibalization';
import { normalizeTrackerQuery } from '../search-reporting/tracker';
import type { SearchEvidenceCategory, SearchInvestigationStatus, SiteCrawlFetchStatus, SiteDiscoverySource } from '../types';
import { normalizeUrl } from '../url/normalize-url';

/** Distinct saved days required before a CTR-by-position curve can estimate clicks. */
export const MIN_CTR_CURVE_DAYS = 7;

/** Impressions a position bucket needs before its CTR is used. Below this, the rate is too thin to estimate from. */
export const MIN_CURVE_BUCKET_IMPRESSIONS = 100;

/** Indexable pages under this crawled word count are thin. A missing count is not thin. */
export const THIN_WORD_COUNT = 300;

export const OPPORTUNITY_ACTIONS = [
    'rewrite_title',
    'add_meta_description',
    'add_h1',
    'improve_ranking',
    'capture_demand',
    'expand_thin_content',
    'add_internal_links',
    'resolve_overlap',
] as const;

export type OpportunityActionType = (typeof OPPORTUNITY_ACTIONS)[number];
export type OpportunityImpact = 'high' | 'medium' | 'low';
export type OpportunityEffort = 'low' | 'medium' | 'high';
export type OpportunityQueue = 'active' | 'completed' | 'dismissed';

export interface OpportunityCrawlPage {
    url: string;
    isHomepage: boolean;
    discoverySources: SiteDiscoverySource[];
    fetchStatus: SiteCrawlFetchStatus;
    statusCode?: number;
    contentType?: string;
    robotsAllowed?: boolean;
    robotsDirectives: string[];
    title?: string;
    metaDescription?: string;
    h1s: string[];
    wordCount?: number;
    inboundInternalLinks: number;
}

export interface OpportunityCurveRow {
    dayId: string;
    position: number;
    clicks: number;
    impressions: number;
}

export interface OpportunityInvestigationRef {
    category: SearchEvidenceCategory;
    evidence: Candidate | PageCandidate | OverlapCandidate;
}

export interface ScoredOpportunity {
    id: string;
    actionType: OpportunityActionType;
    actionLabel: string;
    /** Integer 0–100. Rows with incomplete evidence are omitted instead of scored. */
    score: number;
    impact: OpportunityImpact | null;
    effort: OpportunityEffort;
    estClicks: number | null;
    page: string | null;
    query: string | null;
    evidence: string;
    /** Set when the row can be saved with the existing investigation snapshot. */
    investigation: OpportunityInvestigationRef | null;
}

export interface ScoreOpportunitiesInput {
    days: HistoryDay[];
    missingDates: string[];
    expandedEvidenceAvailable: boolean;
    queryPageRollups: Candidate[];
    pageRollups: PageCandidate[];
    visibilityRollups: Candidate[];
    overlapRollups: OverlapCandidate[];
    /** Stored query-page rows. Ignored when `gscRowsTruncated` is set. */
    gscRows: OpportunityCurveRow[];
    gscRowsTruncated: boolean;
    brand: string;
    pages: OpportunityCrawlPage[];
    /** Null when keyword tracking did not measure a window. Unmeasured reports add no rows. */
    cannibalization: CannibalizationReport | null;
}

const ACTION_LABEL: Record<OpportunityActionType, string> = {
    rewrite_title: 'Rewrite title',
    add_meta_description: 'Add meta description',
    add_h1: 'Add H1',
    improve_ranking: 'Improve ranking',
    capture_demand: 'Capture demand',
    expand_thin_content: 'Expand thin content',
    add_internal_links: 'Add internal links',
    resolve_overlap: 'Resolve overlap',
};

const EFFORT: Record<OpportunityActionType, OpportunityEffort> = {
    rewrite_title: 'low',
    add_meta_description: 'low',
    add_h1: 'low',
    improve_ranking: 'medium',
    capture_demand: 'high',
    expand_thin_content: 'high',
    add_internal_links: 'medium',
    resolve_overlap: 'medium',
};

/** Priority weights. These order work. They are not measured clicks. */
const PRIORITY: Record<OpportunityActionType, number> = {
    resolve_overlap: 36,
    improve_ranking: 30,
    rewrite_title: 28,
    capture_demand: 22,
    expand_thin_content: 20,
    add_internal_links: 18,
    add_h1: 16,
    add_meta_description: 14,
};

const EM_DASH = '—';
const numberFormat = new Intl.NumberFormat('en-US');

interface Draft extends ScoredOpportunity {
    impressions: number | null;
}

interface Measured {
    evidence: string;
    impressions: number | null;
    clicks: number | null;
    position: number | null;
    observedDays: number | null;
}

export function formatOpportunityNumber(value: number | null | undefined): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
    return numberFormat.format(value);
}

export function formatOpportunityLabel(value: string | null | undefined): string {
    const trimmed = value?.trim();
    if (!trimmed) return EM_DASH;
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function formatOpportunityText(value: string | null | undefined): string {
    const trimmed = value?.trim();
    return trimmed ? trimmed : EM_DASH;
}

/** Active is an open investigation or a row that has no decision yet. */
export function opportunityQueue(status: SearchInvestigationStatus | null | undefined): OpportunityQueue {
    if (status === 'task_created') return 'completed';
    if (status === 'dismissed') return 'dismissed';
    return 'active';
}

function finiteNonNegative(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeTitle(value: string | undefined): string {
    return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function pageIdentity(url: string): string | null {
    const normalized = normalizeUrl(url);
    if (!normalized || normalized.surface !== 'organic') return null;
    return normalized.url;
}

function indexable(page: OpportunityCrawlPage): boolean {
    const html = page.contentType?.toLowerCase().includes('html') === true;
    const fetched = page.fetchStatus === 'success' || page.fetchStatus === 'js_unresolved';
    const status = page.statusCode ?? 0;
    return fetched
        && html
        && page.robotsAllowed !== false
        && !page.robotsDirectives.includes('noindex')
        && status >= 200
        && status < 300
        && !isExcludedPage(page.url);
}

function representedInSearch(page: OpportunityCrawlPage): boolean {
    return page.discoverySources.includes('sitemap') || page.discoverySources.includes('gsc');
}

function impactOf(impressions: number | null): OpportunityImpact | null {
    if (impressions == null) return null;
    if (impressions >= 1000) return 'high';
    if (impressions >= 250) return 'medium';
    return 'low';
}

function demandPoints(impressions: number | null): number {
    if (impressions == null || impressions <= 0) return 0;
    return Math.min(40, Math.round(10 * Math.log10(impressions)));
}

function scoreFor(
    action: OpportunityActionType,
    input: { impressions: number | null; position: number | null; wordCount?: number | null; urlCount?: number },
): number {
    let proximity = 0;
    if (input.position != null && Number.isFinite(input.position)) {
        if (action === 'improve_ranking' && input.position >= 4 && input.position <= 20) {
            proximity = Math.round((20 * (20 - input.position)) / 16);
        } else if (action === 'capture_demand' && input.position > 20 && input.position <= 50) {
            proximity = Math.round((10 * (50 - input.position)) / 30);
        }
    }
    const thin = action === 'expand_thin_content' && input.wordCount != null && input.wordCount < THIN_WORD_COUNT
        ? Math.round(20 * (1 - input.wordCount / THIN_WORD_COUNT))
        : 0;
    const overlap = action === 'resolve_overlap'
        ? Math.min(15, Math.max(0, (input.urlCount ?? 0) - 1) * 5)
        : 0;
    return Math.max(0, Math.min(100, PRIORITY[action] + demandPoints(input.impressions) + proximity + thin + overlap));
}

function buildCurve(
    rows: OpportunityCurveRow[],
    days: HistoryDay[],
    missingDates: string[],
    truncated: boolean,
): Map<number, number> | null {
    if (truncated || !evidenceIsComplete(days, missingDates, 'query')) return null;
    const dayIds = new Set<string>();
    const buckets = new Map<number, { clicks: number; impressions: number }>();
    for (const row of rows) {
        if (!row.dayId || !Number.isInteger(row.clicks) || !Number.isInteger(row.impressions)) continue;
        if (row.impressions <= 0 || row.clicks < 0 || row.clicks > row.impressions || !Number.isFinite(row.position)) continue;
        dayIds.add(row.dayId);
        const bucket = Math.round(row.position);
        if (bucket < 1 || bucket > 50) continue;
        const current = buckets.get(bucket) ?? { clicks: 0, impressions: 0 };
        current.clicks += row.clicks;
        current.impressions += row.impressions;
        buckets.set(bucket, current);
    }
    if (dayIds.size < MIN_CTR_CURVE_DAYS) return null;
    const curve = new Map<number, number>();
    for (const [bucket, totals] of buckets) {
        if (totals.impressions < MIN_CURVE_BUCKET_IMPRESSIONS || totals.clicks > totals.impressions) continue;
        curve.set(bucket, totals.clicks / totals.impressions);
    }
    return curve;
}

function estimateClicks(
    curve: Map<number, number> | null,
    input: { position: number | null; impressions: number | null; clicks: number | null; observedDays: number | null },
): number | null {
    if (!curve) return null;
    if (input.observedDays == null || input.observedDays < MIN_CTR_CURVE_DAYS) return null;
    if (!finiteNonNegative(input.impressions) || input.impressions <= 0 || !finiteNonNegative(input.clicks)) return null;
    if (!Number.isInteger(input.clicks) || input.position == null || !Number.isFinite(input.position)) return null;
    const current = Math.round(input.position);
    let target: number | null = null;
    for (const bucket of curve.keys()) {
        if (bucket < current && (target == null || bucket > target)) target = bucket;
    }
    if (target == null) return null;
    const ctr = curve.get(target);
    if (ctr == null) return null;
    const incremental = input.impressions * ctr - input.clicks;
    if (!Number.isFinite(incremental) || incremental < 0) return null;
    return Math.round(incremental);
}

function gscSentence(query: string | null, position: number, impressions: number, clicks: number, observedDays: number): string {
    const subject = query ? `“${query}”` : 'This URL';
    return `${subject} averaged position ${position.toFixed(1)} over ${observedDays} saved days, with ${numberFormat.format(impressions)} impressions and ${numberFormat.format(clicks)} clicks.`;
}

function attach(evidence: string, metrics: PageCandidate | undefined, fetchStatus: SiteCrawlFetchStatus): Measured {
    const js = fetchStatus === 'js_unresolved' ? ' The crawl did not run JavaScript.' : '';
    if (!metrics) {
        return { evidence: `${evidence}${js}`, impressions: null, clicks: null, position: null, observedDays: null };
    }
    const search = ` Search Console recorded ${numberFormat.format(metrics.impressions)} impressions at average position ${metrics.position.toFixed(1)}.`;
    return {
        evidence: `${evidence}${search}${js}`,
        impressions: metrics.impressions,
        clicks: metrics.clicks,
        position: metrics.position,
        observedDays: metrics.observedDays,
    };
}

function rankingShape(row: Candidate, band: 'near' | 'deep'): boolean {
    if (row.impressions < 100 || row.observedDays < 3 || !Number.isFinite(row.position)) return false;
    return band === 'near' ? row.position >= 4 && row.position <= 20 : row.position > 20 && row.position <= 50;
}

function draftId(action: OpportunityActionType, query: string | null, page: string | null): string {
    return [action, query ?? '', page ?? ''].join('\u001f');
}

function indexPageRollups(rows: PageCandidate[]): Map<string, PageCandidate> {
    const map = new Map<string, PageCandidate>();
    for (const row of rows) {
        const key = pageIdentity(row.page);
        if (!key || map.has(key)) continue;
        map.set(key, row);
    }
    return map;
}

export function scoreOpportunities(input: ScoreOpportunitiesInput): ScoredOpportunity[] {
    const queryReady = evidenceIsComplete(input.days, input.missingDates, 'query');
    const pageReady = input.expandedEvidenceAvailable && evidenceIsComplete(input.days, input.missingDates, 'page');
    const curve = buildCurve(input.gscRows, input.days, input.missingDates, input.gscRowsTruncated);
    const pageMetrics = pageReady ? indexPageRollups(filterPageCandidates(input.pageRollups)) : new Map<string, PageCandidate>();
    const drafts: Draft[] = [];
    const consumedQueries = new Set<string>();

    if (queryReady) {
        for (const candidate of filterRankingCandidates(input.queryPageRollups, input.brand)) {
            if (!rankingShape(candidate, 'near')) continue;
            drafts.push({
                id: draftId('improve_ranking', candidate.query, candidate.page),
                actionType: 'improve_ranking',
                actionLabel: ACTION_LABEL.improve_ranking,
                score: scoreFor('improve_ranking', { impressions: candidate.impressions, position: candidate.position }),
                impact: impactOf(candidate.impressions),
                effort: EFFORT.improve_ranking,
                estClicks: estimateClicks(curve, candidate),
                page: candidate.page,
                query: candidate.query,
                evidence: gscSentence(candidate.query, candidate.position, candidate.impressions, candidate.clicks, candidate.observedDays),
                investigation: { category: 'near_page_one', evidence: candidate },
                impressions: candidate.impressions,
            });
        }
        if (input.expandedEvidenceAvailable) {
            for (const candidate of filterVisibilityCandidates(input.visibilityRollups, input.brand)) {
                if (!rankingShape(candidate, 'deep')) continue;
                drafts.push({
                    id: draftId('capture_demand', candidate.query, candidate.page),
                    actionType: 'capture_demand',
                    actionLabel: ACTION_LABEL.capture_demand,
                    score: scoreFor('capture_demand', { impressions: candidate.impressions, position: candidate.position }),
                    impact: impactOf(candidate.impressions),
                    effort: EFFORT.capture_demand,
                    estClicks: estimateClicks(curve, candidate),
                    page: candidate.page,
                    query: candidate.query,
                    evidence: gscSentence(candidate.query, candidate.position, candidate.impressions, candidate.clicks, candidate.observedDays),
                    investigation: { category: 'deeper_visibility', evidence: candidate },
                    impressions: candidate.impressions,
                });
            }
            for (const overlap of filterOverlapCandidates(input.overlapRollups, input.brand)) {
                const key = normalizeTrackerQuery(overlap.query);
                consumedQueries.add(key);
                const top = overlap.pages[0];
                const cannibal = measuredKeyword(input.cannibalization, key);
                const extra = cannibal ? ` Tracked-keyword cannibalization lists ${cannibal.urls.length} URLs for the same query.` : '';
                drafts.push({
                    id: draftId('resolve_overlap', overlap.query, top?.page ?? null),
                    actionType: 'resolve_overlap',
                    actionLabel: ACTION_LABEL.resolve_overlap,
                    score: scoreFor('resolve_overlap', { impressions: overlap.impressions, position: overlap.position, urlCount: overlap.pages.length }),
                    impact: impactOf(overlap.impressions),
                    effort: EFFORT.resolve_overlap,
                    estClicks: estimateClicks(curve, overlap),
                    page: top?.page ?? null,
                    query: overlap.query,
                    evidence: `Query “${overlap.query}” was observed on ${overlap.pages.length} URLs, with ${numberFormat.format(overlap.impressions)} combined impressions.${extra}`,
                    investigation: { category: 'overlapping_urls', evidence: overlap },
                    impressions: overlap.impressions,
                });
            }
        }
    }

    if (input.cannibalization && input.cannibalization.health != null && input.cannibalization.affected != null) {
        for (const keyword of input.cannibalization.keywords) {
            const key = normalizeTrackerQuery(keyword.keyword);
            if (!key || consumedQueries.has(key) || keyword.urls.length < 2) continue;
            const impressions = keyword.urls.reduce((sum, url) => sum + url.impressions, 0);
            if (impressions <= 0) continue;
            const clicksKnown = keyword.urls.every(url => finiteNonNegative(url.clicks) && Number.isInteger(url.clicks));
            const clicks = clicksKnown ? keyword.urls.reduce((sum, url) => sum + (url.clicks as number), 0) : null;
            const positionKnown = keyword.urls.every(url => finiteNonNegative(url.avgPosition));
            const position = positionKnown
                ? keyword.urls.reduce((sum, url) => sum + (url.avgPosition as number) * url.impressions, 0) / impressions
                : null;
            const top = keyword.urls[0];
            drafts.push({
                id: draftId('resolve_overlap', keyword.keyword, top?.url ?? null),
                actionType: 'resolve_overlap',
                actionLabel: ACTION_LABEL.resolve_overlap,
                score: scoreFor('resolve_overlap', { impressions, position, urlCount: keyword.urls.length }),
                impact: impactOf(impressions),
                effort: EFFORT.resolve_overlap,
                estClicks: estimateClicks(curve, { position, impressions, clicks, observedDays: null }),
                page: top?.url ?? null,
                query: keyword.keyword,
                evidence: `Tracked keyword “${keyword.keyword}” has impressions on ${keyword.urls.length} URLs (${numberFormat.format(impressions)} combined). Multiple URLs are not proof the pages should be consolidated.`,
                investigation: null,
                impressions,
            });
        }
    }

    const eligible = input.pages.filter(indexable);
    const titleCounts = new Map<string, number>();
    for (const page of eligible) {
        const title = normalizeTitle(page.title).toLowerCase();
        if (!title) continue;
        titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
    }
    for (const page of eligible) {
        const pageKey = pageIdentity(page.url);
        const metrics = pageKey ? pageMetrics.get(pageKey) : undefined;
        const title = normalizeTitle(page.title);
        const titleKey = title.toLowerCase();
        if (!title) {
            drafts.push(crawlDraft('rewrite_title', page, 'No title was observed on this indexable page.', metrics, curve));
        } else if ((titleCounts.get(titleKey) ?? 0) > 1) {
            drafts.push(crawlDraft(
                'rewrite_title',
                page,
                `Title “${title}” is shared by ${titleCounts.get(titleKey)} indexable pages.`,
                metrics,
                curve,
            ));
        }
        if (!page.metaDescription?.trim()) {
            drafts.push(crawlDraft('add_meta_description', page, 'No meta description was observed on this indexable page.', metrics, curve));
        }
        if (Array.isArray(page.h1s) && page.h1s.length === 0) {
            drafts.push(crawlDraft('add_h1', page, 'No H1 was observed on this indexable page.', metrics, curve));
        }
        if (page.wordCount != null && Number.isFinite(page.wordCount) && page.wordCount < THIN_WORD_COUNT) {
            drafts.push(crawlDraft(
                'expand_thin_content',
                page,
                `Crawled word count is ${numberFormat.format(page.wordCount)}, under the ${THIN_WORD_COUNT}-word thin-content line.`,
                metrics,
                curve,
                page.wordCount,
            ));
        }
        if (!page.isHomepage && representedInSearch(page) && page.inboundInternalLinks === 0) {
            drafts.push(crawlDraft(
                'add_internal_links',
                page,
                'No inbound internal link was observed. The page is in the sitemap or Search Console.',
                metrics,
                curve,
            ));
        }
    }

    drafts.sort((a, b) => b.score - a.score
        || (b.impressions ?? -1) - (a.impressions ?? -1)
        || a.actionLabel.localeCompare(b.actionLabel)
        || (a.page ?? '').localeCompare(b.page ?? '')
        || (a.query ?? '').localeCompare(b.query ?? ''));

    return drafts.map(draft => ({
        id: draft.id,
        actionType: draft.actionType,
        actionLabel: draft.actionLabel,
        score: draft.score,
        impact: draft.impact,
        effort: draft.effort,
        estClicks: draft.estClicks,
        page: draft.page,
        query: draft.query,
        evidence: draft.evidence,
        investigation: draft.investigation,
    }));
}

function measuredKeyword(report: CannibalizationReport | null, key: string) {
    if (!report || report.health == null || report.affected == null) return undefined;
    return report.keywords.find(keyword => normalizeTrackerQuery(keyword.keyword) === key);
}

function crawlDraft(
    action: OpportunityActionType,
    page: OpportunityCrawlPage,
    evidence: string,
    metrics: PageCandidate | undefined,
    curve: Map<number, number> | null,
    wordCount?: number,
): Draft {
    const measured = attach(evidence, metrics, page.fetchStatus);
    return {
        id: draftId(action, null, page.url),
        actionType: action,
        actionLabel: ACTION_LABEL[action],
        score: scoreFor(action, {
            impressions: measured.impressions,
            position: measured.position,
            wordCount,
        }),
        impact: impactOf(measured.impressions),
        effort: EFFORT[action],
        estClicks: estimateClicks(curve, measured),
        page: page.url,
        query: null,
        evidence: measured.evidence,
        investigation: null,
        impressions: measured.impressions,
    };
}
