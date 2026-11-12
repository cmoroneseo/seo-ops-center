/**
 * How each existing page is doing in Google, from stored Search Console facts
 * only (gsc_history_facts, page grain for the 90-day periods, query_page grain
 * for the page's main search). No live Google calls.
 *
 * A page qualifies for a refresh on any one of four signals:
 * - striking_distance: around spots 8 to 30 for its main search, with real demand
 * - decline: clicks or impressions down 30% or more vs the previous 90 days
 * - low_ctr: far fewer clicks than pages in that spot usually get
 * - thin: a service-type page with few words
 *
 * Pure functions. Later topic-map checks reuse them.
 */

import { isHomePath, isUtilityPage, pageKey } from './page-match';

export type RefreshSignal = 'striking_distance' | 'decline' | 'low_ctr' | 'thin';

/** Days in each compared period. */
export const PERIOD_DAYS = 90;
/** Both periods need this many stored days before a decline can be called. */
export const PERIOD_MIN_DAYS = 60;

export const STRIKING_MIN_POSITION = 8;
export const STRIKING_MAX_POSITION = 30;
/** Impressions per 28 days for the main search before spots 8 to 30 count as striking distance. */
export const STRIKING_MIN_IMPRESSIONS = 50;

/** A fall of 30% or more counts as a decline. */
export const DECLINE_MIN_DROP = 0.3;
/** A click decline needs at least this many clicks in the previous 90 days. */
export const DECLINE_MIN_PRIOR_CLICKS = 20;
/** An impression decline needs at least this many impressions in the previous 90 days. */
export const DECLINE_MIN_PRIOR_IMPRESSIONS = 500;

/** Low click-through needs this many impressions in the last 90 days. */
export const LOW_CTR_MIN_IMPRESSIONS = 1000;
/** Low click-through means under half the usual rate for the spot. */
export const LOW_CTR_MAX_RATIO = 0.5;
/** Usual click-through by spot (upper bound of each band). Past spot 20 nobody expects clicks. */
export const EXPECTED_CTR_BY_POSITION: ReadonlyArray<readonly [number, number]> = [
    [1, 0.28], [2, 0.15], [3, 0.1], [4, 0.07], [5, 0.05], [7, 0.035], [10, 0.025], [20, 0.01],
];

/** A service-type page under this many crawled words is thin. */
export const THIN_MAX_WORDS = 600;
/** Page types that sell a service rather than inform. */
export const MONEY_PAGE_TYPES: ReadonlySet<string> = new Set([
    'pillar', 'service', 'landing', 'product', 'collection', 'city', 'homepage',
]);

/** A page at or above this spot with no signals is already live. */
export const PAGE_ONE_MAX_POSITION = 10;

/** Pages with signals but no matching idea added to the map, at most. */
export const REFRESH_IDEAS_MAX = 10;

export function expectedCtr(position: number | null | undefined): number | null {
    if (position == null || !Number.isFinite(position) || position <= 0) return null;
    const spot = Math.max(1, Math.round(position));
    for (const [upTo, ctr] of EXPECTED_CTR_BY_POSITION) if (spot <= upTo) return ctr;
    return null;
}

export interface PeriodStats {
    clicks: number;
    impressions: number;
    /** Impression-weighted spot. Null with no impressions. */
    position: number | null;
}

export interface PagePerformance {
    url: string;
    recent: PeriodStats;
    prior: PeriodStats;
}

export interface PerformanceRead {
    /** Keyed by pageKey(url). */
    pages: Map<string, PagePerformance>;
    recentDays: number;
    priorDays: number;
}

export const EMPTY_PERFORMANCE: PerformanceRead = { pages: new Map(), recentDays: 0, priorDays: 0 };

function finite(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function dayNumber(date: string): number | null {
    const time = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
    return Number.isFinite(time) ? Math.floor(time / 86_400_000) : null;
}

/**
 * Split page-grain rows into the last 90 stored days and the 90 before,
 * counted back from the newest stored day.
 */
export function aggregatePagePerformance(
    rows: readonly Record<string, unknown>[],
    days: ReadonlyArray<{ id: string; date: string }>,
): PerformanceRead {
    const dayOf = new Map<string, number>();
    for (const day of days) {
        const n = dayNumber(day.date);
        if (n != null) dayOf.set(day.id, n);
    }
    if (dayOf.size === 0) return EMPTY_PERFORMANCE;
    const newest = Math.max(...dayOf.values());
    const periodOf = (n: number): 'recent' | 'prior' | null => {
        const age = newest - n;
        if (age < 0) return null;
        if (age < PERIOD_DAYS) return 'recent';
        if (age < PERIOD_DAYS * 2) return 'prior';
        return null;
    };
    let recentDays = 0;
    let priorDays = 0;
    for (const n of dayOf.values()) {
        const period = periodOf(n);
        if (period === 'recent') recentDays += 1;
        else if (period === 'prior') priorDays += 1;
    }

    const sums = new Map<string, { url: string; recent: number[]; prior: number[] }>();
    for (const row of rows) {
        const day = typeof row.day_id === 'string' ? dayOf.get(row.day_id) : undefined;
        const page = typeof row.page === 'string' ? row.page.trim() : '';
        if (day == null || !page) continue;
        const period = periodOf(day);
        const clicks = finite(row.clicks);
        const impressions = finite(row.impressions);
        const position = finite(row.position);
        if (!period || clicks == null || impressions == null) continue;
        const key = pageKey(page);
        const current = sums.get(key) ?? { url: page, recent: [0, 0, 0], prior: [0, 0, 0] };
        const bucket = current[period];
        bucket[0] += clicks;
        bucket[1] += impressions;
        bucket[2] += (position ?? 0) * impressions;
        sums.set(key, current);
    }

    const stats = ([clicks, impressions, weighted]: number[]): PeriodStats => ({
        clicks,
        impressions,
        position: impressions > 0 ? weighted / impressions : null,
    });
    const pages = new Map<string, PagePerformance>();
    for (const [key, sum] of sums) pages.set(key, { url: sum.url, recent: stats(sum.recent), prior: stats(sum.prior) });
    return { pages, recentDays, priorDays };
}

export interface QueryOnPage {
    query: string;
    page: string;
    clicks: number;
    impressions: number;
    position: number;
}

/** The searches each page shows for, most impressions first, keyed by pageKey. */
export function queriesByPage(rows: readonly QueryOnPage[]): Map<string, QueryOnPage[]> {
    const out = new Map<string, QueryOnPage[]>();
    for (const row of rows) {
        if (!row.page) continue;
        const key = pageKey(row.page);
        const list = out.get(key) ?? [];
        list.push(row);
        out.set(key, list);
    }
    for (const list of out.values()) list.sort((a, b) => b.impressions - a.impressions || a.position - b.position);
    return out;
}

/** The page's main search: the idea's target when the page shows for it, else its top search. */
export function mainCluster(
    pageQueries: readonly QueryOnPage[] | undefined,
    targetQuery?: string,
): QueryOnPage | null {
    if (!pageQueries || pageQueries.length === 0) return null;
    const wanted = (targetQuery ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (wanted) {
        const exact = pageQueries.find(row => row.query.trim().toLowerCase().replace(/\s+/g, ' ') === wanted);
        if (exact) return exact;
    }
    return pageQueries[0];
}

/** Contact, about, legal, booking, gallery and archive pages: never refresh ideas. See page-match. */
export { isUtilityPage };

/** Money page: by the idea's page type when known, else anything that is not a blog-style or utility URL. */
export function isMoneyPage(url: string, pageType?: string | null): boolean {
    if (pageType) return MONEY_PAGE_TYPES.has(pageType);
    return !isUtilityPage(url) && !/\/(blog|news|article|articles|post|posts|resources?|guides?|faq|tips)(\/|$)/i.test(url);
}

export interface RefreshInput {
    url: string;
    performance?: PagePerformance | null;
    recentDays: number;
    priorDays: number;
    /** Main search for the page over the 28-day window. */
    cluster?: { query: string; position: number; impressions: number } | null;
    /** Days the cluster numbers cover. */
    clusterDays?: number;
    wordCount?: number | null;
    moneyPage: boolean;
}

export interface RefreshNumbers {
    query: string | null;
    position: number | null;
    recentClicks: number | null;
    recentImpressions: number | null;
    priorClicks: number | null;
    priorImpressions: number | null;
    /** Fractions, e.g. -0.42. Null when the earlier period is too small to compare. */
    clicksChange: number | null;
    impressionsChange: number | null;
    ctr: number | null;
    expectedCtr: number | null;
    wordCount: number | null;
}

export interface RefreshRead {
    signals: RefreshSignal[];
    numbers: RefreshNumbers;
}

function change(recent: number, prior: number): number | null {
    return prior > 0 ? (recent - prior) / prior : null;
}

/** Which refresh signals a page shows, and the numbers behind them. */
export function refreshRead(input: RefreshInput): RefreshRead {
    const perf = input.performance ?? null;
    const recent = perf?.recent ?? null;
    const prior = perf?.prior ?? null;
    const position = input.cluster?.position ?? recent?.position ?? null;
    const signals: RefreshSignal[] = [];

    // (a) Striking distance, with demand scaled to 28 days.
    const monthly = input.cluster
        ? input.cluster.impressions * (28 / Math.max(1, input.clusterDays ?? 28))
        : recent ? recent.impressions * (28 / Math.max(1, input.recentDays || PERIOD_DAYS)) : 0;
    if (position != null && position >= STRIKING_MIN_POSITION && position <= STRIKING_MAX_POSITION
        && monthly >= STRIKING_MIN_IMPRESSIONS) {
        signals.push('striking_distance');
    }

    // (b) Decline, only with enough stored days in both periods.
    const comparable = input.recentDays >= PERIOD_MIN_DAYS && input.priorDays >= PERIOD_MIN_DAYS;
    const clicksChange = comparable && recent && prior && prior.clicks >= DECLINE_MIN_PRIOR_CLICKS
        ? change(recent.clicks, prior.clicks) : null;
    const impressionsChange = comparable && recent && prior && prior.impressions >= DECLINE_MIN_PRIOR_IMPRESSIONS
        ? change(recent.impressions, prior.impressions) : null;
    if ((clicksChange != null && clicksChange <= -DECLINE_MIN_DROP)
        || (impressionsChange != null && impressionsChange <= -DECLINE_MIN_DROP)) {
        signals.push('decline');
    }

    // (c) Low click-through for the page's own spot.
    const ctr = recent && recent.impressions > 0 ? recent.clicks / recent.impressions : null;
    const expected = expectedCtr(recent?.position);
    if (recent && ctr != null && expected != null && recent.impressions >= LOW_CTR_MIN_IMPRESSIONS
        && ctr < expected * LOW_CTR_MAX_RATIO) {
        signals.push('low_ctr');
    }

    // (d) Thin money page.
    const words = input.wordCount != null && Number.isFinite(input.wordCount) ? input.wordCount : null;
    if (input.moneyPage && words != null && words > 0 && words < THIN_MAX_WORDS) signals.push('thin');

    return {
        signals,
        numbers: {
            query: input.cluster?.query ?? null,
            position,
            recentClicks: recent?.clicks ?? null,
            recentImpressions: recent?.impressions ?? null,
            priorClicks: prior?.clicks ?? null,
            priorImpressions: prior?.impressions ?? null,
            clicksChange,
            impressionsChange,
            ctr,
            expectedCtr: expected,
            wordCount: words,
        },
    };
}

function count(value: number): string {
    return Math.round(value).toLocaleString('en-US');
}

function spotPhrase(numbers: RefreshNumbers): string | null {
    if (numbers.position == null) return null;
    const spot = Math.max(1, Math.round(numbers.position));
    return numbers.query
        ? `ranks around spot ${spot} in Google for “${numbers.query}”`
        : `ranks around spot ${spot} in Google`;
}

/**
 * Plain-English reason for a refresh, for example
 * "Ranks around spot 14 in Google for “artificial grass corona”; showing up in 42% fewer searches vs the previous 3 months".
 * Null when there is nothing to say.
 */
export function refreshReason(read: RefreshRead): string | null {
    const n = read.numbers;
    const parts: string[] = [];
    const spot = spotPhrase(n);
    const belowPageOne = n.position != null && Math.round(n.position) > PAGE_ONE_MAX_POSITION;
    if (spot && (read.signals.includes('striking_distance') || read.signals.includes('low_ctr') || belowPageOne)) {
        parts.push(belowPageOne && !read.signals.includes('striking_distance') ? `${spot}, below page 1` : spot);
    }
    if (read.signals.includes('decline')) {
        const drops: string[] = [];
        if (n.clicksChange != null && n.clicksChange <= -DECLINE_MIN_DROP) drops.push(`clicks down ${Math.round(-n.clicksChange * 100)}%`);
        if (n.impressionsChange != null && n.impressionsChange <= -DECLINE_MIN_DROP) {
            drops.push(`showing up in ${Math.round(-n.impressionsChange * 100)}% fewer searches`);
        }
        parts.push(`${drops.join(' and ')} vs the previous 3 months`);
    }
    if (read.signals.includes('low_ctr') && n.recentImpressions != null && n.recentClicks != null) {
        const clicked = n.recentClicks === 1 ? 'once' : `${count(n.recentClicks)} times`;
        parts.push(`seen in ${count(n.recentImpressions)} searches in the last 3 months but clicked only ${clicked}, well below normal for that spot`);
    }
    if (read.signals.includes('thin') && n.wordCount != null) {
        parts.push(`only ${count(n.wordCount)} words, short for a service page`);
    }
    if (parts.length === 0) return null;
    const text = parts.join('; ');
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export const NOT_IN_GOOGLE_REASON = 'Not showing up in Google searches yet';

export type MatchedPageVerdict =
    | { action: 'improve'; reason: string; signals: RefreshSignal[] }
    | { action: 'keep' }
    | null;

/**
 * What to do with an existing page an idea matched.
 * Any signal: improve, with the reason. Page 1 with no signals: keep (Already live).
 * Below page 1: improve. No Google data while Search Console is connected: improve.
 * Search Console not connected: only the crawl can speak. A thin page is
 * improve; anything else is null and the caller decides from the crawled
 * content (determineAction), never from rankings it does not have.
 */
export function matchedPageVerdict(read: RefreshRead, gscConnected: boolean): MatchedPageVerdict {
    if (!gscConnected) {
        if (!read.signals.includes('thin')) return null;
        return { action: 'improve', reason: refreshReason(read) ?? '', signals: ['thin'] };
    }
    const reason = refreshReason(read);
    if (read.signals.length > 0) return { action: 'improve', reason: reason ?? '', signals: read.signals };
    const position = read.numbers.position;
    if (position == null) return { action: 'improve', reason: NOT_IN_GOOGLE_REASON, signals: [] };
    if (Math.round(position) > PAGE_ONE_MAX_POSITION) return { action: 'improve', reason: reason ?? '', signals: [] };
    return { action: 'keep' };
}

export interface RefreshCandidate {
    url: string;
    pageId?: string;
    title?: string;
    read: RefreshRead;
    reason: string;
    /** max(last 90 days, previous 90 days) impressions. */
    impressionsAtStake: number;
}

/**
 * Existing pages with a refresh signal that no idea matched, ranked by
 * impressions at stake and capped at REFRESH_IDEAS_MAX. The home page and
 * pages Google never showed are left out.
 */
export function refreshCandidates(
    pages: ReadonlyArray<{ url: string; pageId?: string; title?: string; read: RefreshRead }>,
    matchedUrls: ReadonlySet<string>,
    max = REFRESH_IDEAS_MAX,
): RefreshCandidate[] {
    const matched = new Set([...matchedUrls].map(pageKey));
    const out: RefreshCandidate[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
        const key = pageKey(page.url);
        if (seen.has(key) || matched.has(key) || isHomePath(page.url) || isUtilityPage(page.url)
            || page.read.signals.length === 0) continue;
        seen.add(key);
        const n = page.read.numbers;
        const impressionsAtStake = Math.max(n.recentImpressions ?? 0, n.priorImpressions ?? 0);
        if (impressionsAtStake <= 0) continue;
        const reason = refreshReason(page.read);
        if (!reason) continue;
        out.push({ url: page.url, pageId: page.pageId, title: page.title, read: page.read, reason, impressionsAtStake });
    }
    out.sort((a, b) => b.impressionsAtStake - a.impressionsAtStake || a.url.localeCompare(b.url));
    return out.slice(0, Math.max(0, max));
}
