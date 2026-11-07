/**
 * Property and query clicks for the current Rankings window.
 *
 * Ground truth is gsc_history_facts already stored for the client: grain
 * "property" and grain "query_page". No new Search Console sync. No service
 * role. The signed-in browser client reads through the same RLS as Rankings.
 * Other grains, and anything outside Search Console, are not part of this sum.
 *
 * Visible query clicks are the stored query_page rows. Unattributed is
 * property clicks minus that sum, computed by splitBrandClicks. A day that is
 * missing, still incomplete, or marked query_limited makes the split
 * unmeasurable rather than a partial total shown as complete. A negative
 * remainder is left intact when both sides were measured.
 */

import { eachDate } from '../search-reporting/range';
import { readGrainedFacts } from '../search-reporting/fact-read';
import type { SearchQuery, SearchReportingAdmin } from '../search-reporting/load';
import { normalizeTrackerQuery } from '../search-reporting/tracker';
import { createClient } from '../supabase/client';
import type { BrandOverride, BrandQueryClicks } from './brand';
import { keywordTrackingEnabled } from './flag';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_SIZE = 1000;

export interface BrandClickWindow {
    start: string;
    end: string;
}

export interface BrandClickMeasurement {
    propertyClicks: number | null;
    /** Null when visible query clicks were not measured. Empty means a measured zero. */
    queries: BrandQueryClicks[] | null;
    overrides: BrandOverride[];
}

export type BrandClickLoad =
    | { enabled: false }
    | { enabled: true; ok: false; error: string }
    | {
        enabled: true;
        ok: true;
        connected: boolean;
        measurement: BrandClickMeasurement | null;
        /** Why the split cannot be measured. Empty when the numbers are complete or still loading. */
        detail: string;
    };

function unmeasured(): BrandClickMeasurement {
    return { propertyClicks: null, queries: null, overrides: [] };
}

function validWindow(window: BrandClickWindow): boolean {
    return ISO_DATE.test(window.start) && ISO_DATE.test(window.end) && window.start <= window.end;
}

function isoDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const date = value.slice(0, 10);
    return ISO_DATE.test(date) ? date : null;
}

function siteUrlOf(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const siteUrl = (value as { site_url?: unknown }).site_url;
    if (typeof siteUrl !== 'string') return null;
    const trimmed = siteUrl.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function clickCount(value: unknown): number | null {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
}

async function readPages(build: () => SearchQuery): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < 5; page += 1) {
        const from = page * PAGE_SIZE;
        const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
        if (error) throw new Error('Unable to read Search Console clicks');
        const batch = Array.isArray(data) ? data as Record<string, unknown>[] : null;
        if (!batch) throw new Error('Unable to read Search Console clicks');
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) return rows;
    }
    throw new Error('Unable to read Search Console clicks');
}

function sumProperty(dayIds: readonly string[], rows: readonly Record<string, unknown>[]): number | null {
    const wanted = new Set(dayIds);
    const byDay = new Map<string, number>();
    for (const row of rows) {
        if (row.grain !== 'property') continue;
        const dayId = typeof row.day_id === 'string' ? row.day_id : '';
        if (!wanted.has(dayId)) continue;
        const clicks = clickCount(row.clicks);
        if (clicks == null || byDay.has(dayId)) return null;
        byDay.set(dayId, clicks);
    }
    if (byDay.size !== wanted.size) return null;
    let sum = 0;
    for (const clicks of byDay.values()) {
        sum += clicks;
        if (!Number.isSafeInteger(sum)) return null;
    }
    return sum;
}

function sumQueries(rows: readonly Record<string, unknown>[]): BrandQueryClicks[] | null {
    const byQuery = new Map<string, number>();
    for (const row of rows) {
        if (row.grain !== 'query_page') continue;
        const clicks = clickCount(row.clicks);
        if (clicks == null) return null;
        if (clicks === 0) continue;
        const query = typeof row.query === 'string' ? row.query : '';
        const key = normalizeTrackerQuery(query) || query;
        if (!key) return null;
        const next = (byQuery.get(key) ?? 0) + clicks;
        if (!Number.isSafeInteger(next)) return null;
        byQuery.set(key, next);
    }
    return [...byQuery].map(([query, clicks]) => ({ query, clicks }));
}

function overridesFrom(rows: readonly Record<string, unknown>[]): BrandOverride[] {
    const overrides: BrandOverride[] = [];
    for (const row of rows) {
        if (row.is_branded_override !== true && row.is_branded_override !== false) continue;
        const normalizedKey = typeof row.normalized_key === 'string' ? row.normalized_key : '';
        if (!normalizedKey) throw new Error('Unable to read Search Console clicks');
        overrides.push({ normalizedKey, branded: row.is_branded_override });
    }
    return overrides;
}

export async function loadBrandClicks(input: {
    organizationId: string;
    clientId: string;
    window: BrandClickWindow;
    /** Injected in tests. Omitted uses the signed-in browser client. */
    client?: SearchReportingAdmin | null;
}): Promise<BrandClickLoad> {
    if (!keywordTrackingEnabled()) return { enabled: false };
    if (!validWindow(input.window)) return { enabled: true, ok: false, error: 'Could not read Search Console clicks.' };
    const admin = input.client === undefined
        ? createClient() as unknown as SearchReportingAdmin | undefined
        : input.client;
    if (!admin) return { enabled: true, ok: false, error: 'Could not read Search Console clicks.' };

    try {
        const integration = await admin.from('client_integrations')
            .select('site_url:credentials->>site_url')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('service', 'gsc')
            .maybeSingle();
        if (integration.error) throw new Error('Unable to read Search Console clicks');
        const property = siteUrlOf(integration.data);
        if (!property) return { enabled: true, ok: true, connected: false, measurement: null, detail: '' };

        const dayRows = await readPages(() => admin.from('gsc_history_days')
            .select('id, data_date, is_incomplete, query_limited')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)
            .eq('search_type', 'web')
            .gte('data_date', input.window.start)
            .lte('data_date', input.window.end)
            .order('data_date', { ascending: true }));
        const expected = eachDate(input.window.start, input.window.end);
        const byDate = new Map<string, { id: string; queryLimited: boolean }>();
        for (const row of dayRows) {
            const date = isoDate(row.data_date);
            const id = typeof row.id === 'string' ? row.id : '';
            if (!date || !id || !expected.includes(date)) continue;
            if (row.is_incomplete === true) continue;
            byDate.set(date, { id, queryLimited: row.query_limited === true });
        }
        const covered = expected.every(date => byDate.has(date));
        if (!covered) {
            return {
                enabled: true,
                ok: true,
                connected: true,
                measurement: unmeasured(),
                detail: 'Search Console is missing days in this window.',
            };
        }
        const dayIds = expected.map(date => byDate.get(date)?.id ?? '');
        const queryLimited = expected.some(date => byDate.get(date)?.queryLimited === true);

        const keywordRows = await readPages(() => admin.from('tracked_keywords')
            .select('normalized_key, is_branded_override')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .order('id', { ascending: true }));
        const overrides = overridesFrom(keywordRows);

        const factRead = await readGrainedFacts(admin, {
            dayIds,
            grains: queryLimited ? ['property'] : ['property', 'query_page'],
            columns: 'day_id, grain, query, clicks',
        });
        if (factRead.failedGrains.length > 0) {
            console.error('Could not read Search Console clicks.');
            return { enabled: true, ok: false, error: 'Could not read Search Console clicks.' };
        }
        const propertyClicks = sumProperty(dayIds, factRead.rows);
        const queries = queryLimited ? null : sumQueries(factRead.rows);
        return {
            enabled: true,
            ok: true,
            connected: true,
            measurement: { propertyClicks, queries, overrides },
            detail: queryLimited ? 'Stored query clicks for this window are incomplete.' : '',
        };
    } catch {
        console.error('Could not read Search Console clicks.');
        return { enabled: true, ok: false, error: 'Could not read Search Console clicks.' };
    }
}
