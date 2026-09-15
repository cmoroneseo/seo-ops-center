export interface ReconciliationPage {
    pageId: string;
    normalizedUrl: string;
    title?: string;
    h1s: string[];
    wordCount?: number;
}

export interface GscQueryEvidence {
    query: string;
    pageUrl: string;
}

export interface RecordInput {
    targetQuery: string;
    title: string;
    suggestedUrl?: string;
}

export interface ReconciliationResult {
    action: 'create' | 'replace' | 'improve' | 'keep';
    sitePageId?: string;
    matchedUrl?: string;
}

export function reconcileRecord(
    record: RecordInput,
    pages: ReconciliationPage[],
    gscQueries: GscQueryEvidence[],
): ReconciliationResult {
    const matched = findMatch(record, pages, gscQueries);
    if (!matched) return { action: 'create' };

    const action = determineAction(
        { wordCount: matched.wordCount, title: matched.title, h1s: matched.h1s },
        0,
    );

    return { action, sitePageId: matched.pageId, matchedUrl: matched.normalizedUrl };
}

function findMatch(
    record: RecordInput,
    pages: ReconciliationPage[],
    gscQueries: GscQueryEvidence[],
): ReconciliationPage | undefined {
    if (record.suggestedUrl) {
        const urlNorm = normalizeUrl(record.suggestedUrl);
        const byUrl = pages.find(p => normalizeUrl(p.normalizedUrl) === urlNorm);
        if (byUrl) return byUrl;
    }

    const queryLower = record.targetQuery.toLowerCase();
    const gscMatch = gscQueries.find(g => g.query.toLowerCase() === queryLower);
    if (gscMatch) {
        const byGsc = pages.find(p => normalizeUrl(p.normalizedUrl) === normalizeUrl(gscMatch.pageUrl));
        if (byGsc) return byGsc;
    }

    const titleLower = record.title.toLowerCase();
    const byTitle = pages.find(p =>
        (p.title && p.title.toLowerCase().includes(titleLower)) ||
        p.h1s.some(h1 => h1.toLowerCase().includes(titleLower)),
    );
    if (byTitle) return byTitle;

    return undefined;
}

function normalizeUrl(url: string): string {
    let normalized = url.toLowerCase().trim();
    if (normalized.endsWith('/') && normalized.length > 1) normalized = normalized.slice(0, -1);
    return normalized;
}

export function determineAction(
    page: { wordCount?: number; title?: string; h1s: string[] },
    targetWordCountMin: number,
): 'replace' | 'improve' | 'keep' {
    if (!page.wordCount || page.wordCount < 300) return 'replace';
    if (!page.title && page.h1s.length === 0) return 'replace';
    if (targetWordCountMin > 0 && page.wordCount < targetWordCountMin) return 'improve';
    return 'keep';
}
