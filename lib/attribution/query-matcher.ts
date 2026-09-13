import type { LikelyQuery } from '../types';

export interface GscFact {
    query: string;
    page: string;
    clicks: number;
    impressions: number;
}

function normalizePath(raw: string): string {
    try {
        const url = new URL(raw, 'https://placeholder.com');
        return url.pathname.replace(/\/+$/, '') || '/';
    } catch {
        return raw.replace(/\/+$/, '') || '/';
    }
}

function host(raw: string): string | null {
    try { return new URL(raw).host.toLowerCase(); } catch { return null; }
}

/**
 * Cross-references GSC query/page facts against a conversion's landing page
 * and returns the top-ranked queries by clicks, with a confidence share of
 * total matched clicks.
 */
export function rankQueries(facts: GscFact[], landingPage: string, limit = 3): LikelyQuery[] {
    const target = normalizePath(landingPage);
    const targetHost = host(landingPage);
    const totals = new Map<string, number>();
    for (const fact of facts) {
        if (normalizePath(fact.page) !== target || (targetHost && host(fact.page) !== targetHost) ||
            !Number.isFinite(fact.clicks) || fact.clicks <= 0) continue;
        totals.set(fact.query, (totals.get(fact.query) ?? 0) + fact.clicks);
    }
    const ranked = Array.from(totals, ([query, clicks]) => ({ query, clicks }))
        .sort((a, b) => b.clicks - a.clicks || a.query.localeCompare(b.query));
    const totalClicks = ranked.reduce((sum, fact) => sum + fact.clicks, 0);
    return ranked.slice(0, limit).map(fact => ({
        ...fact,
        confidence: Math.round((fact.clicks / totalClicks) * 1000) / 1000,
    }));
}
