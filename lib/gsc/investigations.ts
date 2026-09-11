import type { Candidate, OverlapCandidate, PageCandidate } from './insights';
import type {
    SearchEvidenceCategory,
    SearchInvestigationEvidenceSnapshot,
    SearchInvestigationKind,
    TaskCategory,
    TaskPriority,
} from '../types';

export type InvestigationIdentityInput =
    | { kind: 'query_page'; query: string; page: string }
    | { kind: 'page'; page: string }
    | { kind: 'overlap'; query: string };

export interface InvestigationTaskPrefill {
    title: string;
    description: string;
    category: TaskCategory;
    priority: TaskPriority;
    tags: string[];
}

type SnapshotInput = {
    category: SearchEvidenceCategory;
    property: string;
    start: string;
    end: string;
    evidence: Candidate | PageCandidate | OverlapCandidate;
};

const CATEGORY_KIND: Record<SearchEvidenceCategory, SearchInvestigationKind> = {
    near_page_one: 'query_page',
    deeper_visibility: 'query_page',
    page_visibility: 'page',
    overlapping_urls: 'overlap',
};

function normalizeQuery(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

export function normalizeInvestigationUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new Error('Investigation evidence requires an HTTP(S) URL.');
    }
    url.hash = '';
    return url.href;
}

export function investigationLookupKey(input: InvestigationIdentityInput): string {
    if (input.kind === 'query_page') {
        return JSON.stringify({
            kind: input.kind,
            query: normalizeQuery(input.query).toLowerCase(),
            page: normalizeInvestigationUrl(input.page),
        });
    }
    if (input.kind === 'page') {
        return JSON.stringify({ kind: input.kind, page: normalizeInvestigationUrl(input.page) });
    }
    return JSON.stringify({ kind: input.kind, query: normalizeQuery(input.query).toLowerCase() });
}

export function kindForEvidenceCategory(category: SearchEvidenceCategory): SearchInvestigationKind {
    return CATEGORY_KIND[category];
}

function requireDate(value: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
        throw new Error('Investigation evidence requires valid ISO dates.');
    }
}

function requireMetric(value: number, name: string, options: { integer?: boolean; positive?: boolean } = {}): void {
    if (!Number.isFinite(value) || value < 0 || (options.integer && !Number.isInteger(value)) || (options.positive && value <= 0)) {
        throw new Error(`Investigation evidence has an invalid ${name}.`);
    }
}

export function buildInvestigationSnapshot(input: SnapshotInput): SearchInvestigationEvidenceSnapshot {
    const { category, evidence } = input;
    requireDate(input.start);
    requireDate(input.end);
    if (input.start > input.end || !input.property.trim()) {
        throw new Error('Investigation evidence has an invalid reporting window or property.');
    }
    requireMetric(evidence.clicks, 'click count', { integer: true });
    requireMetric(evidence.impressions, 'impression count', { integer: true, positive: true });
    requireMetric(evidence.ctr, 'CTR');
    requireMetric(evidence.position, 'position');
    requireMetric(evidence.observedDays, 'observed day count', { integer: true, positive: true });

    const query = 'query' in evidence ? normalizeQuery(evidence.query) : undefined;
    const page = 'page' in evidence ? normalizeInvestigationUrl(evidence.page) : undefined;
    if ((category === 'near_page_one' || category === 'deeper_visibility') && (!query || !page)) {
        throw new Error('Query/page investigation evidence is incomplete.');
    }
    if (category === 'page_visibility' && !page) {
        throw new Error('Page investigation evidence is incomplete.');
    }

    let pages: SearchInvestigationEvidenceSnapshot['pages'];
    if (category === 'overlapping_urls') {
        if (!query || !('pages' in evidence) || evidence.pages.length < 2) {
            throw new Error('Overlap evidence requires at least two retained pages.');
        }
        pages = evidence.pages.map(item => {
            requireMetric(item.clicks, 'page click count', { integer: true });
            requireMetric(item.impressions, 'page impression count', { integer: true, positive: true });
            requireMetric(item.ctr, 'page CTR');
            requireMetric(item.position, 'page position');
            requireMetric(item.observedDays, 'page observed day count', { integer: true, positive: true });
            return {
                page: normalizeInvestigationUrl(item.page),
                clicks: item.clicks,
                impressions: item.impressions,
                ctr: item.ctr,
                position: item.position,
                observedDays: item.observedDays,
            };
        });
    }

    return {
        version: 1,
        category,
        property: input.property.trim(),
        start: input.start,
        end: input.end,
        query,
        page,
        clicks: evidence.clicks,
        impressions: evidence.impressions,
        ctr: evidence.ctr,
        position: evidence.position,
        observedDays: evidence.observedDays,
        pages,
        limitations: limitationsFor(category),
    };
}

function limitationsFor(category: SearchEvidenceCategory): string[] {
    if (category === 'overlapping_urls') {
        return ['Multiple observed URLs are not proof of cannibalization or a need to consolidate.'];
    }
    if (category === 'page_visibility') {
        return ['Observed page visibility is not proof that a content or optimization change is warranted.'];
    }
    return ['Observed search visibility is not proof of a ranking opportunity or future ranking gain.'];
}

export function taskPrefillForInvestigation(
    snapshot: SearchInvestigationEvidenceSnapshot,
    clientName: string,
): InvestigationTaskPrefill {
    const subject = snapshot.query ?? snapshot.page ?? 'search evidence';
    const rawTitle = snapshot.category === 'overlapping_urls'
        ? `Investigate overlapping URLs for ${subject}`
        : snapshot.category === 'page_visibility'
            ? `Investigate page visibility: ${subject}`
            : `Investigate search evidence: ${subject}`;
    const title = rawTitle.length > 500 ? `${rawTitle.slice(0, 499).trimEnd()}…` : rawTitle;
    const pageEvidence = snapshot.pages?.length
        ? `\nObserved URLs:\n${snapshot.pages.map(item => `- ${item.page}: ${item.impressions} impressions, average position ${item.position.toFixed(1)}, ${item.observedDays} observed days`).join('\n')}`
        : snapshot.page ? `\nPage: ${snapshot.page}` : '';

    return {
        title,
        description: [
            `Client: ${clientName}`,
            `Search Console property: ${snapshot.property}`,
            `Observed period: ${snapshot.start} to ${snapshot.end}`,
            snapshot.query ? `Query: ${snapshot.query}` : '',
            pageEvidence,
            `Observed evidence: ${snapshot.impressions} impressions, ${snapshot.clicks} clicks, average position ${snapshot.position.toFixed(1)}, ${snapshot.observedDays} observed days.`,
            'Review the current search results, page purpose, business value, relevant competing pages, and missing research before documenting a specific next step or no-action decision.',
            'No ranking gain is predicted. This observed evidence does not establish a content gap or cannibalization.',
        ].filter(Boolean).join('\n'),
        category: 'strategy',
        priority: 'medium',
        tags: ['gsc', 'search-insights'],
    };
}
