/** Daily GA4 pull, quota, and report parsing. Missing measurements stay null. */

export const GA4_DAILY_REPAIR_DAYS = 3;
export const GA4_FINAL_AFTER_DAYS = 3;
export const GA4_HOURLY_TOKEN_LIMIT = 40_000;
export const GA4_QUOTA_REMAINING_RATIO = 0.2;
export const GA4_MAX_CONCURRENT_JOBS = 5;
export const GA4_MAX_JOBS_PER_PROPERTY = 1;
export const GA4_BACKOFF_BASE_SECONDS = 15 * 60;
export const GA4_BACKOFF_CAP_SECONDS = 6 * 60 * 60;
export const GA4_AUTH_DELAY_SECONDS = 6 * 60 * 60;
export const GA4_DAILY_COOLDOWN_SECONDS = 20 * 60 * 60;
export const GA4_ORGANIC_CHANNEL = 'Organic Search';
export const GA4_REPORT_ROW_LIMIT = 10_000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface QuotaBucket {
    consumed?: number;
    remaining?: number;
}

export interface PropertyQuotaSnapshot {
    tokensPerHour?: QuotaBucket;
    tokensPerDay?: QuotaBucket;
    tokensPerProjectPerHour?: QuotaBucket;
}

export interface Ga4DayWrite {
    day: string;
    isFinal: boolean;
    sampled: boolean;
    thresholded: boolean;
    daily: {
        organic_sessions: number | null;
        sessions: number | null;
        engaged_sessions: number | null;
        engagement_rate: number | null;
        key_events: number | null;
        total_key_events_by_name: Record<string, number | null> | null;
    };
    landingPages: Ga4LandingWrite[];
}

export interface Ga4LandingWrite {
    landing_page_raw: string;
    landing_page_norm: string;
    organic_sessions: number | null;
    engaged_sessions: number | null;
    key_events: number | null;
}

export function utcDay(now: Date): string {
    return now.toISOString().slice(0, 10);
}

export function addUtcDays(iso: string, days: number): string {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Yesterday and the two days before it. GA4 is late, so each night re-pulls all three. */
export function dailyRepairDates(now: Date): string[] {
    const today = utcDay(now);
    return [1, 2, 3].map(offset => addUtcDays(today, -offset));
}

/** A day is final once it is at least three UTC days old. Yesterday stays open. */
export function isGa4DayFinal(day: string, now: Date): boolean {
    return day <= addUtcDays(utcDay(now), -GA4_FINAL_AFTER_DAYS);
}

export function eachUtcDate(start: string, end: string): string[] {
    if (!ISO_DAY.test(start) || !ISO_DAY.test(end) || start > end) return [];
    const dates: string[] = [];
    let cursor = start;
    while (cursor <= end && dates.length <= 31) {
        dates.push(cursor);
        cursor = addUtcDays(cursor, 1);
    }
    return dates;
}

export function ga4BackoffSeconds(attempts: number): number {
    const exponent = Math.min(Math.max(Math.floor(attempts) - 1, 0), 5);
    return Math.min(GA4_BACKOFF_CAP_SECONDS, GA4_BACKOFF_BASE_SECONDS * 2 ** exponent);
}

export function quotaRemainingRatio(bucket: QuotaBucket | undefined): number | null {
    if (!bucket || typeof bucket.remaining !== 'number' || !Number.isFinite(bucket.remaining)) return null;
    const consumed = typeof bucket.consumed === 'number' && Number.isFinite(bucket.consumed) ? bucket.consumed : null;
    const limit = consumed == null ? GA4_HOURLY_TOKEN_LIMIT : consumed + bucket.remaining;
    if (limit <= 0) return null;
    return bucket.remaining / limit;
}

export type Ga4QuotaPause = 'property' | 'project';

/**
 * Project hourly tokens pause the whole chain. A single property's hourly
 * tokens pause that property and let the next property run.
 */
export function quotaPauseScope(quota: PropertyQuotaSnapshot | null | undefined): Ga4QuotaPause | null {
    if (!quota) return null;
    const project = quotaRemainingRatio(quota.tokensPerProjectPerHour);
    if (project != null && project < GA4_QUOTA_REMAINING_RATIO) return 'project';
    const property = quotaRemainingRatio(quota.tokensPerHour);
    if (property != null && property < GA4_QUOTA_REMAINING_RATIO) return 'property';
    return null;
}

/** Pause when hourly property tokens or project tokens have less than 20% left. */
export function shouldRescheduleForQuota(quota: PropertyQuotaSnapshot | null | undefined): boolean {
    return quotaPauseScope(quota) != null;
}

export function readPropertyQuota(body: unknown): PropertyQuotaSnapshot | null {
    if (!body || typeof body !== 'object') return null;
    const quota = (body as { propertyQuota?: unknown }).propertyQuota;
    if (!quota || typeof quota !== 'object') return null;
    const source = quota as Record<string, unknown>;
    const bucket = (value: unknown): QuotaBucket | undefined => {
        if (!value || typeof value !== 'object') return undefined;
        const record = value as { consumed?: unknown; remaining?: unknown };
        return {
            ...(typeof record.consumed === 'number' ? { consumed: record.consumed } : {}),
            ...(typeof record.remaining === 'number' ? { remaining: record.remaining } : {}),
        };
    };
    return {
        tokensPerHour: bucket(source.tokensPerHour),
        tokensPerDay: bucket(source.tokensPerDay),
        tokensPerProjectPerHour: bucket(source.tokensPerProjectPerHour),
    };
}

export function strictestQuota(bodies: unknown[]): PropertyQuotaSnapshot | null {
    let strictest: PropertyQuotaSnapshot | null = null;
    let strictestRatio = Number.POSITIVE_INFINITY;
    for (const body of bodies) {
        const quota = readPropertyQuota(body);
        if (!quota) continue;
        const ratio = quotaRemainingRatio(quota.tokensPerHour);
        if (ratio != null && ratio < strictestRatio) {
            strictest = quota;
            strictestRatio = ratio;
        } else if (!strictest) {
            strictest = quota;
        }
    }
    return strictest;
}

export function organicChannelFilter() {
    return {
        filter: {
            fieldName: 'sessionDefaultChannelGroup',
            stringFilter: { matchType: 'EXACT' as const, value: GA4_ORGANIC_CHANNEL },
        },
    };
}

export function ga4ReportBody(input: {
    start: string;
    end: string;
    metrics: string[];
    dimensions: string[];
    dimensionFilter?: unknown;
}) {
    return {
        dateRanges: [{ startDate: input.start, endDate: input.end }],
        metrics: input.metrics.map(name => ({ name })),
        dimensions: input.dimensions.map(name => ({ name })),
        ...(input.dimensionFilter ? { dimensionFilter: input.dimensionFilter } : {}),
        limit: GA4_REPORT_ROW_LIMIT,
        returnPropertyQuota: true,
    };
}

export function eventNameFilter(names: string[]) {
    return {
        filter: {
            fieldName: 'eventName',
            inListFilter: { values: names },
        },
    };
}

/** Path-only key. Query and fragment are not part of the landing-page identity. */
export function normalizeGa4LandingPage(raw: string): string | null {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 2000) return null;
    const withoutHash = trimmed.split('#')[0] ?? '';
    const withoutQuery = withoutHash.split('?')[0] ?? '';
    const collapsed = withoutQuery.replace(/\/{2,}/g, '/');
    if (!collapsed) return null;
    const slashed = collapsed.startsWith('/') || collapsed.startsWith('(') ? collapsed : `/${collapsed}`;
    const stripped = slashed.length > 1 ? slashed.replace(/\/+$/, '') : slashed;
    const norm = stripped.toLowerCase();
    return norm.length > 0 && norm.length <= 2000 ? norm : null;
}

function metricNumber(raw: unknown): number | null {
    if (typeof raw !== 'string' || raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
}

function ga4Date(raw: string | undefined): string | null {
    if (!raw || !/^\d{8}$/.test(raw)) return null;
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return ISO_DAY.test(iso) ? iso : null;
}

interface IndexedReport {
    rows: Array<{ dimensions: string[]; metrics: Array<number | null> }>;
    sampled: boolean;
    thresholded: boolean;
}

export function indexGa4Report(body: unknown): IndexedReport {
    const record = body && typeof body === 'object' ? body as {
        rows?: unknown;
        metadata?: { samplingMetadatas?: unknown; subjectToThresholding?: unknown };
    } : {};
    const rows = Array.isArray(record.rows) ? record.rows : [];
    const sampling = record.metadata?.samplingMetadatas;
    return {
        sampled: Array.isArray(sampling) && sampling.length > 0,
        thresholded: record.metadata?.subjectToThresholding === true,
        rows: rows.flatMap(row => {
            if (!row || typeof row !== 'object') return [];
            const recordRow = row as { dimensionValues?: unknown; metricValues?: unknown };
            const dimensions = Array.isArray(recordRow.dimensionValues)
                ? recordRow.dimensionValues.map(value => (
                    value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string'
                        ? (value as { value: string }).value
                        : ''
                ))
                : [];
            const metrics = Array.isArray(recordRow.metricValues)
                ? recordRow.metricValues.map(value => metricNumber(
                    value && typeof value === 'object' ? (value as { value?: unknown }).value : undefined,
                ))
                : [];
            return [{ dimensions, metrics }];
        }),
    };
}

function mergeMetric(current: number | null | undefined, next: number | null): number | null {
    if (current === undefined) return next;
    if (current == null || next == null) return null;
    return current + next;
}

/**
 * Build one write per requested day. A day the report does not mention keeps
 * null metrics. A metric value of "0" stays 0. Key-event totals stay null
 * when any selected event is absent, so a missing event is not counted as zero.
 */
export function assembleGa4Days(input: {
    dates: string[];
    now: Date;
    keyEvents: string[] | null;
    totals: unknown;
    organic: unknown;
    events: unknown;
    landing: unknown;
}): Ga4DayWrite[] {
    const totals = indexGa4Report(input.totals);
    const organic = indexGa4Report(input.organic);
    const events = indexGa4Report(input.events);
    const landing = indexGa4Report(input.landing);
    const sampled = totals.sampled || organic.sampled || events.sampled || landing.sampled;
    const thresholded = totals.thresholded || organic.thresholded || events.thresholded || landing.thresholded;
    const selected = input.keyEvents ?? [];

    const totalsByDay = new Map<string, Array<number | null>>();
    for (const row of totals.rows) {
        const day = ga4Date(row.dimensions[0]);
        if (day) totalsByDay.set(day, row.metrics);
    }
    const organicByDay = new Map<string, Array<number | null>>();
    for (const row of organic.rows) {
        const day = ga4Date(row.dimensions[0]);
        if (day) organicByDay.set(day, row.metrics);
    }
    const eventsByDay = new Map<string, Map<string, number | null>>();
    for (const row of events.rows) {
        const day = ga4Date(row.dimensions[0]);
        const name = row.dimensions[1];
        if (!day || !name) continue;
        const bucket = eventsByDay.get(day) ?? new Map<string, number | null>();
        bucket.set(name, row.metrics[0] ?? null);
        eventsByDay.set(day, bucket);
    }
    const landingByDay = new Map<string, Map<string, Ga4LandingWrite>>();
    for (const row of landing.rows) {
        const day = ga4Date(row.dimensions[0]);
        const raw = row.dimensions[1]?.trim();
        if (!day || !raw) continue;
        const norm = normalizeGa4LandingPage(raw);
        if (!norm) continue;
        const pages = landingByDay.get(day) ?? new Map<string, Ga4LandingWrite>();
        const current = pages.get(norm);
        pages.set(norm, {
            landing_page_raw: current?.landing_page_raw ?? raw,
            landing_page_norm: norm,
            organic_sessions: mergeMetric(current?.organic_sessions, row.metrics[0] ?? null),
            engaged_sessions: mergeMetric(current?.engaged_sessions, row.metrics[1] ?? null),
            key_events: mergeMetric(current?.key_events, row.metrics[2] ?? null),
        });
        landingByDay.set(day, pages);
    }

    return input.dates.map(day => {
        const total = totalsByDay.get(day);
        const organicMetrics = organicByDay.get(day);
        const named = eventsByDay.get(day);
        const breakdown = selected.length === 0 ? null : Object.fromEntries(selected.map(name => [name, named?.get(name) ?? null]));
        const values = breakdown ? Object.values(breakdown) : [];
        const measured = values.filter((value): value is number => value != null);
        const keyEvents = values.length > 0 && measured.length === values.length
            ? measured.reduce((sum, value) => sum + value, 0)
            : null;
        const pages = [...(landingByDay.get(day)?.values() ?? [])];
        return {
            day,
            isFinal: isGa4DayFinal(day, input.now),
            sampled,
            thresholded,
            daily: {
                organic_sessions: organicMetrics ? organicMetrics[0] ?? null : null,
                sessions: total ? total[0] ?? null : null,
                engaged_sessions: total ? total[1] ?? null : null,
                engagement_rate: total ? total[2] ?? null : null,
                key_events: keyEvents,
                total_key_events_by_name: breakdown,
            },
            landingPages: pages,
        };
    });
}
