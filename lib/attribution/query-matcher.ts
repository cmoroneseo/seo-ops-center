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

/**
 * Cross-references GSC query/page facts against a conversion's landing page
 * and returns the top-ranked queries by clicks, with a confidence share of
 * total matched clicks.
 */
export function rankQueries(facts: GscFact[], landingPage: string, limit = 3): LikelyQuery[] {
    const target = normalizePath(landingPage);
    const matched = facts.filter(f => normalizePath(f.page) === target && f.clicks > 0);
    if (matched.length === 0) return [];

    matched.sort((a, b) => b.clicks - a.clicks);

    const totalClicks = matched.reduce((sum, f) => sum + f.clicks, 0);
    return matched.slice(0, limit).map(f => ({
        query: f.query,
        clicks: f.clicks,
        confidence: Math.round((f.clicks / totalClicks) * 1000) / 1000,
    }));
}
