/**
 * Branded vs non-branded Search Console clicks.
 *
 * v1 is the lexicon only. A query is branded when its normalized text contains
 * a brand, misspelling, owner, or product term as a whole phrase. Normalization
 * is normalizeTrackerQuery: trim, lowercase, collapse whitespace. The phrase
 * must start and end at a space or at either end of the query, so "meg" does
 * not match "omega" and "marketing empire" does not match "empire marketing".
 * Punctuation stays attached; this does not fold hyphens or call a provider.
 *
 * A tracked keyword's is_branded_override wins for that same normalized query.
 * Null means the lexicon. True or false is the manual answer. An override does
 * not spread to longer queries that merely contain the keyword.
 *
 * Unattributed clicks are property clicks minus visible query clicks. The
 * remainder is allowed to be negative. A missing input stays null and is never
 * stored as 0. A measured zero stays 0.
 */

import { normalizeTrackerQuery } from '../search-reporting/tracker';

export const BRAND_TERM_KINDS = ['brand', 'misspelling', 'owner', 'product'] as const;

export type BrandTermKind = (typeof BRAND_TERM_KINDS)[number];

export const BRAND_TERM_KIND_LABEL: Record<BrandTermKind, string> = {
    brand: 'Brand',
    misspelling: 'Misspelling',
    owner: 'Owner',
    product: 'Product',
};

const MAX_TERM_LENGTH = 120;

export interface BrandLexiconTerm {
    term: string;
}

export interface BrandOverride {
    normalizedKey: string;
    branded: boolean;
}

export interface BrandQueryClicks {
    query: string;
    /** Null when this query's clicks were not measured. */
    clicks: number | null;
}

export interface BrandClickSplit {
    /** Null when visible query clicks were not measured. */
    branded: number | null;
    /** Null when visible query clicks were not measured. */
    nonBranded: number | null;
    /**
     * Property clicks minus visible query clicks.
     * Null when either side was not measured. Never clamped.
     */
    unattributed: number | null;
    propertyClicks: number | null;
    queryClicks: number | null;
}

export function isBrandTermKind(value: string): value is BrandTermKind {
    return (BRAND_TERM_KINDS as readonly string[]).includes(value);
}

/** Null when the term can be saved. Otherwise a message safe to show staff. */
export function brandTermIssue(term: string, kind: string): string | null {
    if (!isBrandTermKind(kind)) return 'Choose a term type.';
    const cleaned = cleanBrandTerm(term);
    const normalized = normalizeTrackerQuery(cleaned);
    if (!normalized) return 'Enter a brand term.';
    if (cleaned.length > MAX_TERM_LENGTH || normalized.length > MAX_TERM_LENGTH) return 'Use 120 characters or fewer.';
    return null;
}

export function cleanBrandTerm(term: string): string {
    return term.trim().replace(/\s+/g, ' ');
}

/** Whole-phrase containment after normalizeTrackerQuery. */
export function queryContainsBrandTerm(query: string, term: string): boolean {
    const normalizedQuery = normalizeTrackerQuery(query);
    const normalizedTerm = normalizeTrackerQuery(term);
    if (!normalizedQuery || !normalizedTerm) return false;
    let from = 0;
    while (from <= normalizedQuery.length - normalizedTerm.length) {
        const index = normalizedQuery.indexOf(normalizedTerm, from);
        if (index < 0) return false;
        const before = index === 0 || normalizedQuery[index - 1] === ' ';
        const afterIndex = index + normalizedTerm.length;
        const after = afterIndex === normalizedQuery.length || normalizedQuery[afterIndex] === ' ';
        if (before && after) return true;
        from = index + 1;
    }
    return false;
}

export function overrideForQuery(query: string, overrides: readonly BrandOverride[]): boolean | null {
    const key = normalizeTrackerQuery(query);
    if (!key) return null;
    let found: boolean | null = null;
    for (const override of overrides) {
        if (normalizeTrackerQuery(override.normalizedKey) !== key) continue;
        if (found == null) found = override.branded;
        else if (found !== override.branded) return null;
    }
    return found;
}

export function queryIsBranded(
    query: string,
    terms: readonly BrandLexiconTerm[],
    overrides: readonly BrandOverride[],
): boolean {
    const override = overrideForQuery(query, overrides);
    if (override != null) return override;
    return terms.some(term => queryContainsBrandTerm(query, term.term));
}

function measuredCount(value: number | null): number | null {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
    return value;
}

export function splitBrandClicks(input: {
    propertyClicks: number | null;
    /** Null when the query grain was not measured. An empty list is a measured zero. */
    queries: readonly BrandQueryClicks[] | null;
    terms: readonly BrandLexiconTerm[];
    overrides: readonly BrandOverride[];
}): BrandClickSplit {
    const propertyClicks = measuredCount(input.propertyClicks);
    if (input.queries == null) {
        return { branded: null, nonBranded: null, unattributed: null, propertyClicks, queryClicks: null };
    }
    let branded = 0;
    let nonBranded = 0;
    let queryClicks = 0;
    for (const row of input.queries) {
        const clicks = measuredCount(row.clicks);
        if (clicks == null) {
            return { branded: null, nonBranded: null, unattributed: null, propertyClicks, queryClicks: null };
        }
        const next = queryClicks + clicks;
        if (!Number.isSafeInteger(next)) {
            return { branded: null, nonBranded: null, unattributed: null, propertyClicks, queryClicks: null };
        }
        if (queryIsBranded(row.query, input.terms, input.overrides)) branded += clicks;
        else nonBranded += clicks;
        queryClicks = next;
    }
    return {
        branded,
        nonBranded,
        unattributed: propertyClicks == null ? null : propertyClicks - queryClicks,
        propertyClicks,
        queryClicks,
    };
}
