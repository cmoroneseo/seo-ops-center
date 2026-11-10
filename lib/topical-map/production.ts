/**
 * Content lifecycle for one topical map record.
 *
 * Plan approval stays on `status` (pending, approved, declined).
 * These fields are the production list: where the page is, which month, and the links.
 * A missing column reads as not set, so the map still loads before migration 123.
 * A work month does not fill a due date or a publish date, and neither date fills the other.
 * Published means the page is published. It does not mean indexed or performing.
 * Already on the site is shown only when the page was matched and the action is keep.
 */

import type { MapContentType, MapRecordAction, MapRecordStatus, ProductionStatus, TopicalMapRecord } from '../types';

export const PRODUCTION_STATUSES: readonly ProductionStatus[] = [
    'not_written',
    'awaiting_approval',
    'approved',
    'writing',
    'client_review',
    'ready',
    'published',
    'already_live',
    'declined',
    'failed',
];

/** The only status copy on screen. Do not render the stored slugs. */
export const PRODUCTION_STATUS_LABEL: Record<ProductionStatus, string> = {
    not_written: 'Not written yet',
    awaiting_approval: 'Waiting for approval',
    approved: 'Approved to write',
    writing: 'Being written',
    client_review: 'With client for review',
    ready: 'Ready to publish',
    published: 'Published',
    already_live: 'Already on the site',
    declined: 'Not going ahead',
    failed: 'Could not be published',
};

export const PUBLISHED_NOTE =
    'Published means the page is published. It does not mean it is indexed or performing.';

export const CONTENT_TYPES: readonly MapContentType[] = [
    'blog_post',
    'service_page',
    'location_page',
    'landing_page',
    'pillar_page',
    'product_page',
    'faq_page',
    'case_study',
];

export const CONTENT_TYPE_LABEL: Record<MapContentType, string> = {
    blog_post: 'Blog post',
    service_page: 'Service page',
    location_page: 'Location page',
    landing_page: 'Landing page',
    pillar_page: 'Pillar page',
    product_page: 'Product page',
    faq_page: 'FAQ page',
    case_study: 'Case study',
};

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const WORK_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const URL_MAX = 500;

export interface MapProduction {
    productionStatus: ProductionStatus | null;
    workMonth: string | null;
    dueDate: string | null;
    publishedOn: string | null;
    draftUrl: string | null;
    liveUrl: string | null;
    contentType: MapContentType | null;
}

export function emptyProduction(): MapProduction {
    return {
        productionStatus: null,
        workMonth: null,
        dueDate: null,
        publishedOn: null,
        draftUrl: null,
        liveUrl: null,
        contentType: null,
    };
}

function trimmed(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function readProductionStatus(value: unknown): ProductionStatus | null {
    const slug = trimmed(value);
    return (PRODUCTION_STATUSES as readonly string[]).includes(slug) ? slug as ProductionStatus : null;
}

export function readContentType(value: unknown): MapContentType | null {
    const slug = trimmed(value);
    return (CONTENT_TYPES as readonly string[]).includes(slug) ? slug as MapContentType : null;
}

/** A calendar month, YYYY-MM. A display name or an engagement month is not one. */
export function readWorkMonth(value: unknown): string | null {
    const month = trimmed(value);
    return WORK_MONTH.test(month) ? month : null;
}

export function workMonthLabel(value: string | null | undefined): string | null {
    const month = readWorkMonth(value);
    if (!month) return null;
    const match = WORK_MONTH.exec(month);
    if (!match) return null;
    return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

export function readIsoDay(value: unknown): string | null {
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

/** http(s) only. Anything else, including a missing column, reads as not set. */
export function readHttpUrl(value: unknown): string | null {
    const text = trimmed(value);
    if (!text || text.length > URL_MAX) return null;
    try {
        const url = new URL(text);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url.href.length <= URL_MAX ? url.href : null;
    } catch {
        return null;
    }
}

export function canMarkAlreadyLive(record: { action: MapRecordAction; matchedUrl?: string | null }): boolean {
    return record.action === 'keep' && Boolean(record.matchedUrl && record.matchedUrl.trim());
}

/**
 * The status to show.
 * An explicit production status wins, except `already_live`, which is shown
 * only when the record was matched to a live page and the action is keep.
 * With nothing stored, a kept match is already on the site. Otherwise the
 * plan-approval status supplies Not written yet, Approved to write, or Not going ahead.
 */
export function displayedProductionStatus(record: {
    status: MapRecordStatus;
    productionStatus?: ProductionStatus | null;
    action: MapRecordAction;
    matchedUrl?: string | null;
}): ProductionStatus {
    const stored = readProductionStatus(record.productionStatus);
    if (stored && stored !== 'already_live') return stored;
    if (canMarkAlreadyLive(record)) return 'already_live';
    if (record.status === 'declined') return 'declined';
    if (record.status === 'approved') return 'approved';
    return 'not_written';
}

/** Read production columns. Missing keys and unknown values are null, never thrown. */
export function productionFromRow(row: Record<string, unknown>): MapProduction {
    const dates = {
        dueDate: readIsoDay(row.due_date),
        publishedOn: readIsoDay(row.published_on),
    };
    return {
        productionStatus: readProductionStatus(row.production_status),
        workMonth: readWorkMonth(row.work_month),
        dueDate: dates.dueDate,
        publishedOn: dates.publishedOn,
        draftUrl: readHttpUrl(row.draft_url),
        liveUrl: readHttpUrl(row.live_url),
        contentType: readContentType(row.content_type),
    };
}

export function productionToRow(fields: MapProduction): Record<string, string | null> {
    return {
        production_status: fields.productionStatus,
        work_month: fields.workMonth,
        due_date: fields.dueDate,
        published_on: fields.publishedOn,
        draft_url: fields.draftUrl,
        live_url: fields.liveUrl,
        content_type: fields.contentType,
    };
}

type CleanFail = { ok: false; error: string };
type CleanOk = { ok: true; value: Partial<MapProduction> };

function fail(error: string): CleanFail {
    return { ok: false, error };
}

function blank(value: string | null): string | null {
    const text = value?.trim() ?? '';
    return text ? text : null;
}

/**
 * Validate a partial write. Only keys present on the patch are returned.
 * Blank text clears the column. A work month is not copied onto either date.
 */
export function cleanProductionPatch(patch: Partial<MapProduction>): CleanOk | CleanFail {
    const value: Partial<MapProduction> = {};
    if (patch.productionStatus !== undefined) {
        if (patch.productionStatus === null) value.productionStatus = null;
        else if (readProductionStatus(patch.productionStatus)) value.productionStatus = patch.productionStatus;
        else return fail('Choose a status from the list.');
    }
    if (patch.workMonth !== undefined) {
        const month = blank(patch.workMonth);
        if (!month) value.workMonth = null;
        else if (readWorkMonth(month)) value.workMonth = month;
        else return fail('Month needs a real month.');
    }
    if (patch.dueDate !== undefined) {
        const day = blank(patch.dueDate);
        if (!day) value.dueDate = null;
        else {
            const iso = readIsoDay(day);
            if (!iso || iso !== day) return fail('Due date needs a real date.');
            value.dueDate = iso;
        }
    }
    if (patch.publishedOn !== undefined) {
        const day = blank(patch.publishedOn);
        if (!day) value.publishedOn = null;
        else {
            const iso = readIsoDay(day);
            if (!iso || iso !== day) return fail('Date published needs a real date.');
            value.publishedOn = iso;
        }
    }
    if (patch.draftUrl !== undefined) {
        const href = cleanUrl(patch.draftUrl, 'Draft link');
        if (typeof href !== 'string' && href !== null) return href;
        value.draftUrl = href;
    }
    if (patch.liveUrl !== undefined) {
        const href = cleanUrl(patch.liveUrl, 'Live link');
        if (typeof href !== 'string' && href !== null) return href;
        value.liveUrl = href;
    }
    if (patch.contentType !== undefined) {
        if (patch.contentType === null) value.contentType = null;
        else if (readContentType(patch.contentType)) value.contentType = patch.contentType;
        else return fail('Choose a type of page from the list.');
    }
    return { ok: true, value };
}

function cleanUrl(value: string | null, label: string): string | null | CleanFail {
    const text = blank(value);
    if (!text) return null;
    const href = readHttpUrl(text);
    if (!href) return fail(`${label} needs to start with http:// or https://.`);
    return href;
}

export function productionUpdates(
    patch: Partial<TopicalMapRecord>,
): { ok: true; row: Record<string, string | null>; value: Partial<MapProduction> } | CleanFail {
    const cleaned = cleanProductionPatch(patch);
    if (!cleaned.ok) return cleaned;
    const row: Record<string, string | null> = {};
    const value = cleaned.value;
    if (value.productionStatus !== undefined) row.production_status = value.productionStatus;
    if (value.workMonth !== undefined) row.work_month = value.workMonth;
    if (value.dueDate !== undefined) row.due_date = value.dueDate;
    if (value.publishedOn !== undefined) row.published_on = value.publishedOn;
    if (value.draftUrl !== undefined) row.draft_url = value.draftUrl;
    if (value.liveUrl !== undefined) row.live_url = value.liveUrl;
    if (value.contentType !== undefined) row.content_type = value.contentType;
    return { ok: true, row, value };
}
