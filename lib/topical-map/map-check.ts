/**
 * "What the map missed": a read-only quality check on the Review topic ideas
 * screen. It compares the map's ideas with the client's own Search Console
 * searches (already loaded for the review) and the counts the generator saved
 * in generation_metadata (duplicate_gate, page_mix).
 *
 * Pure functions. Maps made before those counts existed get what can be
 * worked out from the ideas and the searches, and say what is missing.
 */

import { ARTICLE_KINDS, ARTICLE_MAX_SHARE, PAGE_KIND_LABEL, PAGE_KINDS, pageKindOf, type PageKind } from './page-mix';
import {
    bareHost,
    brandTokens,
    GSC_MATCH_MAX_POSITION,
    intentKey,
    isHomePath,
    learnPlaces,
    MATCH_MIN_COVERAGE,
    pageKey,
    placesInText,
    readText,
    sameSet,
    significantTokens,
    type PlaceSet,
    type TextFacts,
} from './page-match';
import { evidenceFor, formatCount, pagePath, roundedPosition, type ReviewEvidence, type SearchGroup } from './review';
import type { MapRecordAction, PageType } from '../types';

/** Missed searches shown. */
export const MISSED_LIMIT = 10;
/** A search where one of your pages is already in spots 1 to 3 is not a gap. */
export const ALREADY_TOP_SPOT = 3;

export interface MapCheckIdea {
    id: string;
    title: string;
    targetQuery: string;
    action: MapRecordAction;
    matchedUrl?: string | null;
    pageType: PageType;
    contentCategory?: string;
}

interface StoredMix {
    kind: PageKind | null;
    seedOnly: boolean | null;
    demandQuery: string | null;
}

function object(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function count(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/** Per-idea page type, seed-only flag and cited search from generation_metadata.page_mix.records. */
export function readStoredMix(metadata: unknown): Map<string, StoredMix> {
    const out = new Map<string, StoredMix>();
    const records = object(object(object(metadata)?.page_mix)?.records);
    if (!records) return out;
    for (const [id, raw] of Object.entries(records)) {
        const entry = object(raw);
        if (!entry) continue;
        const kind = typeof entry.page_type === 'string' && (PAGE_KINDS as readonly string[]).includes(entry.page_type)
            ? entry.page_type as PageKind
            : null;
        out.set(id, {
            kind,
            seedOnly: typeof entry.seed_only === 'boolean' ? entry.seed_only : null,
            demandQuery: typeof entry.demand_query === 'string' && entry.demand_query.trim() ? entry.demand_query.trim() : null,
        });
    }
    return out;
}

/**
 * Repeat ideas removed before the map was saved: the page-mix check's
 * repeated main searches plus the duplicate gate's same-search or same-page
 * drops. The two run one after the other, so nothing is counted twice.
 * Null when the map saved neither count.
 */
export function repeatsRemoved(metadata: unknown): number | null {
    const meta = object(metadata);
    const mix = count(object(meta?.page_mix)?.dropped_duplicate_query);
    const gate = count(object(meta?.duplicate_gate)?.duplicate_ideas_dropped);
    if (mix == null && gate == null) return null;
    return (mix ?? 0) + (gate ?? 0);
}

function sharesIntent(searchTokens: readonly string[], tokens: readonly string[]): boolean {
    if (searchTokens.length === 0 || tokens.length === 0) return false;
    const own = new Set(tokens);
    const shared = searchTokens.filter(token => own.has(token)).length;
    return shared / searchTokens.length >= MATCH_MIN_COVERAGE && shared / tokens.length >= MATCH_MIN_COVERAGE;
}

const NO_IGNORE: ReadonlySet<string> = new Set();

/** Cities and counties named in the texts or by the URLs' city/county slugs, as PR 1's matcher learns them. */
export function knownPlaces(texts: ReadonlyArray<string>, urls: ReadonlyArray<string | null | undefined>): Set<string> {
    const out = learnPlaces(urls.filter((url): url is string => Boolean(url?.trim())).map(url => ({ normalizedUrl: url, h1s: [] })));
    for (const text of texts) for (const place of placesInText(text, out)) out.add(place);
    return out;
}

/** Same modifiers (commercial, pet, cost, DIY, putting green, playground), same "vs", same places. */
function sameScope(a: TextFacts, b: TextFacts): boolean {
    return sameSet(a.flags, b.flags) && a.comparison === b.comparison && sameSet(new Set(a.places), new Set(b.places));
}

/**
 * An idea covers a search when its main search, the search the generator
 * cited for it, or its title has the same intent: the same modifiers and
 * places (PR 1's rules, so "pet turf in Orange County" is not covered by
 * "artificial grass in Orange County"), and the same search key or at least
 * 75% of the significant words shared both ways. Google showing the idea's own
 * page for the search in spots 1 to 20 also counts, under the same rule for
 * the idea's main search. `places` adds known places (cities and counties)
 * to the ones found in these texts and URLs.
 */
export function ideaCoversSearch(
    idea: { title: string; targetQuery: string; demandQuery?: string | null; matchedUrl?: string | null },
    group: Pick<SearchGroup, 'query' | 'variants' | 'page' | 'pagePosition'>,
    places: PlaceSet = new Set(),
): boolean {
    const texts = [idea.targetQuery, idea.demandQuery ?? '', idea.title].filter(text => text.trim());
    const known = new Set([...places, ...knownPlaces([group.query, ...texts], [group.page, idea.matchedUrl])]);
    const search = readText(group.query, known, NO_IGNORE);
    const keys = new Set([group.query, ...group.variants].map(query => intentKey(query)));
    const searchTokens = significantTokens(group.query);
    for (const text of texts) {
        if (!sameScope(search, readText(text, known, NO_IGNORE))) continue;
        if (keys.has(intentKey(text)) || sharesIntent(searchTokens, significantTokens(text))) return true;
    }
    const spot = group.pagePosition ?? Number.POSITIVE_INFINITY;
    return Boolean(
        idea.matchedUrl?.trim() && group.page && spot <= GSC_MATCH_MAX_POSITION
        && pageKey(idea.matchedUrl) === pageKey(group.page)
        && sameScope(search, readText(idea.targetQuery, known, NO_IGNORE)),
    );
}

/**
 * The site's own host, without "www.": the most common host among the
 * ideas' matched pages and the searches' pages. The review loads no site URL,
 * so it is worked out from these. Pages on any other host (a staging copy,
 * for example) are not shown.
 */
export function productionHost(urls: ReadonlyArray<string | null | undefined>): string | null {
    const counts = new Map<string, number>();
    for (const url of urls) {
        const host = url ? bareHost(url) : null;
        if (host) counts.set(host, (counts.get(host) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
}

export interface MissedSearch {
    query: string;
    impressions: number;
    position: number | null;
    /** Your page Google showed most for it, when known. */
    page: string | null;
}

export interface PageMixLine {
    label: string;
    count: number;
}

export interface MapCheck {
    /** False when Search Console is not connected, so missed searches cannot be checked. */
    connected: boolean;
    days: number;
    /** Biggest first, at most MISSED_LIMIT. */
    missed: MissedSearch[];
    /** Every missed search among the searches checked. */
    missedTotal: number;
    /** Searches checked (after leaving out brand-name and already-top-3 searches). */
    searchesChecked: number;
    ideas: number;
    repeatsRemoved: number | null;
    /** Ideas matched to a page already on the site (update it, or it is already live). */
    existingPages: number;
    /** 'map': flags saved when the map was made. 'recent': worked out from the review's own window. Null when neither is possible. */
    seedOnly: { count: number; of: number; source: 'map' | 'recent' } | null;
    articles: number;
    mix: PageMixLine[];
}

/** Article or not for every idea; a fine label only when the map saved one. */
function ideaKind(idea: MapCheckIdea, stored: StoredMix | undefined): { article: boolean; label: string } {
    const labelled = stored?.kind
        ?? (PAGE_KINDS.find(kind => PAGE_KIND_LABEL[kind] === idea.contentCategory?.trim()) ?? null);
    if (labelled) return { article: ARTICLE_KINDS.has(labelled), label: PAGE_KIND_LABEL[labelled] };
    const article = ARTICLE_KINDS.has(pageKindOf(idea.pageType));
    return { article, label: article ? 'Article' : 'Service or location page' };
}

export function mapCheck(input: {
    ideas: ReadonlyArray<MapCheckIdea>;
    evidence: ReviewEvidence;
    generationMetadata?: unknown;
    brandName?: string;
    limit?: number;
}): MapCheck {
    const { ideas, evidence } = input;
    const stored = readStoredMix(input.generationMetadata);
    const brand = [...brandTokens(input.brandName)];
    const isBrandSearch = (query: string) => {
        if (brand.length === 0) return false;
        const tokens = new Set(significantTokens(query));
        return brand.every(token => tokens.has(token));
    };

    const covering = ideas.map(idea => ({ ...idea, demandQuery: stored.get(idea.id)?.demandQuery ?? null }));
    const groups = evidence.connected ? evidence.groups ?? [] : [];
    const host = productionHost([...ideas.map(idea => idea.matchedUrl), ...groups.map(group => group.page)]);
    const places = knownPlaces(
        [...groups.map(group => group.query), ...covering.flatMap(idea => [idea.targetQuery, idea.title, idea.demandQuery ?? ''])],
        [...groups.map(group => group.page), ...ideas.map(idea => idea.matchedUrl)],
    );
    const missed: MissedSearch[] = [];
    let checked = 0;
    for (const raw of groups) {
        // A page on another host (a staging copy) is not shown and does not count.
        const group = raw.page && host && bareHost(raw.page) !== host ? { ...raw, page: null, pagePosition: null } : raw;
        if (!(group.impressions > 0) || significantTokens(group.query).length === 0 || isBrandSearch(group.query)) continue;
        const spot = roundedPosition(group.pagePosition);
        if (group.page && !isHomePath(group.page) && spot != null && spot <= ALREADY_TOP_SPOT) continue;
        checked += 1;
        if (covering.some(idea => ideaCoversSearch(idea, group, places))) continue;
        missed.push({ query: group.query, impressions: group.impressions, position: group.position, page: group.page });
    }
    missed.sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query));

    const flagged = ideas.filter(idea => typeof stored.get(idea.id)?.seedOnly === 'boolean');
    let seedOnly: MapCheck['seedOnly'] = null;
    if (flagged.length > 0) {
        seedOnly = { count: flagged.filter(idea => stored.get(idea.id)?.seedOnly).length, of: flagged.length, source: 'map' };
    } else if (evidence.connected && evidence.days > 0 && ideas.length > 0) {
        seedOnly = { count: ideas.filter(idea => !evidenceFor(evidence, idea.targetQuery)).length, of: ideas.length, source: 'recent' };
    }

    const lines = new Map<string, number>();
    let articles = 0;
    for (const idea of ideas) {
        const kind = ideaKind(idea, stored.get(idea.id));
        if (kind.article) articles += 1;
        lines.set(kind.label, (lines.get(kind.label) ?? 0) + 1);
    }

    return {
        connected: evidence.connected,
        days: evidence.days,
        missed: missed.slice(0, input.limit ?? MISSED_LIMIT),
        missedTotal: missed.length,
        searchesChecked: checked,
        ideas: ideas.length,
        repeatsRemoved: repeatsRemoved(input.generationMetadata),
        existingPages: ideas.filter(idea => idea.action !== 'create' && Boolean(idea.matchedUrl?.trim())).length,
        seedOnly,
        articles,
        mix: [...lines].map(([label, value]) => ({ label, count: value }))
            .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    };
}

// ─── Client-facing copy ─────────────────────────────────────────────────────

function plural(value: number, one: string, many: string): string {
    return `${formatCount(value)} ${value === 1 ? one : many}`;
}

export function lastDays(days: number): string {
    return days === 1 ? 'in the last day' : `in the last ${formatCount(days)} days`;
}

export const MAP_CHECK_TITLE = 'What the map missed';

/** One line for the closed panel. */
export function mapCheckSummary(check: MapCheck): string {
    const parts: string[] = [];
    if (check.connected && check.days > 0) parts.push(`${plural(check.missedTotal, 'search', 'searches')} with no idea`);
    if (check.repeatsRemoved != null) parts.push(`${plural(check.repeatsRemoved, 'repeat idea', 'repeat ideas')} removed`);
    if (check.ideas > 0) parts.push(`${formatCount(check.articles)} of ${formatCount(check.ideas)} ideas are articles`);
    return parts.join(' · ');
}

export function missedIntro(check: MapCheck): string {
    if (!check.connected) return 'Google Search Console is not connected, so we cannot check which searches the map missed.';
    if (check.days === 0) return 'Google Search Console has no stored days yet, so we cannot check which searches the map missed.';
    return `Searches where your site showed up in Google ${lastDays(check.days)} that no idea in this map covers, biggest first. Searches for your business name, and searches where one of your pages is already in the top 3, are left out.`;
}

export function missedEmpty(check: MapCheck): string {
    return check.searchesChecked === 0
        ? `Your site did not show up for any other searches ${lastDays(check.days)}.`
        : `Every one of your top ${plural(check.searchesChecked, 'search', 'searches')} has an idea in this map.`;
}

/** "Showed up 4,498 times in Google". */
export function missedTimes(search: MissedSearch): string {
    return `Showed up ${plural(search.impressions, 'time', 'times')} in Google`;
}

/** "Spot 52 in Google, mostly /hardscape/" or "Spot 52 in Google, mostly your home page". */
export function missedWhere(search: MissedSearch): string | null {
    const spot = roundedPosition(search.position);
    const parts: string[] = [];
    if (spot != null) parts.push(`Spot ${spot} in Google`);
    if (search.page) parts.push(isHomePath(search.page) ? 'mostly your home page' : `mostly ${pagePath(search.page)}`);
    if (parts.length === 0) return null;
    const text = parts.join(', ');
    return `${text[0].toUpperCase()}${text.slice(1)}`;
}

export function missedMore(check: MapCheck): string | null {
    return check.missedTotal > check.missed.length
        ? `Showing the top ${check.missed.length} of ${formatCount(check.missedTotal)}.`
        : null;
}

export interface CheckLine {
    label: string;
    detail: string;
}

export function repeatsLine(check: MapCheck): CheckLine {
    if (check.repeatsRemoved == null) {
        return { label: 'Repeat ideas removed: not recorded', detail: 'This map was made before we started counting them.' };
    }
    return {
        label: `${plural(check.repeatsRemoved, 'repeat idea', 'repeat ideas')} removed before saving`,
        detail: 'Each had the same main search, or the same page, as another idea.',
    };
}

export function existingPagesLine(check: MapCheck): CheckLine {
    return {
        label: `${plural(check.existingPages, 'idea matches a page', 'ideas match pages')} you already have`,        detail: 'They update that page, or it is already live, instead of adding a new one.',
    };
}

export function seedOnlyLine(check: MapCheck): CheckLine | null {
    const seed = check.seedOnly;
    if (!seed) return null;
    if (seed.source === 'map') {
        return {
            label: `${formatCount(seed.count)} of ${plural(seed.of, 'idea', 'ideas')} ${seed.count === 1 ? 'has' : 'have'} no Google searches behind ${seed.count === 1 ? 'it' : 'them'}`,
            detail: 'They came only from the starting keywords, not from searches your site already shows up for.',
        };
    }
    return {
        label: `${formatCount(seed.count)} of ${plural(seed.of, 'idea', 'ideas')} got no Google searches ${lastDays(check.days)}`,
        detail: 'Checked against each idea’s main search. This map was made before we saved this check.',
    };
}

export function mixLine(check: MapCheck): CheckLine | null {
    if (check.ideas === 0) return null;
    const share = Math.round((check.articles / check.ideas) * 100);
    return {
        label: `${formatCount(check.articles)} of ${plural(check.ideas, 'idea', 'ideas')} ${check.articles === 1 ? 'is an article' : 'are articles'} (${share}%)`,
        detail: `The rest are service and location pages. We aim for no more than ${Math.round(ARTICLE_MAX_SHARE * 100)}% articles.`,
    };
}
