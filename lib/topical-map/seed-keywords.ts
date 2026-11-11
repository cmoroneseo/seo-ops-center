/**
 * Chosen searches that steer topic-map generation.
 * Omitted when empty so a request without them stays the same as before.
 */

export const MAX_SEED_KEYWORDS = 40;
const MAX_KEYWORD_LENGTH = 80;

export function normalizeSeedKeywords(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const keywords: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const keyword = item.trim().replace(/\s+/g, ' ');
        if (!keyword || keyword.length > MAX_KEYWORD_LENGTH) continue;
        const key = keyword.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        keywords.push(keyword);
        if (keywords.length >= MAX_SEED_KEYWORDS) break;
    }
    return keywords;
}

export function selectedSeedKeywords(rows: readonly { keyword: string; selected: boolean }[]): string[] {
    return normalizeSeedKeywords(rows.filter(row => row.selected).map(row => row.keyword));
}

/** Body for POST /api/topical-map/generate. `keywords` is left off when nothing is chosen. */
export function generationRequestBody(input: {
    clientId: string;
    organizationId: string;
    keywords: readonly string[];
}): { clientId: string; organizationId: string; keywords?: string[] } {
    const keywords = normalizeSeedKeywords(input.keywords);
    if (keywords.length === 0) {
        return { clientId: input.clientId, organizationId: input.organizationId };
    }
    return { clientId: input.clientId, organizationId: input.organizationId, keywords };
}

export function seedInputWithKeywords(
    base: { rivals: string[]; focus_topics: string[] },
    keywords: readonly string[],
): { rivals: string[]; focus_topics: string[]; keywords?: string[] } {
    const normalized = normalizeSeedKeywords(keywords);
    if (normalized.length === 0) return { rivals: base.rivals, focus_topics: base.focus_topics };
    return { rivals: base.rivals, focus_topics: base.focus_topics, keywords: normalized };
}

export function seedKeywordsFromMap(seedInput: unknown): string[] {
    if (!seedInput || typeof seedInput !== 'object') return [];
    return normalizeSeedKeywords((seedInput as { keywords?: unknown }).keywords);
}
