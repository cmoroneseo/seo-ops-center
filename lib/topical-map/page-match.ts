/**
 * Match topic-map ideas to pages already on the site by intent, not exact text.
 *
 * Text is reduced to significant tokens: lower case, plurals folded, turf and
 * lawn read as grass, synthetic and fake as artificial, and words that carry
 * no intent of their own dropped (installation, services, contractor, near me,
 * ca, the brand name). Two pieces of text share an intent when they share
 * those tokens. City and service words are both kept, so "Corona artificial
 * turf" meets /corona-ca/ while pavers and concrete in the same city do not
 * meet each other.
 *
 * Pure functions. Later topic-map checks reuse them.
 */

/** Words that never decide a match on their own. */
export const GENERIC_TOKENS: ReadonlySet<string> = new Set([
    'install', 'installation', 'installer', 'installing', 'installed',
    'service', 'company', 'contractor', 'business', 'professional', 'pro', 'expert', 'specialist',
    'near', 'me', 'best', 'top', 'local', 'affordable', 'cheap', 'quality', 'trusted', 'licensed',
    'ca', 'california', 'usa', 'us',
    'blog', 'page', 'home', 'index', 'html', 'htm', 'php', 'www', 'com', 'category', 'tag', 'post',
]);

const STOP_WORDS: ReadonlySet<string> = new Set([
    'a', 'an', 'and', 'or', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from', 'into', 'your', 'you',
    'our', 'we', 'my', 'is', 'are', 'be', 'it', 'its', 'this', 'that', 'what', 'which', 'who', 'why', 'how', 'when',
    'where', 'do', 'does', 'can', 'should', 'vs', 'versus', 'v', 'much', 'many', 'guide', 'complete', 'ultimate',
]);

/** Different words for the same service. */
const SYNONYMS: ReadonlyMap<string, string> = new Map([
    ['turf', 'grass'],
    ['lawn', 'grass'],
    ['synthetic', 'artificial'],
    ['fake', 'artificial'],
]);

/** Share of an idea's tokens a page must carry, and of a page's path tokens the idea must carry. */
export const MATCH_MIN_COVERAGE = 0.75;
/** A Search Console page only counts as covering a search from spot 20 up. */
export const GSC_MATCH_MAX_POSITION = 20;

function singular(word: string): string {
    if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

/** Significant tokens, de-duplicated, in first-seen order. */
export function significantTokens(text: string | null | undefined, ignore: ReadonlySet<string> = new Set()): string[] {
    const out: string[] = [];
    for (const raw of (text ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
        if (!raw || /^\d+$/.test(raw) || STOP_WORDS.has(raw)) continue;
        const word = singular(raw);
        const token = SYNONYMS.get(word) ?? word;
        if (GENERIC_TOKENS.has(raw) || GENERIC_TOKENS.has(word) || GENERIC_TOKENS.has(token)) continue;
        if (ignore.has(raw) || ignore.has(token)) continue;
        if (!out.includes(token)) out.push(token);
    }
    return out;
}

/** Tokens for the brand name and site domain, so "Ecoworkz" never makes a match. */
export function brandTokens(...values: Array<string | null | undefined>): Set<string> {
    const out = new Set<string>();
    for (const value of values) {
        let text = value ?? '';
        try {
            if (/^https?:\/\//i.test(text)) text = new URL(text).hostname;
        } catch {
            // keep as given
        }
        text = text.replace(/^www\./i, '').replace(/\.[a-z]{2,}$/i, '');
        for (const token of significantTokens(text)) out.add(token);
    }
    return out;
}

/** Lower-case path with no trailing slash ("/" for the home page). Works on absolute or relative URLs. */
export function urlPath(url: string): string {
    let path = url.trim();
    try {
        path = new URL(path, 'https://placeholder.invalid').pathname;
    } catch {
        // keep as given
    }
    path = path.toLowerCase().replace(/\/+$/, '');
    return path || '/';
}

/** Host (no www) plus path: the join key between crawled pages and Search Console pages. */
export function pageKey(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.hostname.toLowerCase().replace(/^www\./, '')}${urlPath(url) === '/' ? '' : urlPath(url)}`;
    } catch {
        return urlPath(url);
    }
}

export function isHomePath(url: string): boolean {
    return urlPath(url) === '/';
}

/** One key per search intent: the sorted significant tokens. Falls back to the trimmed lower-case text. */
export function intentKey(query: string | null | undefined, ignore: ReadonlySet<string> = new Set()): string {
    const tokens = significantTokens(query, ignore);
    if (tokens.length > 0) return [...tokens].sort().join(' ');
    return (query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface MatchablePage {
    pageId?: string;
    /** Absolute or relative URL. */
    normalizedUrl: string;
    title?: string;
    h1s: string[];
}

export interface MatchableIdea {
    targetQuery: string;
    title: string;
    suggestedUrl?: string;
    /** Other searches the idea covers, when the generator lists them. */
    supportingQueries?: string[];
}

/** One search and a page Google showed for it. */
export interface GscPageHit {
    query: string;
    pageUrl: string;
    /** Impression-weighted spot. Unknown positions are allowed. */
    position?: number;
    impressions?: number;
    /** intentKey(query), when the caller computed it once up front. */
    key?: string;
}

export type MatchVia = 'url' | 'gsc' | 'tokens';

export interface PageMatch<P extends MatchablePage> {
    /** The crawled page, when the match is one. */
    page?: P;
    /** The matched URL (the crawled page's, or the Search Console page's). */
    url: string;
    via: MatchVia;
    /** The search that tied a Search Console match, when there is one. */
    query?: string;
}

/** Score of an idea's tokens against one page. Null when it is not a match. */
export function tokenMatchScore(ideaTokens: readonly string[], page: MatchablePage, ignore: ReadonlySet<string> = new Set()): number | null {
    if (ideaTokens.length === 0 || isHomePath(page.normalizedUrl)) return null;
    const pathTokens = significantTokens(urlPath(page.normalizedUrl).replace(/[/_-]+/g, ' '), ignore);
    if (pathTokens.length === 0) return null;
    const pageTokens = new Set([
        ...pathTokens,
        ...significantTokens(page.title, ignore),
        ...page.h1s.flatMap(h1 => significantTokens(h1, ignore)),
    ]);
    const idea = new Set(ideaTokens);
    const shared = ideaTokens.filter(token => pageTokens.has(token)).length;
    const ideaCoverage = shared / ideaTokens.length;
    const pathCoverage = pathTokens.filter(token => idea.has(token)).length / pathTokens.length;
    if (ideaCoverage < MATCH_MIN_COVERAGE || pathCoverage < MATCH_MIN_COVERAGE) return null;
    // Prefer the page whose own words are closest to the idea, not the broadest page.
    return ideaCoverage + pathCoverage + shared / pageTokens.size;
}

/**
 * The existing page an idea duplicates, or null.
 * Order: the same URL; the page Google already shows (spot 20 or better) for
 * the idea's target search; a page sharing the idea's significant tokens; the
 * page Google shows for one of the idea's supporting searches. The home page
 * matches only by URL.
 */
export function matchIdeaToPage<P extends MatchablePage>(
    idea: MatchableIdea,
    pages: readonly P[],
    hits: readonly GscPageHit[],
    ignore: ReadonlySet<string> = new Set(),
): PageMatch<P> | null {
    if (idea.suggestedUrl?.trim()) {
        const wanted = urlPath(idea.suggestedUrl);
        const byUrl = pages.find(page => urlPath(page.normalizedUrl) === wanted);
        if (byUrl) return { page: byUrl, url: byUrl.normalizedUrl, via: 'url' };
    }

    const byGsc = (query: string): PageMatch<P> | null => {
        const key = intentKey(query, ignore);
        if (!key) return null;
        const best = hits
            .filter(hit => (hit.key ?? intentKey(hit.query, ignore)) === key
                && !isHomePath(hit.pageUrl)
                && (hit.position == null || hit.position <= GSC_MATCH_MAX_POSITION))
            .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0) || (a.position ?? 0) - (b.position ?? 0))[0];
        if (!best) return null;
        const crawled = pages.find(page => pageKey(page.normalizedUrl) === pageKey(best.pageUrl)
            || urlPath(page.normalizedUrl) === urlPath(best.pageUrl));
        return crawled
            ? { page: crawled, url: crawled.normalizedUrl, via: 'gsc', query: best.query }
            : { url: best.pageUrl, via: 'gsc', query: best.query };
    };

    const target = byGsc(idea.targetQuery);
    if (target) return target;

    let bestPage: P | null = null;
    let bestScore = -1;
    const candidates = [significantTokens(idea.targetQuery, ignore), significantTokens(idea.title, ignore)];
    for (const page of pages) {
        for (const tokens of candidates) {
            const score = tokenMatchScore(tokens, page, ignore);
            if (score != null && score > bestScore) {
                bestScore = score;
                bestPage = page;
            }
        }
    }
    if (bestPage) return { page: bestPage, url: bestPage.normalizedUrl, via: 'tokens' };

    for (const query of idea.supportingQueries ?? []) {
        const supporting = byGsc(query);
        if (supporting) return supporting;
    }
    return null;
}

/**
 * Keeps the first idea per search intent and per matched page.
 * Returns the index of the earlier idea each dropped idea duplicates.
 */
export function dedupeIdeas(
    ideas: ReadonlyArray<{ targetQuery: string; matchedUrl?: string | null }>,
    ignore: ReadonlySet<string> = new Set(),
): { keep: number[]; duplicateOf: Map<number, number> } {
    const byIntent = new Map<string, number>();
    const byPage = new Map<string, number>();
    const keep: number[] = [];
    const duplicateOf = new Map<number, number>();
    ideas.forEach((idea, index) => {
        const intent = intentKey(idea.targetQuery, ignore);
        const page = idea.matchedUrl?.trim() ? pageKey(idea.matchedUrl) : '';
        const earlier = (intent ? byIntent.get(intent) : undefined) ?? (page ? byPage.get(page) : undefined);
        if (earlier != null) {
            duplicateOf.set(index, earlier);
            return;
        }
        if (intent) byIntent.set(intent, index);
        if (page) byPage.set(page, index);
        keep.push(index);
    });
    return { keep, duplicateOf };
}
