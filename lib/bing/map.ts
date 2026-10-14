import { parseBingDate } from './date';

export interface BingSite {
    siteUrl: string;
    verified: boolean;
}

export interface BingTrafficRow {
    data_date: string;
    clicks: number;
    impressions: number;
}

export interface BingQueryRow {
    week_ending: string;
    query: string;
    clicks: number;
    impressions: number;
    avg_impression_position: number | null;
    avg_click_position: number | null;
}

export interface BingPageRow {
    week_ending: string;
    page: string;
    clicks: number;
    impressions: number;
    avg_impression_position: number | null;
    avg_click_position: number | null;
}

export type BingBatch<T> = { ok: true; rows: T[] } | { ok: false };

const TRAFFIC_CAP = 800;
const WEEK_CAP = 100000;
const TEXT_CAP = 2000;

/**
 * WCF JSON is either `{ d: [...] }` or a bare array.
 * An error object is not an empty account. Callers must not mark sites unverified.
 */
export function unwrapBingList(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === 'object' && 'd' in payload) {
        const inner = (payload as { d: unknown }).d;
        if (Array.isArray(inner)) return inner;
    }
    throw new Error('Bing Webmaster response was not a list');
}

function textField(row: Record<string, unknown>, ...keys: string[]): string | null {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string') return value;
    }
    return null;
}

/** Verified flag and exact URL only. Authentication codes are dropped. */
export function mapUserSites(payload: unknown): BingSite[] {
    const sites: BingSite[] = [];
    for (const entry of unwrapBingList(payload)) {
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>;
        const url = textField(row, 'Url', 'url');
        if (url == null) continue;
        const siteUrl = url.trim();
        if (siteUrl === '' || siteUrl.length > TEXT_CAP) continue;
        const verified = row.IsVerified === true || row.isVerified === true;
        sites.push({ siteUrl, verified });
    }
    return sites;
}

function count(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
    return value;
}

/**
 * Missing position is stored as null. Bing sends -1 when a position has no
 * value, and that is null too. A non-number or non-finite value fails the batch.
 */
function position(value: unknown): number | null | undefined {
    if (value == null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    if (value < 0) return null;
    return value;
}

function dateField(row: Record<string, unknown>): string | null {
    return parseBingDate(textField(row, 'Date', 'date'));
}

export function mapTraffic(payload: unknown): BingBatch<BingTrafficRow> {
    let list: unknown[];
    try {
        list = unwrapBingList(payload);
    } catch {
        return { ok: false };
    }
    if (list.length > TRAFFIC_CAP) return { ok: false };
    const rows: BingTrafficRow[] = [];
    const seen = new Set<string>();
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') return { ok: false };
        const row = entry as Record<string, unknown>;
        const dataDate = dateField(row);
        const clicks = count(row.Clicks ?? row.clicks);
        const impressions = count(row.Impressions ?? row.impressions);
        if (!dataDate || clicks == null || impressions == null) return { ok: false };
        if (seen.has(dataDate)) return { ok: false };
        seen.add(dataDate);
        rows.push({ data_date: dataDate, clicks, impressions });
    }
    return { ok: true, rows };
}

function mapWeeks<T extends BingQueryRow | BingPageRow>(
    payload: unknown,
    label: 'query' | 'page',
): BingBatch<T> {
    let list: unknown[];
    try {
        list = unwrapBingList(payload);
    } catch {
        return { ok: false };
    }
    if (list.length > WEEK_CAP) return { ok: false };
    const rows: T[] = [];
    const seen = new Set<string>();
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') return { ok: false };
        const row = entry as Record<string, unknown>;
        const weekEnding = dateField(row);
        const raw = textField(row, 'Query', 'query');
        const text = raw?.trim() ?? '';
        const clicks = count(row.Clicks ?? row.clicks);
        const impressions = count(row.Impressions ?? row.impressions);
        const impressionPosition = position(row.AvgImpressionPosition ?? row.avgImpressionPosition);
        const clickPosition = position(row.AvgClickPosition ?? row.avgClickPosition);
        if (!weekEnding || text === '' || text.length > TEXT_CAP || clicks == null || impressions == null) {
            return { ok: false };
        }
        if (impressionPosition === undefined || clickPosition === undefined) return { ok: false };
        const key = `${weekEnding}\n${text}`;
        if (seen.has(key)) return { ok: false };
        seen.add(key);
        const base = {
            week_ending: weekEnding,
            clicks,
            impressions,
            avg_impression_position: impressionPosition,
            avg_click_position: clickPosition,
        };
        if (label === 'query') rows.push({ ...base, query: text } as T);
        else rows.push({ ...base, page: text } as T);
    }
    return { ok: true, rows };
}

/** One Bing query row stays one week. It is not split into days. */
export function mapQueryWeeks(payload: unknown): BingBatch<BingQueryRow> {
    return mapWeeks<BingQueryRow>(payload, 'query');
}

/** Page stats use the same shape. The page URL arrives in Query. */
export function mapPageWeeks(payload: unknown): BingBatch<BingPageRow> {
    return mapWeeks<BingPageRow>(payload, 'page');
}
