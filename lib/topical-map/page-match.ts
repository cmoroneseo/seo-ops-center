/**
 * Match topic-map ideas to pages already on the site by intent, not exact text.
 *
 * Text is reduced to significant tokens: lower case, plurals folded, simple
 * -ing / -e endings folded (landscaping = landscape), turf read as artificial
 * grass, and words that carry no intent of their own dropped (installation,
 * services, contractor, near me, ca, the brand name).
 *
 * A token overlap alone is not enough. An idea and a page must also agree on:
 * - kind: a service idea only meets a service page or a city/county page; an
 *   article (guide, cost, how-to, comparison) only meets an article; an FAQ
 *   only meets an FAQ page
 * - place: a city or county in the idea must be on the page, and a page built
 *   for one city never stands in for an idea with no city. Places are learned
 *   from the site's own city/county URLs and "X County" / "X, CA" text
 * - modifiers: commercial, pet, cost, putting green, playground and "vs" must
 *   be on both or neither
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

/** Dropped even from the strict search key: they never change what is being searched for. */
const FILLER_TOKENS: ReadonlySet<string> = new Set([
    'near', 'me', 'best', 'top', 'local', 'affordable', 'cheap', 'ca', 'california', 'usa', 'us',
]);

const STOP_WORDS: ReadonlySet<string> = new Set([
    'a', 'an', 'and', 'or', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from', 'into', 'your', 'you',
    'our', 'we', 'my', 'is', 'are', 'be', 'it', 'its', 'this', 'that', 'what', 'which', 'who', 'why', 'how', 'when',
    'where', 'do', 'does', 'can', 'should', 'vs', 'versus', 'v', 'much', 'many', 'guide', 'complete', 'ultimate',
]);

/** Different words for the same service. */
const SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
    ['turf', ['artificial', 'grass']],
    ['lawn', ['grass']],
    ['synthetic', ['artificial']],
    ['fake', ['artificial']],
]);

/** State codes that are not also everyday English words. A URL ending in one names a place. */
const STATE_CODES: ReadonlySet<string> = new Set([
    'ak', 'az', 'ar', 'ca', 'ct', 'fl', 'ga', 'ia', 'il', 'ks', 'ky', 'md', 'mi', 'mn', 'ms', 'mt', 'nc', 'nd',
    'ne', 'nh', 'nj', 'nm', 'nv', 'ny', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'va', 'vt', 'wa', 'wi', 'wv', 'wy',
]);

/** First words of two-word place names ("san bernardino", "santa ana", "palm springs"). */
const PLACE_PREFIXES: ReadonlySet<string> = new Set([
    'san', 'santa', 'los', 'las', 'el', 'la', 'del', 'de', 'palm', 'rancho', 'lake', 'mission', 'laguna',
    'west', 'east', 'north', 'south', 'new', 'fort', 'mount', 'saint', 'st', 'port', 'long', 'big', 'palos', 'garden',
]);

/** Broad areas that cover a whole service region, not one city. They never block or force a match. */
const REGION_PHRASES: ReadonlyArray<readonly string[]> = [
    ['southern', 'california'], ['southern', 'ca'], ['socal'], ['so', 'cal'], ['northern', 'california'], ['norcal'],
    ['central', 'california'], ['inland', 'empire'], ['bay', 'area'],
];

/** Modifiers that change who or what the page is for. They must be on both sides or neither. */
const MODIFIER_FLAGS: ReadonlyMap<string, string> = new Map([
    ['commercial', 'commercial'], ['business', 'commercial'], ['hoa', 'commercial'], ['office', 'commercial'],
    ['industrial', 'commercial'], ['municipal', 'commercial'],
    ['pet', 'pet'], ['dog', 'pet'],
    ['cost', 'cost'], ['price', 'cost'], ['pricing', 'cost'],
    ['diy', 'diy'],
    ['putting', 'putting_green'], ['golf', 'putting_green'],
    ['playground', 'playground'],
]);

/** Words for an all-round offering, which a city or county page covers. */
const BROAD_WORDS = [
    'landscape', 'landscaping', 'hardscape', 'hardscaping', 'outdoor', 'backyard', 'yard', 'remodel', 'remodeling',
    'renovation', 'construction', 'living', 'space', 'design', 'build', 'project', 'exterior', 'makeover',
];

/** Share of an idea's tokens a page must carry, and of a page's path tokens the idea must carry. */
export const MATCH_MIN_COVERAGE = 0.75;
/** Article URLs are wordy ("4-factors-to-consider-..."), so half their path words are enough. */
export const ARTICLE_PATH_MIN_COVERAGE = 0.5;
/** An FAQ idea meets the site's FAQ page when half its words are there. */
export const FAQ_MIN_COVERAGE = 0.5;
/** A Search Console page only counts as covering a search from spot 20 up. */
export const GSC_MATCH_MAX_POSITION = 20;
/** ...and with at least this many impressions in the window. */
export const GSC_MATCH_MIN_IMPRESSIONS = 20;
/** Two ideas on the same page with the same page type are duplicates when this share of their words overlap. */
export const DEDUPE_MIN_OVERLAP = 0.5;

function singular(word: string): string {
    if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
    if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

function stem(word: string): string {
    let out = word;
    if (out.length > 5 && out.endsWith('ing')) out = out.slice(0, -3);
    if (out.length > 4 && out.endsWith('e')) out = out.slice(0, -1);
    return out;
}

function words(text: string | null | undefined): string[] {
    return (text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(singular);
}

function tokenize(text: string | null | undefined, ignore: ReadonlySet<string>, keepGeneric: boolean): string[] {
    const out: string[] = [];
    for (const raw of (text ?? '').toLowerCase().split(/[^a-z0-9]+/)) {
        if (!raw || /^\d+$/.test(raw) || STOP_WORDS.has(raw) || ignore.has(raw)) continue;
        const word = singular(raw);
        if (ignore.has(word) || FILLER_TOKENS.has(raw) || FILLER_TOKENS.has(word)) continue;
        if (!keepGeneric && (GENERIC_TOKENS.has(raw) || GENERIC_TOKENS.has(word))) continue;
        for (const mapped of SYNONYMS.get(word) ?? [word]) {
            const token = stem(mapped);
            if (!keepGeneric && GENERIC_TOKENS.has(token)) continue;
            if (ignore.has(token)) continue;
            if (!out.includes(token)) out.push(token);
        }
    }
    return out;
}

const BROAD_TOKENS: ReadonlySet<string> = new Set(BROAD_WORDS.flatMap(word => tokenize(word, new Set(), false)));

/** Significant tokens, de-duplicated, in first-seen order. */
export function significantTokens(text: string | null | undefined, ignore: ReadonlySet<string> = new Set()): string[] {
    return tokenize(text, ignore, false);
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

/** A search for the business itself: every word of the brand name, or of the domain name, is in it. */
export function isBrandSearch(query: string, ...brands: Array<string | null | undefined>): boolean {
    const tokens = new Set(significantTokens(query));
    return brands.some(brand => {
        const own = [...brandTokens(brand)];
        return own.length > 0 && own.every(token => tokens.has(token));
    });
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

/** Lower-case host without "www.", or null for a relative or unreadable URL. */
export function bareHost(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
        return null;
    }
}

/** Host (no www) plus path: the join key between crawled pages and Search Console pages. */
export function pageKey(url: string): string {
    const host = bareHost(url);
    if (host == null) return urlPath(url);
    const path = urlPath(url);
    return `${host}${path === '/' ? '' : path}`;
}

export function isHomePath(url: string): boolean {
    return urlPath(url) === '/';
}

/** Segments that are utility pages wherever they appear, alone or as the first word ("contact-us", "book-now"). */
const UTILITY_WORDS: ReadonlySet<string> = new Set([
    'contact', 'about', 'privacy', 'terms', 'thank', 'thanks', 'sitemap', 'login', 'account', 'cart', 'checkout',
    'testimonials', 'testimonial', 'reviews', 'gallery', 'galleries', 'portfolio', 'careers', 'career', 'jobs',
    'book', 'booking', 'schedule', 'category', 'categories', 'tag', 'tags', 'author', 'feed', 'search', 'wp',
    'accessibility',
]);
/** Segments that are utility pages only when they are the whole segment. */
const UTILITY_SEGMENTS: ReadonlySet<string> = new Set(['financing', 'page', 'amp']);

/**
 * Contact, about, legal, booking, gallery/portfolio, category/tag/author and
 * date-archive pages, and any URL with a query string. Never matched to an
 * idea and never a refresh idea.
 */
export function isUtilityPage(url: string): boolean {
    if (/\?./.test(url)) return true;
    const path = urlPath(url);
    if (/\/\d{4}(\/\d{1,2})?(\/|$)/.test(path)) return true;
    return path.split('/').filter(Boolean).some(segment =>
        UTILITY_SEGMENTS.has(segment) || UTILITY_WORDS.has(segment.split('-')[0]));
}

/**
 * One key per search: the sorted significant tokens, keeping service words
 * (installation, services, contractor), so "artificial grass installation" and
 * "artificial grass" stay different searches. Drops "near me", "best", "ca"
 * and the brand. Falls back to the trimmed lower-case text.
 */
export function intentKey(query: string | null | undefined, ignore: ReadonlySet<string> = new Set()): string {
    const tokens = tokenize(query, ignore, true);
    if (tokens.length > 0) return [...tokens].sort().join(' ');
    return (query ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── Places ─────────────────────────────────────────────────────────────────

/** City or county names, as singular lower-case word strings ("riverside county", "yorba linda"). */
export type PlaceSet = ReadonlySet<string>;

function placeOk(placeWords: readonly string[]): boolean {
    return placeWords.length > 0 && placeWords.every(word =>
        /^[a-z]+$/.test(word) && !STOP_WORDS.has(word) && !GENERIC_TOKENS.has(word) && !BROAD_TOKENS.has(stem(word)));
}

/** Places named by a URL's last segment: "corona-ca", "orange-county-ca", "riverside-county". */
function placeFromSegment(segment: string): string | null {
    const parts = segment.split('-').filter(Boolean).map(singular);
    let body = parts;
    if (body.length > 1 && STATE_CODES.has(body[body.length - 1])) body = body.slice(0, -1);
    else if (!(body.length > 1 && body[body.length - 1] === 'county')) return null;
    const name = body[body.length - 1] === 'county' ? body.slice(0, -1) : body;
    if (name.length < 1 || name.length > 3 || !placeOk(name)) return null;
    return body.join(' ');
}

/** Places named in text: "Riverside County", "San Bernardino Counties", "Corona, CA". */
export function placesInText(text: string | null | undefined, known: PlaceSet = new Set()): string[] {
    const out: string[] = [];
    const list = words(text);
    list.forEach((word, i) => {
        if (word !== 'county' || i === 0) return;
        const two = i >= 2 ? [list[i - 2], list[i - 1]] : null;
        const name = two && (PLACE_PREFIXES.has(two[0]) || known.has(`${two.join(' ')} county`)) ? two : [list[i - 1]];
        if (placeOk(name)) out.push(`${name.join(' ')} county`);
    });
    const raw = (text ?? '').toLowerCase();
    for (const match of raw.matchAll(/([a-z]+)(?:\s+([a-z]+))?,\s*([a-z]{2})\b/g)) {
        if (!STATE_CODES.has(match[3])) continue;
        const pair = match[2] ? [singular(match[1]), singular(match[2])] : null;
        const name = pair && (PLACE_PREFIXES.has(pair[0]) || known.has(pair.join(' '))) ? pair : [singular(match[2] ?? match[1])];
        if (name[0] !== 'county' && placeOk(name)) out.push(name.join(' '));
    }
    return [...new Set(out)];
}

/** Places the site has pages for, from its city/county URLs, titles and H1s. */
export function learnPlaces(pages: readonly MatchablePage[]): Set<string> {
    const out = new Set<string>();
    for (const page of pages) {
        const segments = urlPath(page.normalizedUrl).split('/').filter(Boolean);
        const place = segments.length > 0 ? placeFromSegment(segments[segments.length - 1]) : null;
        if (place) out.add(place);
    }
    for (const page of pages) {
        for (const text of [page.title, ...page.h1s]) for (const place of placesInText(text, out)) out.add(place);
    }
    return out;
}

export interface TextFacts {
    /** Significant tokens with places and regions taken out. */
    topic: string[];
    /** Cities and counties named. */
    places: string[];
    flags: Set<string>;
    comparison: boolean;
}

/** Split text into topic tokens, places, modifier flags and "vs". */
export function readText(text: string | null | undefined, places: PlaceSet, ignore: ReadonlySet<string>): TextFacts {
    const list = words(text);
    const flags = new Set<string>();
    for (const word of list) {
        const flag = MODIFIER_FLAGS.get(word);
        if (flag) flags.add(flag);
    }
    const comparison = list.includes('vs') || list.includes('versus');
    const phrases = [...places].map(place => place.split(' ')).sort((a, b) => b.length - a.length);
    const found: string[] = [];
    const rest: string[] = [];
    for (let i = 0; i < list.length;) {
        const region = REGION_PHRASES.find(phrase => phrase.every((word, k) => list[i + k] === word));
        if (region) {
            i += region.length;
            continue;
        }
        const place = phrases.find(phrase => phrase.every((word, k) => list[i + k] === word));
        if (place) {
            found.push(place.join(' '));
            i += place.length;
            continue;
        }
        rest.push(list[i]);
        i += 1;
    }
    const topic = tokenize(rest.join(' '), ignore, false).filter(token => token !== 'county' && !STATE_CODES.has(token));
    return { topic, places: [...new Set(found)], flags, comparison };
}

// ─── Pages and ideas ────────────────────────────────────────────────────────

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
    /** The idea's page type (service, pillar, blog_post, guide, faq, ...). Inferred from the text when absent. */
    pageType?: string;
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

/** What a page is for. Only compatible kinds can match. */
export type PageKind = 'home' | 'utility' | 'faq' | 'hub' | 'service' | 'article';
/** What an idea is for. */
export type IdeaKind = 'money' | 'article' | 'faq';

const MONEY_PAGE_TYPES: ReadonlySet<string> = new Set(['pillar', 'service', 'landing', 'product', 'collection', 'city', 'homepage']);
const ARTICLE_PAGE_TYPES: ReadonlySet<string> = new Set(['blog_post', 'guide', 'resource_center', 'knowledge_base', 'comparison', 'case_study']);
const ARTICLE_DIRS = /^(blog|blogs|news|article|articles|post|posts|resources?|guides?|learn|insights?|tips)$/;
const SERVICE_DIRS = /^(our-)?services?$|^what-we-do$/;
const ARTICLE_TEXT = /^(how|what|why|is|are|can|should|when|does|do|which|where|who)\b|\b(guide|tips|ideas|mistakes|checklist|step-by-step|step by step|questions|reasons|vs\.?|versus)\b/i;

function looksLikeArticle(text: string): boolean {
    return ARTICLE_TEXT.test(text.trim());
}

export function ideaKind(idea: { targetQuery: string; title: string; pageType?: string }): IdeaKind {
    const type = (idea.pageType ?? '').trim();
    if (type === 'faq') return 'faq';
    if (MONEY_PAGE_TYPES.has(type)) return 'money';
    if (ARTICLE_PAGE_TYPES.has(type)) return 'article';
    if (/\bfaqs?\b/i.test(`${idea.title} ${idea.targetQuery}`)) return 'faq';
    if (looksLikeArticle(idea.title) || looksLikeArticle(idea.targetQuery)) return 'article';
    return 'money';
}

export interface SiteFacts {
    places: Set<string>;
    hosts: Set<string>;
    /** True when the site keeps its service pages under /services/ or /our-services/. */
    serviceDir: boolean;
}

const siteCache = new WeakMap<readonly MatchablePage[], SiteFacts>();

export function siteFacts(pages: readonly MatchablePage[]): SiteFacts {
    const cached = siteCache.get(pages);
    if (cached) return cached;
    const hosts = new Set<string>();
    let serviceDir = false;
    for (const page of pages) {
        const host = bareHost(page.normalizedUrl);
        if (host) hosts.add(host);
        const segments = urlPath(page.normalizedUrl).split('/').filter(Boolean);
        if (segments.length >= 2 && SERVICE_DIRS.test(segments[0])) serviceDir = true;
    }
    const facts = { places: learnPlaces(pages), hosts, serviceDir };
    siteCache.set(pages, facts);
    return facts;
}

interface PageFacts {
    kind: PageKind;
    /** Topic tokens across title, H1s and path. */
    topic: Set<string>;
    /** Topic tokens of the path. */
    pathTopic: string[];
    /** Places anywhere on the page, and in the path. */
    places: Set<string>;
    pathPlaces: Set<string>;
    /** Places the title or H1 names: the page presents itself as about that city. */
    titlePlaces: Set<string>;
    flags: Set<string>;
    comparison: boolean;
}

export function pageKindOf(page: MatchablePage, site: { places: PlaceSet; serviceDir: boolean }, ignore: ReadonlySet<string> = new Set()): PageKind {
    return readPage(page, site, ignore).kind;
}

function readPage(page: MatchablePage, site: { places: PlaceSet; serviceDir: boolean }, ignore: ReadonlySet<string>): PageFacts {
    const path = urlPath(page.normalizedUrl);
    const segments = path.split('/').filter(Boolean);
    const pathText = segments.join(' ').replace(/[-_]+/g, ' ');
    const pathRead = readText(pathText, site.places, ignore);
    const texts = [page.title ?? '', ...page.h1s];
    const textReads = texts.map(text => readText(text, site.places, ignore));
    const flags = new Set([...pathRead.flags, ...textReads.flatMap(read => [...read.flags])]);
    const comparison = pathRead.comparison || textReads.some(read => read.comparison);
    const places = new Set([...pathRead.places, ...textReads.flatMap(read => read.places)]);
    const topic = new Set([...pathRead.topic, ...textReads.flatMap(read => read.topic)]);

    let kind: PageKind;
    const last = segments.length > 0 ? readText(segments[segments.length - 1].replace(/[-_]+/g, ' '), site.places, ignore) : null;
    if (path === '/') kind = 'home';
    else if (segments.some(segment => /^faqs?$/.test(segment) || segment.split('-').includes('faq') || segment.split('-').includes('faqs'))) kind = 'faq';
    else if (isUtilityPage(page.normalizedUrl)) kind = 'utility';
    else if (last && last.places.length > 0 && last.topic.length === 0) kind = 'hub';
    else if (segments.some(segment => ARTICLE_DIRS.test(segment))) kind = 'article';
    else if (site.serviceDir) kind = segments.length >= 2 && SERVICE_DIRS.test(segments[0]) ? 'service' : 'article';
    else kind = comparison || looksLikeArticle(pathText) || texts.some(looksLikeArticle) || /^\d/.test(segments[segments.length - 1] ?? '') ? 'article' : 'service';

    return {
        kind,
        topic,
        pathTopic: pathRead.topic,
        places,
        pathPlaces: new Set(pathRead.places),
        titlePlaces: new Set(textReads.flatMap(read => read.places)),
        flags,
        comparison,
    };
}

const pageCache = new WeakMap<object, { site: object; ignore: object; facts: PageFacts }>();

/** readPage, remembered per page object for the same site view and ignore set. */
function cachedPage(page: MatchablePage, site: { places: PlaceSet; serviceDir: boolean }, ignore: ReadonlySet<string>): PageFacts {
    const hit = pageCache.get(page);
    if (hit && hit.site === site.places && hit.ignore === ignore) return hit.facts;
    const facts = readPage(page, site, ignore);
    pageCache.set(page, { site: site.places, ignore, facts });
    return facts;
}

interface IdeaFacts {
    kind: IdeaKind;
    topics: string[][];
    places: string[];
    flags: Set<string>;
    comparison: boolean;
}

function readIdea(idea: MatchableIdea, places: PlaceSet, ignore: ReadonlySet<string>): IdeaFacts {
    const query = readText(idea.targetQuery, places, ignore);
    const title = readText(idea.title, places, ignore);
    return {
        kind: ideaKind(idea),
        topics: [query.topic, title.topic].filter(topic => topic.length > 0),
        places: query.places.length > 0 ? query.places : title.places,
        flags: query.flags,
        comparison: query.comparison,
    };
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    return a.size === b.size && [...a].every(value => b.has(value));
}

/** Kind, place and modifier agreement. Token overlap is checked separately. */
function compatible(idea: IdeaFacts, page: PageFacts): boolean {
    const kindOk = idea.kind === 'money'
        ? page.kind === 'service' || page.kind === 'hub'
        : idea.kind === 'article' ? page.kind === 'article' : page.kind === 'faq';
    if (!kindOk) return false;
    if (!sameSet(idea.flags, page.flags) || idea.comparison !== page.comparison) return false;
    if (page.kind === 'hub') return idea.places.length > 0 && [...page.pathPlaces].every(place => idea.places.includes(place));
    if (!idea.places.every(place => page.places.has(place))) return false;
    // A page built for one city never stands in for an idea with no city: a
    // service page with the city in its URL, or an article with it in its title.
    if (idea.places.length === 0) {
        if (page.kind === 'service' && page.pathPlaces.size > 0) return false;
        if (page.kind !== 'service' && page.titlePlaces.size > 0) return false;
    }
    return true;
}

/** Token score for a compatible page. Null when the words do not line up. Higher is more specific. */
function tokenScore(idea: IdeaFacts, page: PageFacts): number | null {
    let best: number | null = null;
    for (const tokens of idea.topics) {
        let score: number | null = null;
        if (page.kind === 'hub') {
            // A city/county page covers all-round work there, plus whatever it names.
            if (tokens.every(token => BROAD_TOKENS.has(token) || page.topic.has(token))) score = 1 + page.pathPlaces.size;
        } else if (page.kind === 'faq') {
            const coverage = tokens.filter(token => page.topic.has(token)).length / tokens.length;
            if (coverage >= FAQ_MIN_COVERAGE) score = coverage;
        } else if (page.pathTopic.length > 0) {
            const coverage = tokens.filter(token => page.topic.has(token)).length / tokens.length;
            const pathShared = page.pathTopic.filter(token => tokens.includes(token)).length;
            const pathCoverage = pathShared / page.pathTopic.length;
            const pathMin = page.kind === 'article' ? ARTICLE_PATH_MIN_COVERAGE : MATCH_MIN_COVERAGE;
            // More path words shared means a more specific page; it outranks a short generic path.
            if (coverage >= MATCH_MIN_COVERAGE && pathCoverage >= pathMin) score = pathShared * 10 + coverage + pathCoverage;
        }
        if (score != null && (best == null || score > best)) best = score;
    }
    return best;
}

/**
 * The existing page an idea duplicates, or null.
 * Order: the same URL; the page Google already shows for the idea's target
 * search (spot 20 or better, 20+ impressions, on the site's own host, not a
 * utility or query-string URL); the most specific compatible page sharing
 * the idea's words; the page Google shows for a supporting search. The home
 * page only matches by URL.
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

    const site = siteFacts(pages);
    const places = new Set([...site.places, ...placesInText(`${idea.targetQuery}. ${idea.title}`, site.places)]);
    const facts = readIdea(idea, places, ignore);
    const view = { places: site.places, serviceDir: site.serviceDir };
    const readPage = (page: MatchablePage) => cachedPage(page, view, ignore);

    const byGsc = (query: string): PageMatch<P> | null => {
        const key = intentKey(query, ignore);
        if (!key) return null;
        const candidates = hits
            .filter(hit => (hit.key ?? intentKey(hit.query, ignore)) === key
                && !isHomePath(hit.pageUrl)
                && !isUtilityPage(hit.pageUrl)
                && (hit.position == null || hit.position <= GSC_MATCH_MAX_POSITION)
                && (hit.impressions == null || hit.impressions >= GSC_MATCH_MIN_IMPRESSIONS)
                && (site.hosts.size === 0 || site.hosts.has(bareHost(hit.pageUrl) ?? '')))
            .sort((a, b) => (b.impressions ?? 0) - (a.impressions ?? 0) || (a.position ?? 0) - (b.position ?? 0));
        for (const hit of candidates) {
            const crawled = pages.find(page => pageKey(page.normalizedUrl) === pageKey(hit.pageUrl)
                || urlPath(page.normalizedUrl) === urlPath(hit.pageUrl));
            const target: MatchablePage = crawled ?? { normalizedUrl: hit.pageUrl, h1s: [] };
            if (!compatible(facts, readPage(target))) continue;
            return crawled
                ? { page: crawled, url: crawled.normalizedUrl, via: 'gsc', query: hit.query }
                : { url: hit.pageUrl, via: 'gsc', query: hit.query };
        }
        return null;
    };

    const target = byGsc(idea.targetQuery);
    if (target) return target;

    let bestPage: P | null = null;
    let bestScore = -1;
    for (const page of pages) {
        const read = readPage(page);
        if (read.kind === 'home' || read.kind === 'utility' || !compatible(facts, read)) continue;
        const score = tokenScore(facts, read);
        if (score != null && score > bestScore) {
            bestScore = score;
            bestPage = page;
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
 * Keeps the first idea per search (intentKey) and drops a later idea that
 * matched the same page only when both have the same page type and at least
 * half their words overlap. Two different articles that both point at one
 * existing post are both kept.
 * Returns the index of the earlier idea each dropped idea duplicates.
 */
export function dedupeIdeas(
    ideas: ReadonlyArray<{ targetQuery: string; matchedUrl?: string | null; pageType?: string | null }>,
    ignore: ReadonlySet<string> = new Set(),
): { keep: number[]; duplicateOf: Map<number, number> } {
    const byIntent = new Map<string, number>();
    const byPage = new Map<string, number[]>();
    const keep: number[] = [];
    const duplicateOf = new Map<number, number>();
    const tokensOf = (index: number) => new Set(significantTokens(ideas[index].targetQuery, ignore));
    ideas.forEach((idea, index) => {
        const intent = intentKey(idea.targetQuery, ignore);
        const page = idea.matchedUrl?.trim() ? pageKey(idea.matchedUrl) : '';
        let earlier = intent ? byIntent.get(intent) : undefined;
        if (earlier == null && page) {
            const mine = tokensOf(index);
            earlier = (byPage.get(page) ?? []).find(other => {
                if ((ideas[other].pageType ?? '') !== (idea.pageType ?? '')) return false;
                const theirs = tokensOf(other);
                const shared = [...mine].filter(token => theirs.has(token)).length;
                const union = new Set([...mine, ...theirs]).size;
                return union > 0 && shared / union >= DEDUPE_MIN_OVERLAP;
            });
        }
        if (earlier != null) {
            duplicateOf.set(index, earlier);
            return;
        }
        if (intent) byIntent.set(intent, index);
        if (page) byPage.set(page, [...(byPage.get(page) ?? []), index]);
        keep.push(index);
    });
    return { keep, duplicateOf };
}
