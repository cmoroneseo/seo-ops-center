/**
 * Review topic ideas: the step after a topic map is generated and before its
 * ideas join the content plan.
 *
 * Every number here comes from the client's own Google Search Console data
 * (gsc_history_facts, query_page grain). An idea with no Search Console match
 * has no score and says so. Nothing is estimated or filled in.
 */

import { keywordCannibalization, type CannibalFact } from '../keyword-tracking/cannibalization';
import { normalizeTrackerQuery } from '../search-reporting/tracker';
import { normalizeUrl } from '../url/normalize-url';
import { contentPlanLimit, countsTowardPlan, type PlanCountable } from '../content/quota';
import { displayedProductionStatus, readWorkMonth, workMonthLabel } from './production';
import type { MapRecordAction, MapRecordStatus, ProductionStatus } from '../types';

// ─── Search Console evidence ────────────────────────────────────────────────

/** One search, rolled up over the stored window. */
export interface QueryEvidence {
    /** Normalized search text (trimmed, lower case, single spaces). */
    query: string;
    impressions: number;
    clicks: number;
    /** Impression-weighted average position. Null when it cannot be weighted. */
    position: number | null;
    /** Your pages Google showed for this search, most impressions first. */
    pages: Array<{ url: string; impressions: number; position: number | null }>;
    /** True when two or more of your pages were each shown for this search. */
    competing: boolean;
}

export interface ReviewEvidence {
    /** False when Search Console is not connected or could not be read. */
    connected: boolean;
    /** Stored days the numbers cover. */
    days: number;
    queries: QueryEvidence[];
}

export const EMPTY_EVIDENCE: ReviewEvidence = { connected: false, days: 0, queries: [] };

/** Stored days read for the review, matching the topic map's Search Console window. */
export const REVIEW_DAY_WINDOW = 28;

function finite(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Turn raw query_page rows into the shape the cannibalization check reads. */
export function factsFromRows(
    rows: readonly Record<string, unknown>[],
    dateOfDay: ReadonlyMap<string, string>,
): CannibalFact[] {
    const facts: CannibalFact[] = [];
    for (const row of rows) {
        const date = typeof row.day_id === 'string' ? dateOfDay.get(row.day_id) : undefined;
        if (!date || typeof row.query !== 'string' || typeof row.page !== 'string') continue;
        facts.push({
            date,
            query: row.query,
            page: row.page,
            clicks: finite(row.clicks),
            impressions: finite(row.impressions),
            position: finite(row.position),
            grain: 'query_page',
        });
    }
    return facts;
}

/**
 * Roll the facts up for the searches the map's ideas target. Searches no idea
 * targets are dropped. Competing pages come from the same cannibalization rule
 * the Rankings tab uses (two or more of your pages each shown for one search).
 */
export function buildReviewEvidence(input: {
    targetQueries: readonly string[];
    facts: readonly CannibalFact[];
    days: number;
    connected: boolean;
}): ReviewEvidence {
    if (!input.connected) return EMPTY_EVIDENCE;
    const wanted = new Set(input.targetQueries.map(normalizeTrackerQuery).filter(Boolean));
    const totals = new Map<string, {
        impressions: number;
        clicks: number;
        weighted: number;
        weightable: boolean;
        pages: Map<string, { impressions: number; weighted: number; weightable: boolean }>;
    }>();
    let start = '';
    let end = '';
    for (const fact of input.facts) {
        if (fact.grain != null && fact.grain !== 'query_page') continue;
        const key = normalizeTrackerQuery(fact.query);
        if (!wanted.has(key)) continue;
        if (fact.impressions == null) continue;
        if (!start || fact.date < start) start = fact.date;
        if (!end || fact.date > end) end = fact.date;
        const current = totals.get(key) ?? { impressions: 0, clicks: 0, weighted: 0, weightable: true, pages: new Map() };
        current.impressions += fact.impressions;
        current.clicks += fact.clicks ?? 0;
        if (fact.position == null) current.weightable = false;
        else current.weighted += fact.position * fact.impressions;
        const page = normalizeUrl(fact.page);
        if (page && page.surface === 'organic') {
            const stats = current.pages.get(page.url) ?? { impressions: 0, weighted: 0, weightable: true };
            stats.impressions += fact.impressions;
            if (fact.position == null) stats.weightable = false;
            else stats.weighted += fact.position * fact.impressions;
            current.pages.set(page.url, stats);
        }
        totals.set(key, current);
    }

    const keys = [...totals.keys()];
    const report = start && end
        ? keywordCannibalization({
            keywords: keys.map(key => ({ id: key, keyword: key })),
            facts: input.facts,
            current: { start, end },
            measured: true,
        })
        : null;
    const competing = new Set(report?.keywords.map(keyword => keyword.id) ?? []);

    const queries: QueryEvidence[] = [];
    for (const [query, total] of totals) {
        if (total.impressions <= 0) continue;
        queries.push({
            query,
            impressions: total.impressions,
            clicks: total.clicks,
            position: total.weightable && total.impressions > 0 ? total.weighted / total.impressions : null,
            pages: [...total.pages]
                .filter(([, stats]) => stats.impressions > 0)
                .map(([url, stats]) => ({
                    url,
                    impressions: stats.impressions,
                    position: stats.weightable ? stats.weighted / stats.impressions : null,
                }))
                .sort((a, b) => b.impressions - a.impressions || a.url.localeCompare(b.url)),
            competing: competing.has(query),
        });
    }
    queries.sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));
    return { connected: true, days: Math.max(0, Math.floor(input.days)), queries };
}

export function evidenceFor(evidence: ReviewEvidence, targetQuery: string): QueryEvidence | null {
    const key = normalizeTrackerQuery(targetQuery ?? '');
    if (!key) return null;
    return evidence.queries.find(query => query.query === key) ?? null;
}

// ─── Priority score ─────────────────────────────────────────────────────────

/** Positions 8 to 20 (bottom of page 1 and page 2) count as a quick win. */
export const QUICK_WIN_MIN = 8;
export const QUICK_WIN_MAX = 20;

export interface ScoreInput {
    action: MapRecordAction;
    evidence: QueryEvidence | null;
    /** A page on the site already matched to this idea (reconcile's matched_url). */
    matchedUrl?: string | null;
}

export interface IdeaScore {
    /** 0 to 100. Null when Search Console has nothing for this search. */
    score: number | null;
    quickWin: boolean;
}

export function roundedPosition(position: number | null | undefined): number | null {
    if (position == null || !Number.isFinite(position) || position <= 0) return null;
    return Math.max(1, Math.round(position));
}

export function isQuickWin(position: number | null | undefined): boolean {
    const spot = roundedPosition(position);
    return spot != null && spot >= QUICK_WIN_MIN && spot <= QUICK_WIN_MAX;
}

function positionPoints(position: number | null): number {
    const spot = roundedPosition(position);
    if (spot == null) return 0;
    if (spot >= QUICK_WIN_MIN && spot <= QUICK_WIN_MAX) return 30;
    if (spot < 4) return 5;
    if (spot < QUICK_WIN_MIN) return 15;
    if (spot <= 50) return 10;
    return 0;
}

/**
 * The page on the site that already covers this search: the page the map
 * matched, or one of your pages Google already shows in spots 1 to 7. A page
 * further down (a quick win or lower) does not cover the search yet.
 */
export function coveringPage(input: { matchedUrl?: string | null; evidence: QueryEvidence | null }): string | null {
    const matched = input.matchedUrl?.trim();
    if (matched) return matched;
    const ranking = input.evidence?.pages.find(page => {
        const spot = roundedPosition(page.position);
        return spot != null && spot < QUICK_WIN_MIN;
    });
    return ranking?.url ?? null;
}

export function hasExistingPage(input: ScoreInput): boolean {
    return coveringPage(input) != null;
}

/**
 * Priority from real Search Console data only.
 * - Demand: up to 60 points on a log scale of impressions (10 → 16, 100 → 30, 1,000 → 45, 10,000 → 60).
 * - Position: 30 points for a quick win (spots 8 to 20), 15 for spots 4 to 7,
 *   10 for spots 21 to 50, 5 when already in the top 3.
 * - Existing page: a new page for a search one of your pages already covers
 *   (see coveringPage) loses 25 points, because it would compete with that page. An improve or replace
 *   idea gains 10, because the existing page is the one being worked on.
 * No Search Console match means no score, never a guess.
 */
export function priorityScore(input: ScoreInput): IdeaScore {
    const evidence = input.evidence;
    if (!evidence || !(evidence.impressions > 0)) return { score: null, quickWin: false };
    const demand = Math.min(60, Math.round(15 * Math.log10(evidence.impressions + 1)));
    let score = demand + positionPoints(evidence.position);
    if (hasExistingPage(input)) {
        if (input.action === 'create') score -= 25;
        else if (input.action === 'improve' || input.action === 'replace') score += 10;
    }
    return { score: Math.max(0, Math.min(100, score)), quickWin: isQuickWin(evidence.position) };
}

export type PriorityBand = 'High' | 'Medium' | 'Low';

export function priorityBand(score: number | null): PriorityBand | null {
    if (score == null) return null;
    if (score >= 60) return 'High';
    if (score >= 30) return 'Medium';
    return 'Low';
}

export const NO_DATA_REASON = 'New topic, no Google data yet';

export function formatCount(value: number): string {
    return Math.round(value).toLocaleString('en-US');
}

/** "sitting on page 2" for spot 14. */
export function positionPhrase(position: number | null | undefined): string | null {
    const spot = roundedPosition(position);
    if (spot == null) return null;
    if (spot <= 3) return 'already near the top of page 1';
    if (spot < QUICK_WIN_MIN) return 'already on page 1';
    if (spot <= 10) return 'at the bottom of page 1';
    if (spot <= 20) return 'sitting on page 2';
    if (spot <= 30) return 'on page 3';
    return 'past page 3';
}

/** "a month" for a full stored window, otherwise the real number of days. */
export function windowPhrase(days: number): string {
    if (days >= REVIEW_DAY_WINDOW) return 'a month';
    if (days === 1) return 'in the last day';
    return `in the last ${Math.max(0, Math.floor(days))} days`;
}

/**
 * Plain-English reason for the score, for example
 * "Already shows up in 420 Google searches a month, sitting on page 2: a quick win".
 */
export function priorityReason(evidence: QueryEvidence | null, days: number): string {
    if (!evidence || !(evidence.impressions > 0)) return NO_DATA_REASON;
    const searches = evidence.impressions === 1 ? 'Google search' : 'Google searches';
    const base = `Already shows up in ${formatCount(evidence.impressions)} ${searches} ${windowPhrase(days)}`;
    const where = positionPhrase(evidence.position);
    if (!where) return base;
    return `${base}, ${where}${isQuickWin(evidence.position) ? ': a quick win' : ''}`;
}

/** "Spot 14" under the search count. */
export function positionLabel(position: number | null | undefined): string | null {
    const spot = roundedPosition(position);
    return spot == null ? null : `Spot ${spot} in Google`;
}

// ─── Duplicate page warning ─────────────────────────────────────────────────

/** "/x" for https://example.com/x. Anything unreadable is shown as given. */
export function pagePath(url: string): string {
    try {
        const parsed = new URL(url);
        const path = `${parsed.pathname}${parsed.search}`;
        return path || '/';
    } catch {
        return url;
    }
}

export interface DuplicateCheckIdea {
    id: string;
    title: string;
    targetQuery: string;
    action: MapRecordAction;
    status: MapRecordStatus;
    matchedUrl?: string | null;
}

/**
 * Warn before approving a new page for a search an existing page already
 * covers. Improve and replace ideas work on that page on purpose, so they get
 * no warning. Order: pages already competing in Google, the page the map
 * matched, the page Google shows for the search, then another idea in this map
 * that targets the same search.
 */
export function duplicateWarning(
    idea: DuplicateCheckIdea,
    evidence: QueryEvidence | null,
    others: ReadonlyArray<DuplicateCheckIdea> = [],
): string | null {
    if (idea.action !== 'create') return null;
    if (evidence?.competing && evidence.pages.length >= 2) {
        const [first, second] = evidence.pages;
        return `Google already shows ${evidence.pages.length} of your pages for this search, ${pagePath(first.url)} and ${pagePath(second.url)}. Approving may add another page competing for the same search.`;
    }
    const existing = coveringPage({ matchedUrl: idea.matchedUrl, evidence });
    if (existing) {
        return `Your page ${pagePath(existing)} already covers this. Approving may create two pages competing for the same search.`;
    }
    const key = normalizeTrackerQuery(idea.targetQuery ?? '');
    if (!key) return null;
    const twin = others.find(other =>
        other.id !== idea.id
        && other.status !== 'declined'
        && normalizeTrackerQuery(other.targetQuery ?? '') === key,
    );
    if (twin) {
        return `Another idea, “${twin.title}”, already targets this search. Approving both may create two pages competing for the same search.`;
    }
    return null;
}

/** Improve and replace ideas say which page they change. */
export function existingPageNote(idea: { action: MapRecordAction; matchedUrl?: string | null }): string | null {
    if ((idea.action !== 'improve' && idea.action !== 'replace') || !idea.matchedUrl?.trim()) return null;
    return idea.action === 'improve'
        ? `Improves your page ${pagePath(idea.matchedUrl)} instead of adding a new one.`
        : `Replaces your page ${pagePath(idea.matchedUrl)} instead of adding a new one.`;
}

// ─── Review rows ────────────────────────────────────────────────────────────

export type ReviewStatus = 'waiting' | 'approved' | 'declined' | 'live';

export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
    waiting: 'Waiting for review',
    approved: 'Approved',
    declined: 'Declined',
    live: 'Already live',
};

export interface ReviewIdeaInput extends DuplicateCheckIdea, Omit<PlanCountable, 'action' | 'status' | 'matchedUrl'> {
    siloId: string;
    parentRecordId?: string | null;
    buildPhase: number;
    sortOrder: number;
    productionStatus?: ProductionStatus | null;
    workMonth?: string | null;
}

export function reviewStatus(idea: {
    status: MapRecordStatus;
    productionStatus?: ProductionStatus | null;
    action: MapRecordAction;
    matchedUrl?: string | null;
}): ReviewStatus {
    const shown = displayedProductionStatus(idea);
    if (shown === 'already_live') return 'live';
    if (idea.status === 'approved') return 'approved';
    if (idea.status === 'declined') return 'declined';
    return 'waiting';
}

export const PHASE_LABEL: Record<number, string> = { 1: 'Foundation', 2: 'Growth', 3: 'Scale' };

export function phaseLabel(phase: number): string {
    return PHASE_LABEL[phase] ?? `Phase ${phase}`;
}

export interface ReviewRow<T extends ReviewIdeaInput = ReviewIdeaInput> {
    idea: T;
    status: ReviewStatus;
    main: boolean;
    evidence: QueryEvidence | null;
    score: number | null;
    quickWin: boolean;
    reason: string;
    warning: string | null;
    note: string | null;
    /** Why an existing page needs an update, with the numbers. Null when there is none. */
    refresh: string | null;
}

/**
 * `refreshReasons` is record id → reason, from the map's generation_metadata
 * (see readRefreshReasons). Shown only on ideas that change an existing page.
 */
export function reviewRows<T extends ReviewIdeaInput>(
    ideas: ReadonlyArray<T>,
    evidence: ReviewEvidence,
    refreshReasons: Readonly<Record<string, string>> = {},
): ReviewRow<T>[] {
    return ideas.map(idea => {
        const match = evidenceFor(evidence, idea.targetQuery);
        const status = reviewStatus(idea);
        const scored = priorityScore({ action: idea.action, evidence: match, matchedUrl: idea.matchedUrl });
        return {
            idea,
            status,
            main: !idea.parentRecordId,
            evidence: match,
            score: scored.score,
            quickWin: scored.quickWin,
            reason: priorityReason(match, evidence.days),
            warning: status === 'live' ? null : duplicateWarning(idea, match, ideas),
            note: existingPageNote(idea),
            refresh: idea.action === 'improve' || idea.action === 'replace' ? refreshReasons[idea.id] ?? null : null,
        };
    });
}

export type ReviewSort = 'priority' | 'map';

/** Highest score first. Ideas without Google data follow, in map order. */
export function compareByPriority(a: ReviewRow, b: ReviewRow): number {
    if (a.score != null && b.score == null) return -1;
    if (a.score == null && b.score != null) return 1;
    if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score;
    const impressions = (b.evidence?.impressions ?? 0) - (a.evidence?.impressions ?? 0);
    if (impressions !== 0) return impressions;
    return a.idea.sortOrder - b.idea.sortOrder;
}

/** Main topic page first, each followed by its supporting articles, in map order. */
function mapOrder<T extends ReviewIdeaInput>(rows: ReviewRow<T>[]): ReviewRow<T>[] {
    const byOrder = [...rows].sort((a, b) => a.idea.sortOrder - b.idea.sortOrder);
    const ids = new Set(byOrder.map(row => row.idea.id));
    const roots = byOrder.filter(row => !row.idea.parentRecordId || !ids.has(row.idea.parentRecordId));
    const placed = new Set<string>();
    const out: ReviewRow<T>[] = [];
    const visit = (row: ReviewRow<T>) => {
        if (placed.has(row.idea.id)) return;
        placed.add(row.idea.id);
        out.push(row);
        for (const child of byOrder) if (child.idea.parentRecordId === row.idea.id) visit(child);
    };
    roots.forEach(visit);
    byOrder.forEach(visit);
    return out;
}

export interface ReviewGroup<T extends ReviewIdeaInput = ReviewIdeaInput> {
    id: string;
    name: string;
    rows: ReviewRow<T>[];
}

/**
 * One group per topic group (silo). Priority sort puts the highest-scoring
 * ideas first, and the group with the best idea first.
 */
export function groupReviewRows<T extends ReviewIdeaInput>(
    rows: ReadonlyArray<ReviewRow<T>>,
    silos: ReadonlyArray<{ id: string; name: string; sortOrder: number }>,
    sort: ReviewSort = 'priority',
): ReviewGroup<T>[] {
    const groups = silos
        .map(silo => {
            const own = rows.filter(row => row.idea.siloId === silo.id);
            return {
                silo,
                rows: sort === 'priority' ? [...own].sort(compareByPriority) : mapOrder(own),
            };
        })
        .filter(group => group.rows.length > 0);
    if (sort === 'priority') {
        groups.sort((a, b) => compareByPriority(a.rows[0], b.rows[0]) || a.silo.sortOrder - b.silo.sortOrder);
    } else {
        groups.sort((a, b) => a.silo.sortOrder - b.silo.sortOrder);
    }
    return groups.map(group => ({ id: group.silo.id, name: group.silo.name, rows: group.rows }));
}

export type ReviewFilter = 'all' | ReviewStatus;

export const REVIEW_FILTERS: ReadonlyArray<{ id: ReviewFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'waiting', label: 'Waiting for review' },
    { id: 'approved', label: 'Approved' },
    { id: 'declined', label: 'Declined' },
    { id: 'live', label: 'Already live' },
];

export function reviewCounts(rows: ReadonlyArray<{ status: ReviewStatus }>): Record<ReviewFilter, number> {
    const counts: Record<ReviewFilter, number> = { all: rows.length, waiting: 0, approved: 0, declined: 0, live: 0 };
    for (const row of rows) counts[row.status] += 1;
    return counts;
}

/** "4 ideas · 1 of 2 waiting selected · 1 already live". */
export function groupSummary(rows: ReadonlyArray<ReviewRow>, selected: ReadonlySet<string>): string {
    const waiting = rows.filter(row => row.status === 'waiting');
    const picked = waiting.filter(row => selected.has(row.idea.id)).length;
    const live = rows.filter(row => row.status === 'live').length;
    const parts = [`${rows.length} ${rows.length === 1 ? 'idea' : 'ideas'}`];
    if (waiting.length > 0) parts.push(`${picked} of ${waiting.length} waiting selected`);
    if (live > 0) parts.push(`${live} already live`);
    return parts.join(' · ');
}

// ─── Monthly plan preview ───────────────────────────────────────────────────

export interface ReviewPlan {
    month: string;
    /** Pieces already planned for the month on the Content board. */
    planned: number;
    selected: number;
    after: number;
    limit: number | null;
    over: number;
}

/**
 * What approving the selection for a month would do to that month's plan.
 * Going over warns. It never blocks.
 */
export function reviewPlan(
    records: ReadonlyArray<PlanCountable & { id: string }>,
    selectedIds: ReadonlyArray<string>,
    contentPieces: number | null | undefined,
    month: string,
): ReviewPlan {
    const target = readWorkMonth(month) ?? month;
    const chosen = new Set(selectedIds);
    const planned = records.filter(record =>
        !chosen.has(record.id) && countsTowardPlan(record) && readWorkMonth(record.workMonth) === target,
    ).length;
    const selected = chosen.size;
    const after = planned + selected;
    const limit = contentPlanLimit(contentPieces);
    return { month: target, planned, selected, after, limit, over: limit == null ? 0 : Math.max(0, after - limit) };
}

function monthOnly(month: string): string {
    return (workMonthLabel(month) ?? month).split(' ')[0];
}

/** "Approving the 6 selected would make November 12 of 8: 4 over this month's plan". */
export function overPlanWarning(plan: ReviewPlan): string | null {
    if (plan.limit == null || plan.over <= 0 || plan.selected === 0) return null;
    return `Approving the ${plan.selected} selected would make ${monthOnly(plan.month)} ${plan.after} of ${plan.limit}: ${plan.over} over this month's plan`;
}

export const OVER_PLAN_DETAIL = 'You can still approve. Pick another month in the bar below, or check with the client before adding extra pieces.';

/** The short line next to the selection count. */
export function selectionPreview(plan: ReviewPlan): string {
    const name = monthOnly(plan.month);
    if (plan.limit == null) return `${name} would have ${plan.after} planned`;
    if (plan.over > 0) return `${name} would be ${plan.over} over plan`;
    return `${name} would be ${plan.after} of ${plan.limit}`;
}

/** Month menu line: "Would be 4 over plan" or "Would be 8 of 8: fits". */
export function monthOptionNote(plan: ReviewPlan): string {
    if (plan.limit == null) return `Would have ${plan.after} planned`;
    if (plan.over > 0) return `Would be ${plan.over} over plan`;
    return `Would be ${plan.after} of ${plan.limit}: fits`;
}

/** The side note on the plan card. */
export function planCardNote(plan: ReviewPlan): string {
    if (plan.limit == null) return '';
    const name = monthOnly(plan.month);
    if (plan.selected === 0) {
        const left = Math.max(0, plan.limit - plan.planned);
        return left === 0 ? `The plan is full for ${name}.` : `${left} more fit in this month's plan.`;
    }
    if (plan.over > 0) return `${plan.over} over plan if you approve the ${plan.selected} selected for ${name}. Approving is never blocked.`;
    return `Approving the ${plan.selected} selected would make it ${plan.after} of ${plan.limit}.${plan.after === plan.limit ? ' The plan would be full.' : ''}`;
}

// ─── Done ───────────────────────────────────────────────────────────────────

/** "2 for November and 5 for December", from approved ideas that use up a piece. */
export function approvedMonthsSummary(
    records: ReadonlyArray<PlanCountable & { id: string }>,
): string {
    const months = new Map<string, number>();
    let unscheduled = 0;
    for (const record of records) {
        if (!countsTowardPlan(record)) continue;
        const month = readWorkMonth(record.workMonth);
        if (month) months.set(month, (months.get(month) ?? 0) + 1);
        else unscheduled += 1;
    }
    const parts = [...months.keys()].sort().map(month => `${months.get(month)} for ${monthOnly(month)}`);
    if (unscheduled > 0) parts.push(`${unscheduled} not scheduled yet`);
    if (parts.length <= 1) return parts[0] ?? '';
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function contentBoardHref(clientId: string): string {
    return `/workspace/${encodeURIComponent(clientId)}?tab=content`;
}
