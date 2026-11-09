/**
 * Content Plan rows for Campaign Work.
 *
 * The monthly pillar/stage board stays its own store. These rows are not
 * initiatives, tasks, or plan items, and nothing here is copied from them.
 * The work month is the calendar month already in the Campaign URL.
 * Published date and due date are calendar dates. An engagement month is
 * not an input, and one date is never derived from the other.
 * Missing volume, difficulty, and links stay unset. They are not zero.
 * Published is a content status. It is not indexed and not performing.
 */

import { formatInitiativeDay, safeHttpUrl, UNSET_MARK } from './initiatives';
import { isPlanMonth, planMonthTitle } from '../seo-plan/plan-sections';

export const CONTENT_PLAN_UNSET = UNSET_MARK;

export const CONTENT_PLAN_HONESTY =
    'Published means the content is published. It is not indexed and it is not performing.';

export const CONTENT_PLAN_COLUMNS = [
    'Month',
    'Published Date',
    'Status',
    'Content Type',
    'Title',
    'KW',
    'Volume',
    'KD',
    'Due Date',
    'Draft Link',
    'Live Link',
    'Matching Product/Service',
    'Internal Link',
] as const;

export const CONTENT_PLAN_STATUSES = [
    'idea',
    'keyword_approved',
    'in_progress',
    'in_review',
    'client_review',
    'approved',
    'published',
] as const;

export const CONTENT_PLAN_STATUS_LABEL: Record<(typeof CONTENT_PLAN_STATUSES)[number], string> = {
    idea: 'Idea',
    keyword_approved: 'Keyword Approved',
    in_progress: 'In Progress',
    in_review: 'In Review',
    client_review: 'Client Review',
    approved: 'Approved',
    published: 'Published',
};

export const CONTENT_PLAN_TYPES = [
    'blog_post',
    'service_page',
    'location_page',
    'landing_page',
    'pillar_page',
    'product_page',
    'faq_page',
    'case_study',
] as const;

export const CONTENT_PLAN_TYPE_LABEL: Record<(typeof CONTENT_PLAN_TYPES)[number], string> = {
    blog_post: 'Blog Post',
    service_page: 'Service Page',
    location_page: 'Location Page',
    landing_page: 'Landing Page',
    pillar_page: 'Pillar Page',
    product_page: 'Product Page',
    faq_page: 'FAQ Page',
    case_study: 'Case Study',
};

const TITLE_MAX = 240;
const TEXT_MAX = 180;
const URL_MAX = 500;
const VOLUME_MAX = 2147483647;
const DIFFICULTY_MAX = 100;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export type ContentPlanStatus = (typeof CONTENT_PLAN_STATUSES)[number];
export type ContentPlanType = (typeof CONTENT_PLAN_TYPES)[number];

export interface ContentPlanRow {
    id: string;
    organizationId: string;
    clientId: string;
    planMonth: string;
    publishedOn: string | null;
    status: ContentPlanStatus | null;
    contentType: ContentPlanType | null;
    title: string;
    keyword: string | null;
    searchVolume: number | null;
    keywordDifficulty: number | null;
    dueOn: string | null;
    draftUrl: string | null;
    liveUrl: string | null;
    matchingProduct: string | null;
    internalUrl: string | null;
    createdAt: string;
}

export interface ContentPlanDraft {
    title: string;
    publishedOn: string;
    status: string;
    contentType: string;
    keyword: string;
    searchVolume: string;
    keywordDifficulty: string;
    dueOn: string;
    draftUrl: string;
    liveUrl: string;
    matchingProduct: string;
    internalUrl: string;
}

export interface ContentPlanWrite {
    title: string;
    publishedOn: string | null;
    status: ContentPlanStatus | null;
    contentType: ContentPlanType | null;
    keyword: string | null;
    searchVolume: number | null;
    keywordDifficulty: number | null;
    dueOn: string | null;
    draftUrl: string | null;
    liveUrl: string | null;
    matchingProduct: string | null;
    internalUrl: string | null;
}

export interface ContentPlanPublication {
    label: string;
    published: boolean;
    indexed: false;
    performing: false;
    verified: false;
}

export interface ContentPlanView {
    monthLabel: string;
    publishedOn: string;
    statusLabel: string;
    published: boolean;
    indexed: false;
    performing: false;
    verified: false;
    contentTypeLabel: string;
    title: string;
    keyword: string;
    volume: string;
    difficulty: string;
    dueOn: string;
    draftUrl: string | null;
    liveUrl: string | null;
    matchingProduct: string;
    internalUrl: string | null;
}

type DraftFail = { ok: false; error: string };
type DraftOk = { ok: true; value: ContentPlanWrite };

function fail(error: string): DraftFail {
    return { ok: false, error };
}

function isFail<T>(value: T | DraftFail): value is DraftFail {
    return Boolean(value && typeof value === 'object' && 'ok' in value && (value as DraftFail).ok === false);
}

function trimmed(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

/** Missing, blank, and unknown labels read as not set. Only stored slugs count. */
export function readContentPlanStatus(value: unknown): ContentPlanStatus | null {
    const slug = trimmed(value);
    if (!slug || slug === CONTENT_PLAN_UNSET) return null;
    return (CONTENT_PLAN_STATUSES as readonly string[]).includes(slug) ? slug as ContentPlanStatus : null;
}

/** Missing, blank, and unknown labels read as not set. Only stored slugs count. */
export function readContentPlanType(value: unknown): ContentPlanType | null {
    const slug = trimmed(value);
    if (!slug || slug === CONTENT_PLAN_UNSET) return null;
    return (CONTENT_PLAN_TYPES as readonly string[]).includes(slug) ? slug as ContentPlanType : null;
}

/** A work calendar month, YYYY-MM. Display labels and engagement months are not one. */
export function readContentPlanMonth(value: unknown): string | null {
    const month = trimmed(value);
    return month && isPlanMonth(month) ? month : null;
}

function readIsoDay(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const iso = value.trim().slice(0, 10);
    const match = ISO_DAY.exec(iso);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const utc = new Date(Date.UTC(year, month - 1, day));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null;
    return iso;
}

/** Missing and unreadable numbers are unset. Zero stays zero. Values are not clamped. */
export function readContentPlanNumber(value: unknown, max: number): number | null {
    if (typeof value === 'string') {
        const text = value.trim();
        if (!text || text === CONTENT_PLAN_UNSET || text === '-') return null;
        if (!/^\d+$/.test(text)) return null;
        value = Number(text);
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    if (value < 0 || value > max) return null;
    return value;
}

export function readContentPlanVolume(value: unknown): number | null {
    return readContentPlanNumber(value, VOLUME_MAX);
}

export function readContentPlanDifficulty(value: unknown): number | null {
    return readContentPlanNumber(value, DIFFICULTY_MAX);
}

/**
 * Calendar dates on a content row.
 * targetMonth and planMonth are ignored on purpose: they do not fill either date.
 */
export function contentPlanCalendarDates(input: {
    publishedOn?: unknown;
    dueOn?: unknown;
    targetMonth?: unknown;
    planMonth?: unknown;
}): { publishedOn: string | null; dueOn: string | null } {
    return {
        publishedOn: readIsoDay(input.publishedOn),
        dueOn: readIsoDay(input.dueOn),
    };
}

export function emptyContentPlanDraft(): ContentPlanDraft {
    return {
        title: '',
        publishedOn: '',
        status: '',
        contentType: '',
        keyword: '',
        searchVolume: '',
        keywordDifficulty: '',
        dueOn: '',
        draftUrl: '',
        liveUrl: '',
        matchingProduct: '',
        internalUrl: '',
    };
}

export function contentPlanDraftFromRow(row: ContentPlanRow): ContentPlanDraft {
    return {
        title: row.title,
        publishedOn: row.publishedOn ?? '',
        status: row.status ?? '',
        contentType: row.contentType ?? '',
        keyword: row.keyword ?? '',
        searchVolume: row.searchVolume == null ? '' : String(row.searchVolume),
        keywordDifficulty: row.keywordDifficulty == null ? '' : String(row.keywordDifficulty),
        dueOn: row.dueOn ?? '',
        draftUrl: row.draftUrl ?? '',
        liveUrl: row.liveUrl ?? '',
        matchingProduct: row.matchingProduct ?? '',
        internalUrl: row.internalUrl ?? '',
    };
}

/** Published is only the content status. It is never indexed, performing, or verified. */
export function contentPlanPublication(status: ContentPlanStatus | null): ContentPlanPublication {
    return {
        label: status ? CONTENT_PLAN_STATUS_LABEL[status] : CONTENT_PLAN_UNSET,
        published: status === 'published',
        indexed: false,
        performing: false,
        verified: false,
    };
}

export function contentPlanMetricLabel(value: number | null): string {
    return value == null ? CONTENT_PLAN_UNSET : String(value);
}

export function contentPlanForMonth(rows: readonly ContentPlanRow[], month: string): ContentPlanRow[] {
    const planMonth = readContentPlanMonth(month);
    if (!planMonth) return [];
    return rows
        .filter(row => row.planMonth === planMonth)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export function contentPlanView(row: ContentPlanRow): ContentPlanView {
    const publication = contentPlanPublication(row.status);
    const dates = contentPlanCalendarDates({
        publishedOn: row.publishedOn,
        dueOn: row.dueOn,
        planMonth: row.planMonth,
    });
    return {
        monthLabel: planMonthTitle(row.planMonth),
        publishedOn: dates.publishedOn ? formatInitiativeDay(dates.publishedOn) : CONTENT_PLAN_UNSET,
        statusLabel: publication.label,
        published: publication.published,
        indexed: false,
        performing: false,
        verified: false,
        contentTypeLabel: row.contentType ? CONTENT_PLAN_TYPE_LABEL[row.contentType] : CONTENT_PLAN_UNSET,
        title: row.title,
        keyword: row.keyword?.trim() ? row.keyword.trim() : CONTENT_PLAN_UNSET,
        volume: contentPlanMetricLabel(row.searchVolume),
        difficulty: contentPlanMetricLabel(row.keywordDifficulty),
        dueOn: dates.dueOn ? formatInitiativeDay(dates.dueOn) : CONTENT_PLAN_UNSET,
        draftUrl: safeHttpUrl(row.draftUrl),
        liveUrl: safeHttpUrl(row.liveUrl),
        matchingProduct: row.matchingProduct?.trim() ? row.matchingProduct.trim() : CONTENT_PLAN_UNSET,
        internalUrl: safeHttpUrl(row.internalUrl),
    };
}

export function readContentPlanRow(row: Record<string, unknown>): ContentPlanRow | null {
    const id = trimmed(row.id);
    const organizationId = trimmed(row.organization_id);
    const clientId = trimmed(row.client_id);
    const planMonth = readContentPlanMonth(row.plan_month);
    const title = trimmed(row.title);
    if (!id || !organizationId || !clientId || !planMonth || !title) return null;
    const dates = contentPlanCalendarDates({
        publishedOn: row.published_on,
        dueOn: row.due_on,
        targetMonth: row.target_month,
        planMonth,
    });
    return {
        id,
        organizationId,
        clientId,
        planMonth,
        publishedOn: dates.publishedOn,
        status: readContentPlanStatus(row.status),
        contentType: readContentPlanType(row.content_type),
        title,
        keyword: trimmed(row.keyword) || null,
        searchVolume: readContentPlanVolume(row.search_volume),
        keywordDifficulty: readContentPlanDifficulty(row.keyword_difficulty),
        dueOn: dates.dueOn,
        draftUrl: safeHttpUrl(trimmed(row.draft_url)),
        liveUrl: safeHttpUrl(trimmed(row.live_url)),
        matchingProduct: trimmed(row.matching_product) || null,
        internalUrl: safeHttpUrl(trimmed(row.internal_url)),
        createdAt: trimmed(row.created_at),
    };
}

function optionalText(value: string, label: string, max: number): string | null | DraftFail {
    const text = value.trim();
    if (!text || text === CONTENT_PLAN_UNSET) return null;
    if (text.length > max) return fail(`${label} is too long.`);
    return text;
}

function optionalDate(value: string, label: string): string | null | DraftFail {
    const text = value.trim();
    if (!text || text === CONTENT_PLAN_UNSET) return null;
    const iso = readIsoDay(text);
    if (!iso || iso !== text) return fail(`${label} is not a date.`);
    return iso;
}

function optionalSlug<T extends string>(value: string, allowed: readonly T[], label: string): T | null | DraftFail {
    const text = value.trim();
    if (!text || text === CONTENT_PLAN_UNSET || text === '-') return null;
    if ((allowed as readonly string[]).includes(text)) return text as T;
    return fail(`${label} is not a content plan value.`);
}

function optionalCount(value: string, label: string, max: number, rangeError: string): number | null | DraftFail {
    const text = value.trim();
    if (!text || text === CONTENT_PLAN_UNSET || text === '-') return null;
    if (!/^\d+$/.test(text)) return fail(`${label} must be a whole number or empty.`);
    const number = Number(text);
    if (number > max) return fail(rangeError);
    return number;
}

function optionalUrl(value: string, label: string): string | null | DraftFail {
    const text = value.trim();
    if (!text || text === CONTENT_PLAN_UNSET) return null;
    if (text.length > URL_MAX) return fail(`${label} is too long.`);
    const href = safeHttpUrl(text);
    if (!href) return fail(`${label} needs a full http or https URL.`);
    if (href.length > URL_MAX) return fail(`${label} is too long.`);
    return href;
}

export function normalizeContentPlanDraft(draft: ContentPlanDraft): DraftOk | DraftFail {
    const title = draft.title.trim();
    if (!title) return fail('Title is required.');
    if (title.length > TITLE_MAX) return fail('Title is too long.');
    const status = optionalSlug(draft.status, CONTENT_PLAN_STATUSES, 'Status');
    if (isFail(status)) return status;
    const contentType = optionalSlug(draft.contentType, CONTENT_PLAN_TYPES, 'Content type');
    if (isFail(contentType)) return contentType;
    const keyword = optionalText(draft.keyword, 'KW', TEXT_MAX);
    if (isFail(keyword)) return keyword;
    const searchVolume = optionalCount(draft.searchVolume, 'Volume', VOLUME_MAX, 'Volume is too large.');
    if (isFail(searchVolume)) return searchVolume;
    const keywordDifficulty = optionalCount(
        draft.keywordDifficulty,
        'KD',
        DIFFICULTY_MAX,
        'KD must be a whole number from 0 to 100, or empty.',
    );
    if (isFail(keywordDifficulty)) return keywordDifficulty;
    const publishedOn = optionalDate(draft.publishedOn, 'Published date');
    if (isFail(publishedOn)) return publishedOn;
    const dueOn = optionalDate(draft.dueOn, 'Due date');
    if (isFail(dueOn)) return dueOn;
    const draftUrl = optionalUrl(draft.draftUrl, 'Draft link');
    if (isFail(draftUrl)) return draftUrl;
    const liveUrl = optionalUrl(draft.liveUrl, 'Live link');
    if (isFail(liveUrl)) return liveUrl;
    const internalUrl = optionalUrl(draft.internalUrl, 'Internal link');
    if (isFail(internalUrl)) return internalUrl;
    const matchingProduct = optionalText(draft.matchingProduct, 'Matching product/service', TEXT_MAX);
    if (isFail(matchingProduct)) return matchingProduct;
    return {
        ok: true,
        value: {
            title,
            publishedOn,
            status,
            contentType,
            keyword,
            searchVolume,
            keywordDifficulty,
            dueOn,
            draftUrl,
            liveUrl,
            matchingProduct,
            internalUrl,
        },
    };
}

export function contentPlanWriteScope(input: {
    client: { id: string; organizationId: string } | null;
    assertedOrganizationId?: string | null;
}): { ok: true; organizationId: string; clientId: string } | DraftFail {
    if (!input.client?.id || !input.client.organizationId) return fail('This client is not available.');
    const asserted = input.assertedOrganizationId?.trim() || null;
    if (asserted && asserted !== input.client.organizationId) return fail('Client does not belong to this organization.');
    return { ok: true, organizationId: input.client.organizationId, clientId: input.client.id };
}

export function contentPlanInsertRow(
    scope: { organizationId: string; clientId: string },
    planMonth: string,
    write: ContentPlanWrite,
): Record<string, string | number | null> {
    const month = readContentPlanMonth(planMonth);
    if (!month) throw new Error('Month is not a work month.');
    return {
        organization_id: scope.organizationId,
        client_id: scope.clientId,
        plan_month: month,
        published_on: write.publishedOn,
        status: write.status,
        content_type: write.contentType,
        title: write.title,
        keyword: write.keyword,
        search_volume: write.searchVolume,
        keyword_difficulty: write.keywordDifficulty,
        due_on: write.dueOn,
        draft_url: write.draftUrl,
        live_url: write.liveUrl,
        matching_product: write.matchingProduct,
        internal_url: write.internalUrl,
    };
}

export function contentPlanUpdateRow(write: ContentPlanWrite): Record<string, string | number | null> {
    return {
        published_on: write.publishedOn,
        status: write.status,
        content_type: write.contentType,
        title: write.title,
        keyword: write.keyword,
        search_volume: write.searchVolume,
        keyword_difficulty: write.keywordDifficulty,
        due_on: write.dueOn,
        draft_url: write.draftUrl,
        live_url: write.liveUrl,
        matching_product: write.matchingProduct,
        internal_url: write.internalUrl,
    };
}
