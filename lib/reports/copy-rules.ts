// Client-facing report copy. Search Console counts are clicks and times shown,
// never people, visits, visitors, customers, or leads. Business Profile
// CALL_CLICKS are call-button taps, never "calls".

import type { Block } from './blocks';

const GSC_SOURCES = new Set(['gsc', 'organic_clicks', 'impressions', 'avg_position', 'ctr', 'search_console']);
const CALL_SOURCES = new Set(['CALL_CLICKS', 'calls', 'gbp_calls']);
const GSC_CITE = /\b(click(?:s|ed|ing)?|impression(?:s)?|times shown|ctr|click-through|positions?|search console|gsc)\b/i;
const BANNED_NEAR_GSC = /\b(people|visits|visitors|customers|leads)\b/gi;
const CALLS_WORD = /\bcalls\b/gi;

export interface CopyViolation {
    sentence: string;
    term: string;
    rule: 'gsc_banned_word' | 'gbp_calls';
}

export class ClientCopyRejected extends Error {
    readonly violations: CopyViolation[];

    constructor(violations: CopyViolation[]) {
        super('Rewrite the report before sharing. Do not describe Search Console numbers as people, visits, visitors, customers, or leads, and say call-button taps instead of calls.');
        this.name = 'ClientCopyRejected';
        this.violations = violations;
    }
}

function sentences(text: string): string[] {
    return text
        .split(/\n+|(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);
}

function citesGsc(sentence: string, metricSources: readonly string[]): boolean {
    if (!metricSources.some(source => GSC_SOURCES.has(source))) return false;
    return GSC_CITE.test(sentence);
}

function citesCalls(metricSources: readonly string[]): boolean {
    return metricSources.some(source => CALL_SOURCES.has(source));
}

/** Sentences that must not be shown to a client for the given metric sources. */
export function findClientCopyViolations(text: string, metricSources: readonly string[]): CopyViolation[] {
    const violations: CopyViolation[] = [];
    for (const sentence of sentences(text)) {
        if (citesGsc(sentence, metricSources)) {
            for (const match of sentence.matchAll(BANNED_NEAR_GSC)) {
                violations.push({ sentence, term: match[0], rule: 'gsc_banned_word' });
            }
        }
        if (citesCalls(metricSources)) {
            for (const match of sentence.matchAll(CALLS_WORD)) {
                violations.push({ sentence, term: match[0], rule: 'gbp_calls' });
            }
        }
    }
    return violations;
}

/** Throws when client copy uses a banned word next to the metric it describes. */
export function assertClientCopy(text: string, metricSources: readonly string[]): void {
    const violations = findClientCopyViolations(text, metricSources);
    if (violations.length === 0) return;
    const error = new Error(`Client copy rejected (${violations.map(violation => violation.term).join(', ')})`);
    error.name = 'ClientCopyError';
    throw error;
}

export function copySourcesForMetrics(current: Record<string, unknown> | null | undefined): string[] {
    const sources = new Set<string>(['CALL_CLICKS']);
    if (!current) return [...sources];
    for (const source of Object.keys(current)) sources.add(source);
    if (current.gsc && typeof current.gsc === 'object') {
        sources.add('gsc');
        sources.add('organic_clicks');
        sources.add('impressions');
    }
    if (current.gbp && typeof current.gbp === 'object') sources.add('gbp');
    return [...sources];
}

function blockText(block: Block): string[] {
    const props = block.props ?? {};
    return ['text', 'content', 'heading', 'caption', 'label', 'title', 'subtitle']
        .map(key => props[key])
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

/** Lint the words a shared report will show. Labels are checked separately. */
export function assertShareCopy(input: {
    executiveSummary: string;
    recommendations: string;
    blocks: Block[];
    sources: readonly string[];
}): void {
    const text = [input.executiveSummary, input.recommendations, ...input.blocks.flatMap(blockText)].filter(Boolean).join('\n');
    const violations = findClientCopyViolations(text, input.sources);
    if (violations.length > 0) throw new ClientCopyRejected(violations);
}
