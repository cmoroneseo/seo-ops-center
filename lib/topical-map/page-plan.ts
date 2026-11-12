/**
 * One page, one idea, and the business's own service pages first. Runs on the
 * generator's ideas after the page-mix check, before anything is saved.
 *
 * 1. Every idea is matched to the site's pages (reconcileRecord).
 * 2. Every live service page whose service has its own Search Console demand
 *    gets an idea: the generator's idea for that page, else a Refresh added
 *    here, aimed at the service's top search.
 * 3. Ideas on the same existing page become one: the idea with the most
 *    demand (else the earliest) stays, the others' searches become its
 *    supporting searches and their children move to it.
 * 4. A new service-in-a-city or city page needs its own search with demand
 *    (OWN_DEMAND_MIN_IMPRESSIONS). Without it the idea folds into the idea
 *    for that place's existing page, or is dropped when there is none.
 * 5. A service idea picks up narrower wordings of its service as supporting
 *    searches ("custom hardscapes" for hardscaping services).
 * 6. In each group, ideas for live service pages come first (build phase 1),
 *    then other service ideas, then the rest in the generator's order.
 *
 * Pure functions.
 */

import { clusterKey, type ArchitectGscCluster } from './architect-gsc';
import {
    BROAD_TOKENS,
    ideaKind,
    intentKey,
    pageKey,
    pageKindOf,
    placePageFor,
    placesInText,
    readText,
    sameSet,
    significantTokens,
    siteFacts,
} from './page-match';
import { PAGE_KIND_LABEL, servicePageName, type MixedIdea } from './page-mix';
import {
    reconcileRecord,
    type GscQueryEvidence,
    type ReconcileContext,
    type ReconciliationPage,
    type ReconciliationResult,
} from './reconcile';

/**
 * Search Console impressions (over the stored window, up to 90 days) a search
 * group needs to justify its own page: a new city page, or a service page that
 * must be on the map. Below it the search is a supporting search at most.
 */
export const OWN_DEMAND_MIN_IMPRESSIONS = 30;

export interface PlanInput<R> {
    /** The generator's record. */
    rec: R;
    /** Its page-mix result. */
    mix: MixedIdea;
    /** Its group (silo) position. */
    silo: number;
    title: string;
    buildPhase: number;
    suggestedUrl?: string;
}

export interface PlannedIdea<R> {
    /** The generator's record, or null for a service page added here. */
    rec: R | null;
    /**
     * Page-mix result. targetQuery, supportingQueries and parentIndex are final
     * here; parentIndex is the `mix.index` of another planned idea. Added
     * service pages get indexes past the generator's.
     */
    mix: MixedIdea;
    silo: number;
    title: string;
    buildPhase: number;
    reconciled: ReconciliationResult;
}

/** Counts stored in topical_maps.generation_metadata.page_plan. */
export interface PagePlanSummary {
    /** Ideas merged into another idea on the same existing page. */
    merged_same_page: number;
    /** New city ideas without their own searches, folded into the idea for that place's page. */
    folded_local: number;
    /** New city ideas without their own searches and no idea for that place's page: left out. */
    dropped_local: number;
    /** Live service pages with searches and no idea, added as Refresh ideas. */
    service_pages_added: number;
}

export interface PagePlan<R> {
    /** Kept ideas per group, in saving order. */
    silos: PlannedIdea<R>[][];
    /** The page match of every generator idea, in input order (for the duplicate-gate counts). */
    reconciled: ReconciliationResult[];
    summary: PagePlanSummary;
}

/** Queries de-duplicated by search (intentKey), skipping any already in `exclude`. */
function uniqueQueries(queries: readonly string[], exclude: readonly string[], ignore: ReadonlySet<string>): string[] {
    const seen = new Set(exclude.map(query => intentKey(query, ignore)));
    const out: string[] = [];
    for (const raw of queries) {
        const query = raw.trim();
        const key = intentKey(query, ignore);
        if (!query || seen.has(key)) continue;
        seen.add(key);
        out.push(query);
    }
    return out;
}

/** The page title without the brand tail ("Pet Turf Installation in Southern California | Ecoworkz"). */
function pageTitle(page: ReconciliationPage, fallback: string): string {
    const title = (page.title ?? '').split(/\s+[|–—]\s+/)[0].trim();
    return title || page.h1s[0]?.trim() || fallback.replace(/\b\w/g, letter => letter.toUpperCase());
}

const needsWork = (result: ReconciliationResult) => result.action === 'improve' || result.action === 'replace';

export function planPages<R>(input: {
    ideas: readonly PlanInput<R>[];
    pages: ReconciliationPage[];
    gscEvidence: GscQueryEvidence[];
    clusters: readonly ArchitectGscCluster[];
    siloNames: readonly string[];
    ctx: ReconcileContext;
}): PagePlan<R> {
    const { pages, gscEvidence, clusters, ctx } = input;
    const ignore = ctx.ignoreTokens ?? new Set<string>();
    const byKey = new Map(clusters.map(cluster => [cluster.key, cluster]));
    const urlKey = (item: PlannedIdea<R>) => (item.reconciled.matchedUrl ? pageKey(item.reconciled.matchedUrl) : null);
    const reconcile = (mix: MixedIdea, title: string, suggestedUrl?: string) => reconcileRecord(
        { targetQuery: mix.targetQuery, title, suggestedUrl, supportingQueries: mix.supportingQueries, pageType: mix.storedType },
        pages, gscEvidence, ctx,
    );

    // 1. Match every idea.
    const items: PlannedIdea<R>[] = input.ideas.map(idea => {
        const mix = { ...idea.mix, supportingQueries: [...idea.mix.supportingQueries] };
        return { rec: idea.rec, mix, silo: idea.silo, title: idea.title, buildPhase: idea.buildPhase, reconciled: reconcile(mix, idea.title, idea.suggestedUrl) };
    });
    const reconciled = items.map(item => item.reconciled);
    const originalParent = new Map(items.map(item => [item, item.mix.parentIndex]));

    // 2. Live service pages with their own demand.
    const site = siteFacts(pages);
    const servicePages = pages.flatMap(page => {
        if (pageKindOf(page, site, ignore) !== 'service') return [];
        const name = servicePageName(page);
        const cluster = name ? byKey.get(clusterKey(name, ignore)) : undefined;
        return cluster && cluster.impressions >= OWN_DEMAND_MIN_IMPRESSIONS ? [{ page, name, cluster }] : [];
    });
    const servicePageKeys = new Set(servicePages.map(({ page }) => pageKey(page.normalizedUrl)));
    let nextIndex = Math.max(-1, ...items.map(item => item.mix.index)) + 1;
    let added = 0;
    for (const { page, name, cluster } of servicePages) {
        if (input.siloNames.length === 0) break;
        const key = pageKey(page.normalizedUrl);
        if (items.some(item => urlKey(item) === key)) continue;
        // Another idea already aims at that search: leave it to that idea.
        if (items.some(item => intentKey(item.mix.targetQuery, ignore) === intentKey(cluster.query, ignore))) continue;
        const title = pageTitle(page, name);
        const mix: MixedIdea = {
            index: nextIndex++,
            targetQuery: cluster.query,
            kind: 'service',
            storedType: 'service',
            label: PAGE_KIND_LABEL.service,
            seedOnly: false,
            demand: { query: cluster.query, impressions: cluster.impressions },
            supportingQueries: uniqueQueries(cluster.variants, [cluster.query], ignore),
            profileService: true,
            parentIndex: null,
        };
        items.push({ rec: null, mix, silo: closestSilo(name, input.siloNames, items, ignore), title, buildPhase: 1, reconciled: reconcile(mix, title, page.normalizedUrl) });
        added += 1;
    }

    const mergedInto = new Map<PlannedIdea<R>, PlannedIdea<R>>();
    const dropped = new Set<PlannedIdea<R>>();
    const fold = (into: PlannedIdea<R>, from: PlannedIdea<R>) => {
        into.mix.supportingQueries = uniqueQueries(
            [...into.mix.supportingQueries, from.mix.targetQuery, ...from.mix.supportingQueries], [into.mix.targetQuery], ignore);
        mergedInto.set(from, into);
    };

    // 3. One idea per existing page.
    const byPage = new Map<string, PlannedIdea<R>[]>();
    for (const item of items) {
        const key = urlKey(item);
        if (key) byPage.set(key, [...(byPage.get(key) ?? []), item]);
    }
    let merged = 0;
    for (const group of byPage.values()) {
        if (group.length < 2) continue;
        // Most demand, else the earliest.
        const winner = group.reduce((best, item) => ((item.mix.demand?.impressions ?? 0) > (best.mix.demand?.impressions ?? 0) ? item : best));
        for (const item of group) {
            if (item === winner) continue;
            fold(winner, item);
            merged += 1;
        }
        // The page needs work if any of the merged ideas found a reason.
        if (!needsWork(winner.reconciled)) winner.reconciled = group.find(item => needsWork(item.reconciled))?.reconciled ?? winner.reconciled;
    }
    const live = () => items.filter(item => !mergedInto.has(item) && !dropped.has(item));

    // 4. A new city page needs its own search with demand.
    let folded = 0;
    let droppedLocal = 0;
    if (clusters.length > 0) {
        for (const item of live()) {
            if (item.reconciled.action !== 'create' || (item.mix.kind !== 'service_city' && item.mix.kind !== 'city')) continue;
            const own = byKey.get(clusterKey(item.mix.targetQuery, ignore));
            if (own && own.impressions >= OWN_DEMAND_MIN_IMPRESSIONS) continue;
            const placePage = placePageFor(`${item.mix.targetQuery}. ${item.title}`, pages, ignore);
            const home = placePage ? live().find(other => other !== item && urlKey(other) === pageKey(placePage.normalizedUrl)) : undefined;
            if (home) {
                fold(home, item);
                folded += 1;
            } else {
                dropped.add(item);
                droppedLocal += 1;
            }
        }
    }

    const kept = live();
    gatherServiceWordings(kept, clusters, pages, ignore);

    // Parents: through merged ideas to the idea they became, past dropped ones to their own parent.
    const byIndex = new Map(items.map(item => [item.mix.index, item]));
    for (const item of kept) {
        const seen = new Set<number>();
        let at = originalParent.get(item) ?? null;
        let parent: number | null = null;
        while (at != null && !seen.has(at)) {
            seen.add(at);
            const node = byIndex.get(at);
            if (!node) break;
            const into = mergedInto.get(node);
            if ((into ?? node) !== item && !dropped.has(node)) {
                parent = (into ?? node).mix.index;
                break;
            }
            at = originalParent.get(node) ?? null;
        }
        item.mix.parentIndex = parent;
    }

    // Live service pages first (build phase 1, most demand first), then service ideas, then the rest.
    const rank = (item: PlannedIdea<R>) => {
        const key = urlKey(item);
        if (key && servicePageKeys.has(key)) return 0;
        return item.mix.kind === 'service' ? 1 : 2;
    };
    for (const item of kept) if (rank(item) === 0) item.buildPhase = 1;
    const silos = input.siloNames.map((_, silo) => kept
        .filter(item => item.silo === silo)
        .map((item, order) => ({ item, order }))
        .sort((a, b) => rank(a.item) - rank(b.item)
            || (rank(a.item) === 0 ? (b.item.mix.demand?.impressions ?? 0) - (a.item.mix.demand?.impressions ?? 0) : 0)
            || a.order - b.order)
        .map(({ item }) => item));

    return {
        silos,
        reconciled,
        summary: { merged_same_page: merged, folded_local: folded, dropped_local: droppedLocal, service_pages_added: added },
    };
}

/** The group whose name and ideas share the most words with the service (the first group on a tie). */
function closestSilo<R>(service: string, siloNames: readonly string[], items: readonly PlannedIdea<R>[], ignore: ReadonlySet<string>): number {
    const words = new Set(significantTokens(service, ignore));
    const overlap = (text: string) => significantTokens(text, ignore).filter(token => words.has(token)).length / Math.max(1, words.size);
    let best = 0;
    let bestScore = -1;
    siloNames.forEach((name, silo) => {
        const score = overlap(name) * 10 + items
            .filter(item => item.silo === silo)
            .reduce((sum, item) => sum + overlap(`${item.title} ${item.mix.targetQuery}`), 0);
        if (score > bestScore) {
            best = silo;
            bestScore = score;
        }
    });
    return best;
}

/**
 * A service idea with no place picks up narrower wordings of its service from
 * Search Console as supporting searches: groups with enough demand whose words
 * are the service's words with one word directly in front ("custom
 * hardscapes", "residential artificial turf"). Not a place, an all-round word (backyard,
 * design), a different modifier (pet, commercial, cost), a comparison or an
 * article-style search, and not a search another idea already covers.
 */
function gatherServiceWordings<R>(
    kept: readonly PlannedIdea<R>[],
    clusters: readonly ArchitectGscCluster[],
    pages: readonly ReconciliationPage[],
    ignore: ReadonlySet<string>,
): void {
    const known = siteFacts(pages).places;
    const claimed = new Set(kept.flatMap(item => [item.mix.targetQuery, ...item.mix.supportingQueries]).map(query => clusterKey(query, ignore)));
    for (const item of kept) {
        if (item.mix.kind !== 'service' && item.mix.kind !== 'sub_service') continue;
        const service = readText(item.mix.targetQuery, known, ignore);
        if (service.places.length > 0 || service.topic.length === 0) continue;
        for (const cluster of clusters) {
            if (cluster.impressions < OWN_DEMAND_MIN_IMPRESSIONS || claimed.has(cluster.key)) continue;
            const search = readText(cluster.query, new Set([...known, ...placesInText(cluster.query, known)]), ignore);
            if (search.places.length > 0 || search.comparison || !sameSet(search.flags, service.flags)) continue;
            const extra = search.topic.filter(token => !service.topic.includes(token));
            if (extra.length !== 1 || BROAD_TOKENS.has(extra[0])) continue;
            if (!service.topic.every(token => search.topic.includes(token))) continue;
            // The extra word sits directly in front of the service ("custom hardscapes", not "benefits of hardscaping").
            const [first = '', second = ''] = cluster.query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
            const firstTokens = significantTokens(first, ignore);
            if (firstTokens.length !== 1 || firstTokens[0] !== extra[0]) continue;
            if (!significantTokens(second, ignore).some(token => service.topic.includes(token))) continue;
            if (ideaKind({ targetQuery: cluster.query, title: cluster.query }) !== 'money') continue;
            item.mix.supportingQueries.push(cluster.query);
            claimed.add(cluster.key);
        }
    }
}
