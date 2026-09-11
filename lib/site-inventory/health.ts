export type CrawlRunHealthStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type CrawlFetchStatus = 'success' | 'failed' | 'blocked' | 'unsupported' | 'oversized' | 'js_unresolved';
export type CanonicalIssue = 'none' | 'missing' | 'malformed' | 'off_scope' | 'conflicting' | 'cycle' | 'target_failed' | 'target_redirect';
export type HealthCategoryKey = 'fetch_reliability' | 'indexability_conflicts' | 'canonical_integrity' | 'metadata_coverage' | 'internal_discoverability';

export interface CrawlHealthObservation {
    pageId: string;
    url: string;
    isHomepage: boolean;
    sources: Array<'seed' | 'sitemap' | 'gsc' | 'internal' | 'redirect'>;
    fetchStatus: CrawlFetchStatus;
    statusCode?: number;
    contentType?: string;
    redirectCount: number;
    robotsAllowed?: boolean;
    noindex?: boolean;
    canonicalIssue?: CanonicalIssue;
    title?: string;
    h1Count?: number;
    inboundInternalLinks: number;
}

export interface CrawlHealthDeduction {
    pageId: string;
    url: string;
    issueUnits: number;
    reasons: string[];
}

export interface CrawlHealthCategory {
    key: HealthCategoryKey;
    label: string;
    points: number | null;
    maxPoints: number;
    eligibleUrls: number;
    issueUnits: number;
    deductions: CrawlHealthDeduction[];
}

export interface CrawlHealthResult {
    score: number | null;
    provisional: boolean;
    categories: CrawlHealthCategory[];
    limitations: string[];
}

interface CategoryDefinition {
    key: HealthCategoryKey;
    label: string;
    weight: number;
    eligible(observation: CrawlHealthObservation): boolean;
    deduction(observation: CrawlHealthObservation, all: CrawlHealthObservation[]): { units: number; reasons: string[] };
}

const isHtml = (item: CrawlHealthObservation) => item.contentType?.toLowerCase().includes('html') === true;
const fetchedHtml = (item: CrawlHealthObservation) => (item.fetchStatus === 'success' || item.fetchStatus === 'js_unresolved') && isHtml(item);
const representedInSearch = (item: CrawlHealthObservation) => item.sources.includes('sitemap') || item.sources.includes('gsc');
const crawlObservedIndexable = (item: CrawlHealthObservation) => fetchedHtml(item) && item.robotsAllowed !== false && item.noindex !== true && (item.statusCode ?? 0) >= 200 && (item.statusCode ?? 0) < 300;
const duplicateTitle = (item: CrawlHealthObservation, all: CrawlHealthObservation[]) => {
    const normalized = item.title?.replace(/\s+/g, ' ').trim().toLowerCase();
    return Boolean(normalized) && all.filter(candidate => crawlObservedIndexable(candidate) && candidate.title?.replace(/\s+/g, ' ').trim().toLowerCase() === normalized).length > 1;
};

const definitions: CategoryDefinition[] = [
    {
        key: 'fetch_reliability', label: 'Fetch reliability', weight: 30,
        eligible: item => item.fetchStatus !== 'blocked',
        deduction(item) {
            if (item.fetchStatus === 'failed' || item.fetchStatus === 'oversized') return { units: 1, reasons: ['Fetch did not produce a usable response'] };
            if (item.redirectCount >= 2) return { units: 0.5, reasons: ['Redirect chain contained two or more hops'] };
            return { units: 0, reasons: [] };
        },
    },
    {
        key: 'indexability_conflicts', label: 'Indexability conflicts', weight: 25,
        eligible: representedInSearch,
        deduction(item) {
            const reasons: string[] = [];
            if (item.robotsAllowed === false) reasons.push('Blocked by robots.txt despite sitemap or GSC evidence');
            if (item.noindex) reasons.push('Noindex observed despite sitemap or GSC evidence');
            if (item.fetchStatus === 'failed' || item.fetchStatus === 'oversized') reasons.push('Terminal fetch failure conflicts with sitemap or GSC evidence');
            if (reasons.length > 0) return { units: 1, reasons };
            if (item.redirectCount > 0) return { units: 0.5, reasons: ['Represented URL redirects elsewhere'] };
            return { units: 0, reasons: [] };
        },
    },
    {
        key: 'canonical_integrity', label: 'Canonical integrity', weight: 20,
        eligible: fetchedHtml,
        deduction(item) {
            if (item.canonicalIssue === 'target_redirect') return { units: 0.5, reasons: ['Canonical target resolves through a redirect'] };
            if (item.canonicalIssue && !['none', 'missing'].includes(item.canonicalIssue)) {
                return { units: 1, reasons: [`Canonical observation: ${item.canonicalIssue.replaceAll('_', ' ')}`] };
            }
            return { units: 0, reasons: [] };
        },
    },
    {
        key: 'metadata_coverage', label: 'Metadata coverage', weight: 15,
        eligible: crawlObservedIndexable,
        deduction(item, all) {
            const reasons: string[] = [];
            let units = 0;
            if (!item.title?.trim()) { units += 0.5; reasons.push('Missing or empty title'); }
            if (!item.h1Count) { units += 0.25; reasons.push('No H1 observed'); }
            if (duplicateTitle(item, all)) { units += 0.25; reasons.push('Title duplicates another eligible page'); }
            return { units: Math.min(1, units), reasons };
        },
    },
    {
        key: 'internal_discoverability', label: 'Internal discoverability', weight: 10,
        eligible: item => crawlObservedIndexable(item) && representedInSearch(item) && !item.isHomepage,
        deduction(item) {
            return item.inboundInternalLinks === 0
                ? { units: 1, reasons: ['No inbound internal link observed in this crawl'] }
                : { units: 0, reasons: [] };
        },
    },
];

const rounded = (value: number) => Math.round(value * 10) / 10;

export function calculateCrawlHealth(input: {
    status: CrawlRunHealthStatus;
    capped: boolean;
    observations: CrawlHealthObservation[];
}): CrawlHealthResult {
    const categories = definitions.map(definition => {
        const eligible = input.observations.filter(definition.eligible);
        const deductions = eligible.flatMap(item => {
            const deduction = definition.deduction(item, input.observations);
            return deduction.units > 0 ? [{ pageId: item.pageId, url: item.url, issueUnits: Math.min(1, deduction.units), reasons: deduction.reasons }] : [];
        });
        const issueUnits = deductions.reduce((sum, item) => sum + item.issueUnits, 0);
        const points = eligible.length === 0 ? null : rounded(definition.weight * (1 - Math.min(eligible.length, issueUnits) / eligible.length));
        return { key: definition.key, label: definition.label, points, maxPoints: definition.weight, eligibleUrls: eligible.length, issueUnits, deductions };
    });

    const limitations: string[] = [];
    if (input.capped) limitations.push('The crawl reached its URL cap; undiscovered pages may exist.');
    if (input.observations.some(item => item.fetchStatus === 'blocked')) limitations.push('Some URLs were blocked by robots.txt and could not be fetched.');
    if (input.observations.some(item => item.fetchStatus === 'failed')) limitations.push('Some URLs could not be fetched.');
    if (input.observations.some(item => item.fetchStatus === 'unsupported')) limitations.push('Some responses used unsupported content types.');
    if (input.observations.some(item => item.fetchStatus === 'oversized')) limitations.push('Some responses exceeded the configured size limit.');
    if (input.observations.some(item => item.fetchStatus === 'js_unresolved')) limitations.push('Some page content may require JavaScript rendering, which this crawl does not perform.');
    const scored = categories.filter(category => category.points !== null);
    const provisional = scored.length < categories.length || limitations.length > 0;
    const score = input.status !== 'completed' || scored.length === 0
        ? null
        : Math.round(100 * scored.reduce((sum, category) => sum + category.points!, 0) / scored.reduce((sum, category) => sum + category.maxPoints, 0));
    return { score, provisional, categories, limitations };
}
