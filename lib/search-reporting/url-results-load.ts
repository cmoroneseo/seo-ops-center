import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeShipDate } from '@/lib/search-reporting/proof';
import { normalizeResultUrl } from '@/lib/search-reporting/result-url';
import { ptToday } from '@/lib/sync/months';
import type { SearchReportingAdmin, SearchQuery } from './load';
import {
    liveUrlCoverage,
    summarizeUrlResult,
    type UrlMetricRow,
    type UrlQueryRow,
    type UrlResultReadout,
} from './url-results';

export interface UrlResultsPayload {
    connected: boolean;
    byId: Record<string, UrlResultReadout>;
}

export interface UrlResultsLoadInput {
    organizationId: string;
    clientId: string;
    now: Date;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) ? parsed : null;
    }
    return null;
}

function positionOf(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function dayText(value: unknown): string | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
    return normalizeShipDate(text(value));
}

async function readPages(build: () => SearchQuery): Promise<Record<string, unknown>[]> {
    const pageSize = 1000;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await build().range(from, from + pageSize - 1);
        if (error) throw new Error('Unable to read URL results');
        const batch = (data ?? []) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < pageSize) return rows;
    }
}

export async function loadUrlResults(
    input: UrlResultsLoadInput,
    admin: SearchReportingAdmin = createAdminClient() as unknown as SearchReportingAdmin,
): Promise<UrlResultsPayload> {
    const integrationResult = await admin.from('client_integrations')
        .select('site_url:credentials->>site_url')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('service', 'gsc')
        .maybeSingle();
    if (integrationResult.error) throw new Error('Unable to read URL results');
    const integration = integrationResult.data && typeof integrationResult.data === 'object'
        ? integrationResult.data as { site_url?: unknown }
        : null;
    const property = text(integration?.site_url);
    if (!property) return { connected: false, byId: {} };

    const taskRows = await readPages(() => admin.from('tasks')
        .select('id, published_url, completed_at, status')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('status', 'done'));
    const deliverableRows = await readPages(() => admin.from('deliverables')
        .select('id, published_url, delivered_on, status')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('status', 'Published'));
    const subjects = [
        ...taskRows.flatMap(row => {
            const id = text(row.id);
            const url = text(row.published_url);
            const goLive = normalizeShipDate(text(row.completed_at));
            return id && url && goLive && row.status === 'done' ? [{ id, url, goLive }] : [];
        }),
        ...deliverableRows.flatMap(row => {
            const id = text(row.id);
            const url = text(row.published_url);
            const goLive = normalizeShipDate(text(row.delivered_on));
            return id && url && goLive && row.status === 'Published' ? [{ id, url, goLive }] : [];
        }),
    ];
    if (subjects.length === 0) return { connected: true, byId: {} };

    const today = ptToday(input.now);
    const [checks, days, queries] = await Promise.all([
        readPages(() => admin.from('gsc_live_url_checks')
            .select('url_key, coverage_start, query_window_start, query_window_end, has_rows')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)),
        readPages(() => admin.from('gsc_live_url_days')
            .select('url_key, data_date, clicks, impressions, position')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)),
        readPages(() => admin.from('gsc_live_url_queries')
            .select('url_key, query, clicks, impressions, position, window_start, window_end')
            .eq('organization_id', input.organizationId)
            .eq('client_id', input.clientId)
            .eq('property', property)),
    ]);

    const checkByKey = new Map<string, { coverageStart: string | null; queryStart: string | null; queryEnd: string | null; hasRows: boolean }>();
    for (const row of checks) {
        const key = text(row.url_key);
        if (!key) continue;
        checkByKey.set(key, {
            coverageStart: dayText(row.coverage_start),
            queryStart: dayText(row.query_window_start),
            queryEnd: dayText(row.query_window_end),
            hasRows: row.has_rows === true,
        });
    }
    const daysByKey = new Map<string, UrlMetricRow[]>();
    for (const row of days) {
        const key = text(row.url_key);
        const date = dayText(row.data_date);
        const clicks = integer(row.clicks);
        const impressions = integer(row.impressions);
        const position = positionOf(row.position);
        if (!key || !date || clicks == null || impressions == null || position == null) continue;
        const list = daysByKey.get(key) ?? [];
        list.push({ date, clicks, impressions, position });
        daysByKey.set(key, list);
    }
    const queriesByKey = new Map<string, { windowStart: string | null; windowEnd: string | null; rows: UrlQueryRow[] }>();
    for (const row of queries) {
        const key = text(row.url_key);
        const query = text(row.query);
        const clicks = integer(row.clicks);
        const impressions = integer(row.impressions);
        const position = positionOf(row.position);
        if (!key || !query || clicks == null || impressions == null || position == null) continue;
        const current = queriesByKey.get(key) ?? { windowStart: dayText(row.window_start), windowEnd: dayText(row.window_end), rows: [] };
        current.rows.push({ query, clicks, impressions, position });
        queriesByKey.set(key, current);
    }

    const byId: Record<string, UrlResultReadout> = {};
    for (const subject of subjects) {
        const urlKey = normalizeResultUrl(subject.url);
        if (!urlKey) continue;
        const check = checkByKey.get(urlKey);
        if (!check) continue;
        const windows = liveUrlCoverage(subject.goLive, today);
        const storedQueries = queriesByKey.get(urlKey);
        const queriesMatch = windows != null
            && storedQueries?.windowStart === windows.afterStart
            && storedQueries.windowEnd === windows.afterEnd;
        const readout = summarizeUrlResult({
            connected: true,
            checked: true,
            goLive: subject.goLive,
            today,
            coverageStart: check.coverageStart,
            rows: check.hasRows ? (daysByKey.get(urlKey) ?? []) : [],
            queries: check.hasRows && queriesMatch ? (storedQueries?.rows ?? []) : [],
        });
        if (readout.kind !== 'hidden') byId[subject.id] = readout;
    }
    return { connected: true, byId };
}
