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
import { dedupeIdeas, intentKey } from './page-match';

export const PAGE_KINDS = [
    'service', 'service_city', 'city', 'sub_service', 'cost', 'comparison', 'faq', 'local_resource',
] as const;
export type PageKind = typeof PAGE_KINDS[number];

/** Articles: everything that is not a money page. */
export const ARTICLE_KINDS: ReadonlySet<PageKind> = new Set(['cost', 'comparison', 'faq', 'local_resource']);
export const ARTICLE_MAX_SHARE = 0.3;
export const SEED_ONLY_MAX_SHARE = 0.2;
export const SUPPORTING_QUERIES_MAX = 10;

/** topical_map_records.page_type for each kind (the DB check allows no new values). */
export const STORED_PAGE_TYPE: Record<PageKind, PageType> = {
    service: 'service',
    sub_service: 'service',
    service_city: 'landing',
    city: 'city',
    cost: 'guide',
    comparison: 'comparison',
    faq: 'faq',
    local_resource: 'resource_center',
};

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

/** Older or loose page_type values the model may still return. */
const KIND_ALIASES: Readonly<Record<string, PageKind>> = {
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

/** The fine-grained kind for a raw page_type. Anything unrecognised counts as an article (buyer question), so it is held to the article cap. */
export function pageKindOf(raw: unknown): PageKind {
    const value = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[\s/-]+/g, '_') : '';
    if ((PAGE_KINDS as readonly string[]).includes(value)) return value as PageKind;
    return KIND_ALIASES[value] ?? 'faq';
}

export interface MixInput {
    pageType?: unknown;
    targetQuery: string;
    supportingQueries?: readonly string[];
    /** The Search Console search the model cites, if any. */
    demandQuery?: string | null;
    buildPhase?: number;
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

/** Most ideas of one group allowed next to `others` ideas so the group stays within `share` of the total. */
export function maxWithinShare(others: number, share: number): number {
    return Math.floor((share * others) / (1 - share) + 1e-9);
}

/**
 * Enforce the page mix on the generator's ideas:
 * 1. A primary search (by intent) appears once; the first idea keeps it.
 * 2. Demand is checked against Search Console: the cited search, the primary
 *    search or a supporting search must match a grouped search with
 *    impressions, else the idea is seed-only.
 * 3. Articles are trimmed to at most 30% and seed-only ideas to at most 20%,
 *    weakest first (seed-only, then fewer impressions, then later build phase,
 *    then later in the list). A cap is skipped when it would leave nothing to
 *    measure against (no money pages, or no Search Console data).
 */
export function validatePageMix(
    ideas: readonly MixInput[],
    clusters: readonly ArchitectGscCluster[],
    ignore: ReadonlySet<string> = new Set(),
): PageMixResult {
    const byKey = new Map(clusters.map(cluster => [cluster.key, cluster]));
    const dropped: PageMixResult['dropped'] = [];
    let relabeled = 0;

    const { duplicateOf } = dedupeIdeas(ideas.map(idea => ({ targetQuery: idea.targetQuery })), ignore);
    for (const index of duplicateOf.keys()) dropped.push({ index, reason: 'duplicate_query' });

    let kept: MixedIdea[] = [];
    ideas.forEach((idea, index) => {
        if (duplicateOf.has(index)) return;
        const kind = pageKindOf(idea.pageType);
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
            storedType: STORED_PAGE_TYPE[kind],
            label: PAGE_KIND_LABEL[kind],
            seedOnly: !found,
            demand: found ? { query: found.query, impressions: found.impressions } : null,
            supportingQueries: supporting,
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
        if (moneyPages > 0) changed = trim(articles, maxWithinShare(moneyPages, ARTICLE_MAX_SHARE), 'article_cap') || changed;
        if (seedCapApplies) {
            const seedOnly = kept.filter(item => item.seedOnly);
            const cited = kept.length - seedOnly.length;
            if (cited > 0) changed = trim(seedOnly, maxWithinShare(cited, SEED_ONLY_MAX_SHARE), 'seed_only_cap') || changed;
        }
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
            relabeled_seed_only: relabeled,
            dropped_duplicate_query: count('duplicate_query'),
            dropped_article_cap: count('article_cap'),
            dropped_seed_only_cap: count('seed_only_cap'),
            seed_only_cap_applied: seedCapApplies,
        },
    };
}
