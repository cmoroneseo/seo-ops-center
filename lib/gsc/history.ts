export type GscGrain = 'property' | 'page' | 'query_page' | 'property_device' | 'page_device' | 'property_country' | 'page_organic';
export type GscSurface = 'organic' | 'gbp_link';
export type GscDevice = 'DESKTOP' | 'MOBILE' | 'TABLET';

/**
 * Search Analytics rejects aggregationType byProperty when a filter groups by page
 * (https://developers.google.com/webmaster-tools/v1/searchanalytics/query).
 * The utm_medium=gbp exclusion is therefore requested as byPage and stored as
 * page-level totals, not a property total.
 */
export const ORGANIC_TOTALS_SCOPE = 'page' as const;
export const ORGANIC_TOTALS_LABEL = 'page-level totals';

const DEVICES = new Set<GscDevice>(['DESKTOP', 'MOBILE', 'TABLET']);

export interface GscFact {
    grain: GscGrain;
    page: string;
    query: string;
    clicks: number;
    impressions: number;
    position: number;
    device: string | null;
    country: string | null;
    surface: GscSurface;
}

export interface GscDay {
    date: string;
    property: string;
    fetchedAt: string;
    pageLimited: boolean;
    queryLimited: boolean;
    facts: GscFact[];
    isIncomplete: boolean;
    organicTotalsScope: typeof ORGANIC_TOTALS_SCOPE | null;
    organicTotalsLabel: typeof ORGANIC_TOTALS_LABEL | null;
}

export interface FetchGscDayOptions {
    fetch?: typeof fetch;
    rowLimit?: number;
    maxPages?: number;
    signal?: AbortSignal;
    now?: Date;
    /** New grains and the page-level organic request. Callers pass the v2 flag. */
    v2?: boolean;
    gbpLandingUrls?: readonly string[];
    /** Minimum gap between Search Analytics calls. 0 keeps today's timing. */
    minIntervalMs?: number;
}

export function dateOffset(date: string, offset: number): string {
    const value = new Date(`${date}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    return value.toISOString().slice(0, 10);
}

export function historyWindow(now = new Date()) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const end = today;
    return { start: dateOffset(end, -27), end };
}

export function historyDates(start: string, end: string): string[] {
    const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid(start) || !valid(end) || start > end) throw new Error('Invalid history date range');
    const count = Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
    if (count > 31) throw new Error('Request at most 31 days at a time');
    return Array.from({ length: count }, (_, index) => dateOffset(start, index));
}

export function planHistoryDays(dates: string[], existing: { data_date: string; imported_at: string }[], limit = 2): string[] {
    const known = new Map(existing.map(day => [day.data_date, day.imported_at]));
    const missing = dates.filter(date => !known.has(date)).reverse();
    // Refresh the newest three days after backfill, oldest import first.
    const refresh = dates.slice(-3).filter(date => known.has(date)).sort((a, b) => known.get(a)!.localeCompare(known.get(b)!));
    return [...missing, ...refresh].slice(0, limit);
}

export function pageIdentity(url: string): string {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}`;
    } catch {
        return url.trim().toLowerCase().replace(/\/+$/, '');
    }
}

/** Property-level rows have an empty page and stay on the column default. */
export function classifySurface(page: string, landingUrls: readonly string[] = []): GscSurface {
    if (!page) return 'organic';
    const lower = page.toLowerCase();
    if (lower.includes('utm_medium=gbp') || lower.includes('utm_medium%3dgbp')) return 'gbp_link';
    const identity = pageIdentity(page);
    if (landingUrls.some(url => url && pageIdentity(url) === identity)) return 'gbp_link';
    return 'organic';
}

export function gbpLandingUrlsFromCustomFields(customFields: unknown): string[] {
    if (!customFields || typeof customFields !== 'object') return [];
    const fields = customFields as Record<string, unknown>;
    const values: unknown[] = [];
    if (typeof fields.gbp_landing_url === 'string') values.push(fields.gbp_landing_url);
    if (Array.isArray(fields.gbp_landing_urls)) values.push(...fields.gbp_landing_urls);
    return values.filter((url): url is string => typeof url === 'string' && url.trim().length > 0);
}

export function pageSurfaceClicks(facts: Pick<GscFact, 'grain' | 'surface' | 'clicks'>[]) {
    const pages = facts.filter(fact => fact.grain === 'page');
    const organic = pages.filter(fact => fact.surface === 'organic').reduce((sum, fact) => sum + fact.clicks, 0);
    const gbpLink = pages.filter(fact => fact.surface === 'gbp_link').reduce((sum, fact) => sum + fact.clicks, 0);
    return { organic, gbp_link: gbpLink, total: organic + gbpLink };
}

export function propertyDeviceClicks(facts: Pick<GscFact, 'grain' | 'clicks'>[]) {
    const property = facts.filter(fact => fact.grain === 'property').reduce((sum, fact) => sum + fact.clicks, 0);
    const devices = facts.filter(fact => fact.grain === 'property_device').reduce((sum, fact) => sum + fact.clicks, 0);
    return { property, devices };
}

/** Impression-weighted average position. Null when the surface has no impressions. */
export function querySurfacePositions(
    facts: Pick<GscFact, 'query' | 'surface' | 'impressions' | 'position'>[],
    query: string,
): { organic: number | null; gbp_link: number | null } {
    const weighted = (surface: GscSurface) => {
        const rows = facts.filter(fact => fact.query === query && fact.surface === surface);
        const impressions = rows.reduce((sum, fact) => sum + fact.impressions, 0);
        if (impressions <= 0) return null;
        const position = rows.reduce((sum, fact) => sum + fact.position * fact.impressions, 0) / impressions;
        return Math.round(position * 10) / 10;
    };
    return { organic: weighted('organic'), gbp_link: weighted('gbp_link') };
}

interface MetricRow {
    keys?: unknown;
    clicks?: unknown;
    impressions?: unknown;
    position?: unknown;
}

function metricValues(row: MetricRow) {
    const clicks = row.clicks;
    const impressions = row.impressions;
    const position = row.position;
    if (![clicks, impressions, position].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) || !Number.isInteger(clicks) || !Number.isInteger(impressions)) {
        throw new Error('Invalid GSC history metrics');
    }
    return { clicks: clicks as number, impressions: impressions as number, position: position as number };
}

function dimensionKeys(row: MetricRow, dimensions: string[]) {
    const keys = row.keys ?? [];
    if (!Array.isArray(keys) || keys.length !== dimensions.length || !keys.every(key => typeof key === 'string' && key.length > 0)) {
        throw new Error('Invalid GSC history dimensions');
    }
    return keys as string[];
}

export async function fetchGscDay(property: string, token: string, date: string, options: FetchGscDayOptions = {}): Promise<GscDay> {
    historyDates(date, date);
    const request = options.fetch ?? fetch;
    const rowLimit = options.rowLimit ?? 1000;
    const maxPages = options.maxPages ?? 5;
    if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25000 || !Number.isInteger(maxPages) || maxPages < 1 || rowLimit * maxPages > 50000) throw new Error('Invalid pagination limits');
    const landingUrls = options.gbpLandingUrls ?? [];
    const result: GscDay = {
        property,
        date,
        fetchedAt: (options.now ?? new Date()).toISOString(),
        pageLimited: false,
        queryLimited: false,
        facts: [],
        isIncomplete: date > dateOffset(historyWindow(options.now).end, -3),
        organicTotalsScope: null,
        organicTotalsLabel: null,
    };
    let lastRequestAt = 0;
    const pause = async () => {
        const gap = options.minIntervalMs ?? 0;
        if (gap <= 0) return;
        const wait = lastRequestAt + gap - Date.now();
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
        lastRequestAt = Date.now();
    };
    const load = async (body: Record<string, unknown>) => {
        await pause();
        const response = await request(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`GSC history request failed (HTTP ${response.status})`);
        return response.json() as Promise<{ rows?: unknown; metadata?: { first_incomplete_date?: unknown }; responseAggregationType?: unknown }>;
    };

    for (const grain of ['property', 'page', 'query_page'] as const) {
        const dimensions = grain === 'property' ? ['date'] : grain === 'page' ? ['page'] : ['query', 'page'];
        const seen = new Set<string>();
        for (let page = 0; page < (grain === 'property' ? 1 : maxPages); page++) {
            const payload = await load({
                startDate: date,
                endDate: date,
                type: 'web',
                dataState: 'all',
                aggregationType: grain === 'property' ? 'byProperty' : 'byPage',
                dimensions,
                rowLimit,
                startRow: page * rowLimit,
            });
            if (grain === 'property' && page === 0 && typeof payload.metadata?.first_incomplete_date === 'string') {
                result.isIncomplete = date >= payload.metadata.first_incomplete_date;
            }
            const rows: unknown = payload.rows ?? [];
            if (!Array.isArray(rows) || rows.length > rowLimit || (grain === 'property' && rows.length > 1)) throw new Error('Invalid GSC history response');
            for (const candidate of rows) {
                if (!candidate || typeof candidate !== 'object') throw new Error('Invalid GSC history metrics');
                const metrics = metricValues(candidate as MetricRow);
                const keys = dimensionKeys(candidate as MetricRow, dimensions);
                if (grain === 'property' && keys[0] !== date) throw new Error('Invalid GSC property date');
                const factPage = grain === 'page' ? keys[0] : grain === 'query_page' ? keys[1] : '';
                const fact: GscFact = {
                    grain,
                    query: grain === 'query_page' ? keys[0] : '',
                    page: factPage,
                    clicks: metrics.clicks,
                    impressions: metrics.impressions,
                    position: metrics.position,
                    device: null,
                    country: null,
                    surface: classifySurface(factPage, landingUrls),
                };
                const key = JSON.stringify([fact.query, fact.page]);
                // Tied rows can shift between pages; fail rather than double-count a day.
                if (seen.has(key)) throw new Error('GSC pagination repeated a row; retry this day');
                seen.add(key);
                result.facts.push(fact);
            }
            if (rows.length < rowLimit || grain === 'property') break;
            if (page === maxPages - 1) {
                if (grain === 'page') result.pageLimited = true;
                else result.queryLimited = true;
            }
        }
    }

    if (options.v2) await appendV2Facts(result, { date, rowLimit, maxPages, landingUrls, load });
    return result;
}

async function appendV2Facts(
    result: GscDay,
    context: {
        date: string;
        rowLimit: number;
        maxPages: number;
        landingUrls: readonly string[];
        load: (body: Record<string, unknown>) => Promise<{ rows?: unknown; responseAggregationType?: unknown }>;
    },
) {
    const { date, rowLimit, maxPages, landingUrls, load } = context;
    const seen = new Set<string>();
    const push = (fact: GscFact) => {
        const key = JSON.stringify([fact.grain, fact.query, fact.page, fact.device, fact.country]);
        if (seen.has(key)) throw new Error('GSC pagination repeated a row; retry this day');
        seen.add(key);
        result.facts.push(fact);
    };

    const devicePayload = await load({
        startDate: date, endDate: date, type: 'web', dataState: 'all', aggregationType: 'byProperty',
        dimensions: ['date', 'device'], rowLimit: 10, startRow: 0,
    });
    const deviceRows = devicePayload.rows ?? [];
    if (!Array.isArray(deviceRows) || deviceRows.length > 3) throw new Error('Invalid GSC history response');
    for (const candidate of deviceRows) {
        if (!candidate || typeof candidate !== 'object') throw new Error('Invalid GSC history metrics');
        const metrics = metricValues(candidate as MetricRow);
        const keys = dimensionKeys(candidate as MetricRow, ['date', 'device']);
        if (keys[0] !== date || !DEVICES.has(keys[1] as GscDevice)) throw new Error('Invalid GSC history dimensions');
        push({
            grain: 'property_device', query: keys[1], page: '', clicks: metrics.clicks, impressions: metrics.impressions,
            position: metrics.position, device: keys[1], country: null,
            // Property device rows are the full property split by device, not an organic/map split.
            surface: 'organic',
        });
    }

    await paginate(date, ['page', 'device'], rowLimit, maxPages, load, (keys, metrics) => {
        if (!DEVICES.has(keys[1] as GscDevice)) throw new Error('Invalid GSC history dimensions');
        push({
            grain: 'page_device', query: keys[1], page: keys[0], clicks: metrics.clicks, impressions: metrics.impressions,
            position: metrics.position, device: keys[1], country: null, surface: classifySurface(keys[0], landingUrls),
        });
    }, () => { result.pageLimited = true; });

    const countryPayload = await load({
        startDate: date, endDate: date, type: 'web', dataState: 'all', aggregationType: 'byProperty',
        dimensions: ['country'], rowLimit: 10, startRow: 0,
    });
    const countryRows = countryPayload.rows ?? [];
    if (!Array.isArray(countryRows) || countryRows.length > 10) throw new Error('Invalid GSC history response');
    for (const candidate of countryRows) {
        if (!candidate || typeof candidate !== 'object') throw new Error('Invalid GSC history metrics');
        const metrics = metricValues(candidate as MetricRow);
        const keys = dimensionKeys(candidate as MetricRow, ['country']);
        if (!/^[a-z]{3}$/.test(keys[0])) throw new Error('Invalid GSC history dimensions');
        push({
            grain: 'property_country', query: keys[0], page: '', clicks: metrics.clicks, impressions: metrics.impressions,
            position: metrics.position, device: null, country: keys[0], surface: 'organic',
        });
    }

    // Page filter + byProperty is rejected by Search Analytics. byPage totals are page-level.
    result.organicTotalsScope = ORGANIC_TOTALS_SCOPE;
    result.organicTotalsLabel = ORGANIC_TOTALS_LABEL;
    await paginate(date, ['page'], rowLimit, maxPages, async body => {
        const payload = await load({
            ...body,
            aggregationType: 'byPage',
            dimensionFilterGroups: [{
                groupType: 'and',
                filters: [{ dimension: 'page', operator: 'notContains', expression: 'utm_medium=gbp' }],
            }],
        });
        if (payload.responseAggregationType != null && payload.responseAggregationType !== 'byPage') {
            throw new Error('Invalid GSC history response');
        }
        return payload;
    }, (keys, metrics) => {
        push({
            grain: 'page_organic', query: '', page: keys[0], clicks: metrics.clicks, impressions: metrics.impressions,
            position: metrics.position, device: null, country: null, surface: 'organic',
        });
    }, () => { result.pageLimited = true; });
}

async function paginate(
    date: string,
    dimensions: string[],
    rowLimit: number,
    maxPages: number,
    load: (body: Record<string, unknown>) => Promise<{ rows?: unknown }>,
    accept: (keys: string[], metrics: { clicks: number; impressions: number; position: number }) => void,
    onCapped: () => void,
) {
    for (let page = 0; page < maxPages; page++) {
        const payload = await load({
            startDate: date,
            endDate: date,
            type: 'web',
            dataState: 'all',
            aggregationType: 'byPage',
            dimensions,
            rowLimit,
            startRow: page * rowLimit,
        });
        const rows: unknown = payload.rows ?? [];
        if (!Array.isArray(rows) || rows.length > rowLimit) throw new Error('Invalid GSC history response');
        for (const candidate of rows) {
            if (!candidate || typeof candidate !== 'object') throw new Error('Invalid GSC history metrics');
            accept(dimensionKeys(candidate as MetricRow, dimensions), metricValues(candidate as MetricRow));
        }
        if (rows.length < rowLimit) return;
        if (page === maxPages - 1) onCapped();
    }
}

export function rowToHistoryDay(row: { id: string; data_date: string; imported_at: string; page_limited: boolean; query_limited: boolean; is_incomplete?: boolean }) {
    return { id: row.id, date: row.data_date, importedAt: row.imported_at, pageLimited: row.page_limited, queryLimited: row.query_limited, isIncomplete: row.is_incomplete ?? false };
}

export function rowToHistoryFact(row: { id: number; day_id: string; page: string; query: string; clicks: number; impressions: number; position: number }) {
    return { id: row.id, dayId: row.day_id, page: row.page, query: row.query, clicks: row.clicks, impressions: row.impressions, position: row.position, ctr: row.impressions > 0 ? row.clicks / row.impressions : 0 };
}
