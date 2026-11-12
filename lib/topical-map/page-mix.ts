/**
 * Page mix for generated topic maps: the fine-grained page types the
 * generator uses, how they are stored, and a check that runs on the
 * generator's output before anything is saved.
 *
 * The check never fails a map. It drops repeated primary searches, re-marks
 * ideas whose cited demand is not in Search Console as seed-only, and trims
 * the weakest articles and seed-only ideas until both caps hold.
 *
 * Pure functions.
 */

import type { PageType } from '../types';
import { clusterKey, type ArchitectGscCluster } from './architect-gsc';
import {
    dedupeIdeas,
    intentKey,
    pageKindOf as sitePageKind,
    siteFacts,
    significantTokens,
    urlPath,
    type MatchablePage,
} from './page-match';

export const PAGE_KINDS = [
    'service', 'service_city', 'city', 'sub_service', 'cost', 'comparison', 'faq', 'local_resource',
] as const;
export type PageKind = typeof PAGE_KINDS[number];

/** Articles: everything that is not a money page. */
export const ARTICLE_KINDS: ReadonlySet<PageKind> = new Set(['cost', 'comparison', 'faq', 'local_resource']);
export const ARTICLE_MAX_SHARE = 0.3;
export const SEED_ONLY_MAX_SHARE = 0.2;
/** A small map still keeps this many articles / seed-only ideas when the share math rounds to 0. */
export const ARTICLE_MIN_ALLOWED = 2;
export const SEED_ONLY_MIN_ALLOWED = 1;
export const SUPPORTING_QUERIES_MAX = 10;
/** Share of a service name's words an idea must carry to count as that service. */
export const SERVICE_NAME_MIN_COVERAGE = 0.6;

/**
 * topical_map_records.page_type for each kind (the DB check allows no new
 * values). A buyer question is stored as a blog post: PR 1's matcher only
 * meets page_type 'faq' with the site's FAQ page. See storedPageType.
 */
export const STORED_PAGE_TYPE: Record<PageKind, PageType> = {
    service: 'service',
    sub_service: 'service',
    service_city: 'landing',
    city: 'city',
    cost: 'guide',
    comparison: 'comparison',
    faq: 'blog_post',
    local_resource: 'resource_center',
};

/** The stored page type. A buyer-question idea that is itself an FAQ page ("Artificial Grass FAQ") is stored as 'faq'. */
export function storedPageType(kind: PageKind, text = ''): PageType {
    if (kind === 'faq' && /\bfaqs?\b/i.test(text)) return 'faq';
    return STORED_PAGE_TYPE[kind];
}

/** Plain-English label, stored in content_category so the kind stays readable on the record. */
export const PAGE_KIND_LABEL: Record<PageKind, string> = {
    service: 'Service',
    sub_service: 'Specialty service',
    service_city: 'Service in a city',
    city: 'City hub',
    cost: 'Cost guide',
    comparison: 'Comparison',
    faq: 'Buyer question',
    local_resource: 'Local permits and rebates',
};

/** Older or loose page_type values the model may still return. 'article' is sorted by its words (articleKind). */
const KIND_ALIASES: Readonly<Record<string, PageKind | 'article'>> = {
    blog_post: 'article',
    guide: 'article',
    article: 'article',
    knowledge_base: 'article',
    case_study: 'article',
    pillar: 'service',
    landing: 'service',
    product: 'service',
    collection: 'service',
    homepage: 'service',
    subservice: 'sub_service',
    service_area: 'service_city',
    location: 'service_city',
    city_service: 'service_city',
    city_hub: 'city',
    pricing: 'cost',
    vs: 'comparison',
    question: 'faq',
    faq_question: 'faq',
    resource_center: 'local_resource',
    resource: 'local_resource',
};

/** The article kind its words point to: X vs Y, permits and rebates, cost, else a buyer question. */
function articleKind(text: string): PageKind {
    if (/\b(vs\.?|versus)\b/i.test(text)) return 'comparison';
    if (/\b(rebates?|permits?|ordinances?|regulations?)\b/i.test(text)) return 'local_resource';
    if (/\b(costs?|prices?|pricing)\b/i.test(text)) return 'cost';
    return 'faq';
}

/**
 * The fine-grained kind for a raw page_type. blog_post, guide and anything
 * unrecognised count as articles (held to the article cap) and are sorted by
 * `text` (title and target search), when given.
 */
export function pageKindOf(raw: unknown, text = ''): PageKind {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[\s/-]+/g, '_') : '';
    if ((PAGE_KINDS as readonly string[]).includes(value)) return value as PageKind;
    const alias = KIND_ALIASES[value] ?? 'article';
    return alias === 'article' ? articleKind(text) : alias;
}

/**
 * Service names from the site's own service pages, as PR 1's matcher reads
 * them (e.g. /our-services/masonry-contractors/ gives "masonry contractors").
 * The URL slug is used, not the title, so cities and the brand stay out.
 */
export function servicePageNames(pages: readonly MatchablePage[], ignore: ReadonlySet<string> = new Set()): string[] {
    const site = siteFacts(pages);
    return pages
        .filter(page => sitePageKind(page, site, ignore) === 'service')
        .map(page => (urlPath(page.normalizedUrl).split('/').filter(Boolean).pop() ?? '').replace(/[-_]+/g, ' ').trim())
        .filter(Boolean);
}

/** Service names split into word lists ("pavers/hardscape" is two services). */
function servicePhrases(services: readonly string[], ignore: ReadonlySet<string>): string[][] {
    return services
        .flatMap(service => service.split(/[/,;&+]|\band\b/i))
        .map(part => significantTokens(part, ignore))
        .filter(tokens => tokens.length > 0);
}

/** True when the text names one of the services (most of its words, so "outdoor living" is not "outdoor kitchen"). */
export function namesService(text: string, phrases: readonly string[][], ignore: ReadonlySet<string> = new Set()): boolean {
    const tokens = new Set(significantTokens(text, ignore));
    return phrases.some(phrase =>
        phrase.filter(token => tokens.has(token)).length / phrase.length >= SERVICE_NAME_MIN_COVERAGE - 1e-9);
}

export interface MixInput {
    pageType?: unknown;
    targetQuery: string;
    /** Used to sort articles by kind and to recognise the business's services. */
    title?: string;
    supportingQueries?: readonly string[];
    /** The Search Console search the model cites, if any. */
    demandQuery?: string | null;
    buildPhase?: number;
    /** Index of the parent idea in the same list, if any. */
    parentIndex?: number | null;
}

export interface PageMixOptions {
    /**
     * Services the business sells (profile focus topics and the site's own
     * service pages). A seed-only service page for one of them is kept: the
     * seed-only cap only trims articles and long-tail ideas.
     */
    services?: readonly string[];
}

export interface MixedIdea {
    /** Position in the input list. */
    index: number;
    kind: PageKind;
    storedType: PageType;
    label: string;
    /** True when no Search Console search backs the idea. */
    seedOnly: boolean;
    /** Measured demand, from the grouped Search Console searches (never the model's numbers). */
    demand: { query: string; impressions: number } | null;
    /** De-duplicated, primary search removed, at most SUPPORTING_QUERIES_MAX. */
    supportingQueries: string[];
    /** A service or specialty page for a service the business sells. Never trimmed by the seed-only cap. */
    profileService: boolean;
    /** Nearest kept ancestor (a dropped duplicate's kept twin counts), or null for a top-level idea. */
    parentIndex: number | null;
}

export type DropReason = 'duplicate_query' | 'article_cap' | 'seed_only_cap';

/** Counts stored in topical_maps.generation_metadata.page_mix. */
export interface PageMixSummary {
    ideas_returned: number;
    kept: number;
    /** Kept ideas per fine-grained kind. */
    by_type: Record<PageKind, number>;
    articles: number;
    seed_only: number;
    /** Kept seed-only ideas that are service pages for a service the business sells (exempt from the cap). */
    seed_only_profile_services: number;
    /** Kept ideas whose parent was dropped and that now sit under the nearest kept ancestor (or at the top). */
    reattached_children: number;
    /** Ideas whose cited search had no Search Console data, re-marked as seed-only. */
    relabeled_seed_only: number;
    dropped_duplicate_query: number;
    dropped_article_cap: number;
    dropped_seed_only_cap: number;
    /** False when there was no Search Console data, so every idea is seed-only and the cap cannot apply. */
    seed_only_cap_applied: boolean;
}

export interface PageMixResult {
    /** Kept ideas, in input order. */
    kept: MixedIdea[];
    dropped: Array<{ index: number; reason: DropReason }>;
    summary: PageMixSummary;
}

/**
 * Most ideas of one group allowed next to `others` ideas so the group stays
 * within `share` of the total, and never fewer than `floor`.
 */
export function maxWithinShare(others: number, share: number, floor = 0): number {
    return Math.max(floor, Math.floor((share * others) / (1 - share) + 1e-9));
}

/**
 * Enforce the page mix on the generator's ideas:
 * 1. A primary search (by intent) appears once; the first idea keeps it.
 * 2. Demand is checked against Search Console: the cited search, the primary
 *    search or a supporting search must match a grouped search with
 *    impressions, else the idea is seed-only.
 * 3. Articles are trimmed to at most 30% and seed-only ideas to at most 20%,
 *    weakest first (seed-only, then fewer impressions, then later build phase,
 *    then later in the list), never below ARTICLE_MIN_ALLOWED /
 *    SEED_ONLY_MIN_ALLOWED. Service pages for a service the business sells
 *    are exempt from the seed-only cap. A cap is skipped when it would leave
 *    nothing to measure against (no money pages, or no Search Console data).
 * 4. A kept idea whose parent was dropped moves to the nearest kept ancestor.
 */
export function validatePageMix(
    ideas: readonly MixInput[],
    clusters: readonly ArchitectGscCluster[],
    ignore: ReadonlySet<string> = new Set(),
    options: PageMixOptions = {},
): PageMixResult {
    const byKey = new Map(clusters.map(cluster => [cluster.key, cluster]));
    const phrases = servicePhrases(options.services ?? [], ignore);
    const dropped: PageMixResult['dropped'] = [];
    let relabeled = 0;

    const { duplicateOf } = dedupeIdeas(ideas.map(idea => ({ targetQuery: idea.targetQuery })), ignore);
    for (const index of duplicateOf.keys()) dropped.push({ index, reason: 'duplicate_query' });

    let kept: MixedIdea[] = [];
    ideas.forEach((idea, index) => {
        if (duplicateOf.has(index)) return;
        const text = `${idea.title ?? ''} ${idea.targetQuery}`;
        const kind = pageKindOf(idea.pageType, text);
        const primaryKey = intentKey(idea.targetQuery, ignore);
        const supporting: string[] = [];
        const seen = new Set([primaryKey]);
        for (const raw of idea.supportingQueries ?? []) {
            const query = raw.trim();
            const key = intentKey(query, ignore);
            if (!query || seen.has(key)) continue;
            seen.add(key);
            supporting.push(query);
            if (supporting.length === SUPPORTING_QUERIES_MAX) break;
        }
        // Demand is looked up by search group, so "turf installation temecula" finds "turf temecula".
        const cited = idea.demandQuery?.trim() ? byKey.get(clusterKey(idea.demandQuery, ignore)) : undefined;
        const found = cited
            ?? byKey.get(clusterKey(idea.targetQuery, ignore))
            ?? supporting.map(query => byKey.get(clusterKey(query, ignore))).find(Boolean);
        if (idea.demandQuery?.trim() && !found) relabeled += 1;
        kept.push({
            index,
            kind,
            storedType: storedPageType(kind, text),
            label: PAGE_KIND_LABEL[kind],
            seedOnly: !found,
            demand: found ? { query: found.query, impressions: found.impressions } : null,
            supportingQueries: supporting,
            profileService: (kind === 'service' || kind === 'sub_service') && namesService(text, phrases, ignore),
            parentIndex: null,
        });
    });

    const phase = (item: MixedIdea) => Number(ideas[item.index].buildPhase) || 1;
    // Weakest first.
    const weakest = (a: MixedIdea, b: MixedIdea) =>
        Number(b.seedOnly) - Number(a.seedOnly)
        || (a.demand?.impressions ?? 0) - (b.demand?.impressions ?? 0)
        || phase(b) - phase(a)
        || b.index - a.index;
    const trim = (group: MixedIdea[], allowed: number, reason: DropReason): boolean => {
        if (group.length <= allowed) return false;
        const drop = new Set([...group].sort(weakest).slice(0, group.length - allowed));
        kept = kept.filter(item => !drop.has(item));
        for (const item of drop) dropped.push({ index: item.index, reason });
        return true;
    };

    const seedCapApplies = clusters.length > 0;
    for (let changed = true; changed;) {
        changed = false;
        const articles = kept.filter(item => ARTICLE_KINDS.has(item.kind));
        const moneyPages = kept.length - articles.length;
        if (moneyPages > 0) {
            changed = trim(articles, maxWithinShare(moneyPages, ARTICLE_MAX_SHARE, ARTICLE_MIN_ALLOWED), 'article_cap') || changed;
        }
        if (seedCapApplies) {
            // Seed-only articles and long-tail ideas; service pages for services they sell stay.
            const seedOnly = kept.filter(item => item.seedOnly && !item.profileService);
            const others = kept.length - seedOnly.length;
            if (others > 0) {
                changed = trim(seedOnly, maxWithinShare(others, SEED_ONLY_MAX_SHARE, SEED_ONLY_MIN_ALLOWED), 'seed_only_cap') || changed;
            }
        }
    }

    // Re-attach children of dropped ideas: a dropped duplicate hands over to
    // the idea it duplicates, any other dropped idea to its own parent.
    const keptIndexes = new Set(kept.map(item => item.index));
    const keptAncestor = (start: number): number | null => {
        const seen = new Set<number>();
        let at: number | null | undefined = start;
        while (at != null && Number.isInteger(at) && at >= 0 && at < ideas.length && !seen.has(at)) {
            if (keptIndexes.has(at)) return at;
            seen.add(at);
            at = duplicateOf.get(at) ?? ideas[at].parentIndex;
        }
        return null;
    };
    let reattached = 0;
    for (const item of kept) {
        const parent = ideas[item.index].parentIndex;
        if (parent == null || parent === item.index) continue;
        const resolved = keptAncestor(parent);
        item.parentIndex = resolved === item.index ? null : resolved;
        if (item.parentIndex !== parent) reattached += 1;
    }

    const byType = Object.fromEntries(PAGE_KINDS.map(kind => [kind, 0])) as Record<PageKind, number>;
    for (const item of kept) byType[item.kind] += 1;
    const count = (reason: DropReason) => dropped.filter(item => item.reason === reason).length;
    dropped.sort((a, b) => a.index - b.index);

    return {
        kept,
        dropped,
        summary: {
            ideas_returned: ideas.length,
            kept: kept.length,
            by_type: byType,
            articles: kept.filter(item => ARTICLE_KINDS.has(item.kind)).length,
            seed_only: kept.filter(item => item.seedOnly).length,
            seed_only_profile_services: kept.filter(item => item.seedOnly && item.profileService).length,
            reattached_children: reattached,
            relabeled_seed_only: relabeled,
            dropped_duplicate_query: count('duplicate_query'),
            dropped_article_cap: count('article_cap'),
            dropped_seed_only_cap: count('seed_only_cap'),
            seed_only_cap_applied: seedCapApplies,
        },
    };
}
