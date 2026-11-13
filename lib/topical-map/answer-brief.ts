/**
 * Answer-ready brief for generated topic-map ideas: a 40-60 word direct
 * answer (answer_first_60), the AI prompts the page targets, its H2
 * headings, its schema type, and whether it needs a dated price table.
 *
 * Schema type and the price-table flag are derived from the page kind, so
 * every idea has them even when the model omits them. The model's value can
 * only refine within what fits the kind. Pure functions.
 */

import type { AnswerBrief, BriefSchemaType, PageType } from '../types';
import type { PageKind } from './page-mix';

export const SCHEMA_TYPES: readonly BriefSchemaType[] = ['Service', 'LocalBusiness', 'FAQPage', 'Article', 'HowTo'];
export const ANSWER_MIN_WORDS = 40;
export const ANSWER_MAX_WORDS = 60;
const ANSWER_CHARS = 2000;
const PROMPTS_MAX = 3;
const PROMPT_CHARS = 200;
const HEADINGS_MAX = 8;
const HEADING_CHARS = 120;

const MONEY_SCHEMA: readonly BriefSchemaType[] = ['Service', 'LocalBusiness'];
const ARTICLE_SCHEMA: readonly BriefSchemaType[] = ['Article', 'FAQPage', 'HowTo'];
const PRICE_WORDS = /\b(costs?|prices?|pricing|how much)\b/i;

/** Columns the generator writes that an unapplied migration may not have yet. answer_first_60 is 083, answer_brief is 130. */
export const BRIEF_COLUMNS = ['answer_brief', 'answer_first_60'] as const;

function isMoneyKind(kind: PageKind): boolean {
    return kind === 'service' || kind === 'sub_service' || kind === 'service_city' || kind === 'city';
}

/** Schema type from the page kind. A buyer question stored as an FAQ page is FAQPage; a single-question article is Article. */
export function defaultSchemaType(kind: PageKind, storedType?: PageType): BriefSchemaType {
    if (kind === 'city') return 'LocalBusiness';
    if (isMoneyKind(kind)) return 'Service';
    if (kind === 'faq' && storedType === 'faq') return 'FAQPage';
    return 'Article';
}

function schemaTypeOf(value: unknown): BriefSchemaType | null {
    if (typeof value !== 'string') return null;
    const key = value.toLowerCase().replace(/[^a-z]/g, '');
    if (key === 'faq') return 'FAQPage';
    return SCHEMA_TYPES.find(type => type.toLowerCase() === key) ?? null;
}

/** The model may swap Service for LocalBusiness on a money page, or pick FAQPage or HowTo on an article. Anything else keeps the default. */
export function schemaTypeFor(kind: PageKind, storedType: PageType | undefined, modelValue: unknown): BriefSchemaType {
    const fallback = defaultSchemaType(kind, storedType);
    const chosen = schemaTypeOf(modelValue);
    const allowed = isMoneyKind(kind) ? MONEY_SCHEMA : ARTICLE_SCHEMA;
    return chosen && allowed.includes(chosen) ? chosen : fallback;
}

/** Cost pages and pages whose title or search names a price always get a table. The model can add one, never remove it. */
export function needsPriceTable(kind: PageKind, text: string, modelValue: unknown): boolean {
    return kind === 'cost' || PRICE_WORDS.test(text) || modelValue === true;
}

/**
 * The direct answer, whitespace collapsed. Over 60 words it is cut at the
 * last sentence that ends at word 40 or later, else at word 60 with an
 * ellipsis. Under 40 words it is kept and reads as short (see answerNote).
 */
export function fitAnswer(value: unknown): { answer: string | null; trimmed: boolean } {
    if (typeof value !== 'string') return { answer: null, trimmed: false };
    const words = value.split(/\s+/).filter(Boolean);
    if (words.length === 0) return { answer: null, trimmed: false };
    let answer = words.join(' ');
    let trimmed = false;
    if (words.length > ANSWER_MAX_WORDS) {
        trimmed = true;
        const head = words.slice(0, ANSWER_MAX_WORDS);
        let end = -1;
        for (let i = head.length - 1; i >= ANSWER_MIN_WORDS - 1; i--) {
            if (/[.!?]["'”)\]]*$/.test(head[i])) { end = i; break; }
        }
        answer = end >= 0 ? head.slice(0, end + 1).join(' ') : `${head.join(' ').replace(/[,;:–—-]+$/, '')}…`;
    }
    if (answer.length > ANSWER_CHARS) return { answer: null, trimmed: false };
    return { answer, trimmed };
}

function cleanList(value: unknown, max: number, maxChars: number): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const items: string[] = [];
    for (const item of value) {
        if (typeof item !== 'string') continue;
        const text = item.replace(/^\s*(?:#+|h2\s*[:.-]|[-*•]|\d+[.)])\s*/i, '').replace(/\s+/g, ' ').trim();
        const key = text.toLowerCase();
        if (!text || text.length > maxChars || seen.has(key)) continue;
        seen.add(key);
        items.push(text);
        if (items.length === max) break;
    }
    return items;
}

/** Brief for one model record. `text` is the idea's title and target search. */
export function answerBriefFor(
    rec: Record<string, unknown>,
    page: { kind: PageKind; storedType?: PageType },
    text: string,
): { answerFirst60: string | null; brief: AnswerBrief } {
    const answer = fitAnswer(rec.answer);
    return {
        answerFirst60: answer.answer,
        brief: {
            aiPrompts: cleanList(rec.ai_prompts, PROMPTS_MAX, PROMPT_CHARS),
            headings: cleanList(rec.h2s, HEADINGS_MAX, HEADING_CHARS),
            schemaType: schemaTypeFor(page.kind, page.storedType, rec.schema_type),
            priceTable: needsPriceTable(page.kind, text, rec.price_table),
            answerTrimmed: answer.trimmed,
        },
    };
}

export function briefToRow(brief: AnswerBrief): Record<string, unknown> {
    return {
        ai_prompts: brief.aiPrompts,
        headings: brief.headings,
        schema_type: brief.schemaType,
        price_table: brief.priceTable,
        answer_trimmed: brief.answerTrimmed,
    };
}

export function briefFromRow(value: unknown): AnswerBrief | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    const schemaType = schemaTypeOf(row.schema_type);
    if (!schemaType) return undefined;
    return {
        aiPrompts: cleanList(row.ai_prompts, PROMPTS_MAX, PROMPT_CHARS),
        headings: cleanList(row.headings, HEADINGS_MAX, HEADING_CHARS),
        schemaType,
        priceTable: row.price_table === true,
        answerTrimmed: row.answer_trimmed === true,
    };
}

/** Plain-English note under the answer: shortened, short, or nothing. */
export function answerNote(answer: string | undefined, trimmed: boolean): string {
    const words = (answer ?? '').split(/\s+/).filter(Boolean).length;
    if (words === 0) return '';
    if (trimmed) return `Shortened to ${words} words.`;
    if (words < ANSWER_MIN_WORDS) return `${words} words. Aim for 40 to 60.`;
    return `${words} words.`;
}

export const SCHEMA_TYPE_LABEL: Record<BriefSchemaType, string> = {
    Service: 'Service',
    LocalBusiness: 'Local business',
    FAQPage: 'FAQ page',
    Article: 'Article',
    HowTo: 'How-to',
};

type InsertResult<T> = { data: T | null; error: { code?: string; message?: string } | null };

function isMissingColumn(error: { code?: string } | null): boolean {
    return error?.code === '42703' || error?.code === 'PGRST204';
}

/**
 * Inserts a row; when the database lacks one of `optional` (its migration is
 * not applied yet), drops that column and retries. `missing` remembers the
 * dropped columns so later rows skip them without a failed attempt.
 */
export async function insertSkippingMissingColumns<T>(
    row: Record<string, unknown>,
    optional: readonly string[],
    missing: Set<string>,
    insert: (row: Record<string, unknown>) => PromiseLike<InsertResult<T>>,
): Promise<InsertResult<T>> {
    for (;;) {
        const next = Object.fromEntries(Object.entries(row).filter(([key]) => !missing.has(key)));
        const result = await insert(next);
        if (!isMissingColumn(result.error)) return result;
        const present = optional.filter(column => column in next);
        const named = present.filter(column => result.error?.message?.includes(column));
        const drop = named.length > 0 ? named : present;
        if (drop.length === 0) return result;
        for (const column of drop) missing.add(column);
    }
}
