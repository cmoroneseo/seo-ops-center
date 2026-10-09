import { createAdminClient } from '@/lib/supabase/admin';
import type { GscDevice, GscGrain, GscSurface } from '@/lib/gsc/history';
import { historySpan, parseRange, resolveRange } from './range';
import { ptToday } from '@/lib/sync/months';
import { ahrefsReferenceRows, cityTokensFromCustomFields } from './tracker';
import type { AhrefsReferenceRow, StoredDay, StoredFact } from './types';

export interface SearchReportingAdmin {
    from(table: string): {
        select(columns: string): SearchQuery;
    };
}

export interface SearchQuery {
    eq(column: string, value: unknown): SearchQuery;
    gte(column: string, value: unknown): SearchQuery;
    lte(column: string, value: unknown): SearchQuery;
    in(column: string, values: readonly unknown[]): SearchQuery;
    order(column: string, options?: { ascending?: boolean }): SearchQuery;
    range(from: number, to: number): PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>;
    maybeSingle(): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export interface LoadInput {
    organizationId: string;
    clientId: string;
    range: string | null;
    now: Date;
    cityTokens: string[];
}

export interface LoadedSearch {
    connected: boolean;
    property: string | null;
    clientName: string;
    cityTokens: string[];
    days: StoredDay[];
    facts: StoredFact[];
    ahrefsRows: AhrefsReferenceRow[];
    ahrefsSyncedAt: string | null;
    lastSyncAt: string | null;
    lastSyncErrored: boolean;
}

const GRAINS = new Set<GscGrain>(['property', 'page', 'query_page', 'property_device', 'page_device', 'property_country', 'page_organic']);
const FACT_GRAINS = ['property', 'page', 'query_page', 'property_device', 'page_device', 'page_organic'];

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

async function readPages(build: () => SearchQuery): Promise<Record<string, unknown>[]> {
    const pageSize = 1000;
    const rows: Record<string, unknown>[] = [];
    for (let from = 0; ; from += pageSize) {
        const { data, error } = await build().range(from, from + pageSize - 1);
        if (error) throw new Error('Unable to read Search Console history');
        const batch = (data ?? []) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < pageSize) return rows;
    }
}

function storedDay(row: Record<string, unknown>): StoredDay {
    if (typeof row.id !== 'string' || typeof row.data_date !== 'string') throw new Error('Unable to read Search Console history');
    return {
        id: row.id,
        date: row.data_date,
        isIncomplete: row.is_incomplete === true,
        importedAt: typeof row.imported_at === 'string' ? row.imported_at : null,
        pageLimited: row.page_limited === true,
        queryLimited: row.query_limited === true,
    };
}

function storedFact(row: Record<string, unknown>): StoredFact {
    const grain = row.grain;
    const surface = row.surface;
    const clicks = integer(row.clicks);
    const impressions = integer(row.impressions);
    const position = positionOf(row.position);
    if (typeof row.day_id !== 'string' || typeof grain !== 'string' || !GRAINS.has(grain as GscGrain)) throw new Error('Unable to read Search Console history');
    if (surface !== 'organic' && surface !== 'gbp_link') throw new Error('Unable to read Search Console history');
    if (clicks == null || impressions == null || position == null) throw new Error('Unable to read Search Console history');
    const device = typeof row.device === 'string' ? row.device : null;
    return {
        dayId: row.day_id,
        grain: grain as GscGrain,
        page: typeof row.page === 'string' ? row.page : '',
        query: typeof row.query === 'string' ? row.query : '',
        clicks,
        impressions,
        position,
        device,
        country: typeof row.country === 'string' ? row.country : null,
        surface: surface as GscSurface,
    };
}

export async function loadSearchReporting(
    input: LoadInput,
    admin: SearchReportingAdmin = createAdminClient() as unknown as SearchReportingAdmin,
): Promise<LoadedSearch> {
    const preset = parseRange(input.range);
    if (!preset) throw new Error('Invalid range');
    const clientResult = await admin.from('clients')
        .select('name, custom_fields')
        .eq('id', input.clientId)
        .eq('organization_id', input.organizationId)
        .maybeSingle();
    if (clientResult.error || !clientResult.data || typeof clientResult.data !== 'object') throw new Error('Unable to read Search Console history');
    const client = clientResult.data as { name?: unknown; custom_fields?: unknown };
    const clientName = typeof client.name === 'string' ? client.name : '';
    const storedTokens = cityTokensFromCustomFields(client.custom_fields);

    const integrationResult = await admin.from('client_integrations')
        .select('sync_status, last_synced_at, site_url:credentials->>site_url')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('service', 'gsc')
        .maybeSingle();
    if (integrationResult.error) throw new Error('Unable to read Search Console history');
    const integration = integrationResult.data && typeof integrationResult.data === 'object'
        ? integrationResult.data as { site_url?: unknown; sync_status?: unknown; last_synced_at?: unknown }
        : null;
    const property = typeof integration?.site_url === 'string' && integration.site_url.trim() ? integration.site_url : null;
    const lastSyncAt = typeof integration?.last_synced_at === 'string' ? integration.last_synced_at : null;
    const lastSyncErrored = integration?.sync_status === 'error';
    const cityTokens = [...new Set([...storedTokens, ...input.cityTokens].map(token => token.trim()).filter(token => token.length >= 3))];
    if (!property) {
        return {
            connected: false,
            property: null,
            clientName,
            cityTokens,
            days: [],
            facts: [],
            ahrefsRows: [],
            ahrefsSyncedAt: null,
            lastSyncAt,
            lastSyncErrored,
        };
    }

    const span = historySpan(preset, ptToday(input.now));
    const dayRows = await readPages(() => admin.from('gsc_history_days')
        .select('id, data_date, imported_at, is_incomplete, page_limited, query_limited')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('property', property)
        .eq('search_type', 'web')
        .gte('data_date', span.start)
        .lte('data_date', span.end)
        .order('data_date', { ascending: true }));
    const days = dayRows.map(storedDay);
    const resolved = resolveRange(preset, days, input.now);
    const wanted = new Set<string>([...days.filter(day =>
        (day.date >= resolved.earlier.start && day.date <= resolved.earlier.end)
        || (day.date >= resolved.prior.start && day.date <= resolved.prior.end)
        || (day.date >= resolved.current.start && day.date <= resolved.current.end),
    ).map(day => day.id)]);
    const facts = wanted.size === 0 ? [] : (await readPages(() => admin.from('gsc_history_facts')
        .select('day_id, grain, page, query, clicks, impressions, position, device, country, surface')
        .in('day_id', [...wanted])
        .in('grain', FACT_GRAINS)
        .order('id', { ascending: true }))).map(storedFact);

    const metricMonth = preset.kind === 'month' && preset.month ? preset.month : resolved.current.end.slice(0, 7);
    const metricResult = await admin.from('metrics')
        .select('data, updated_at')
        .eq('organization_id', input.organizationId)
        .eq('client_id', input.clientId)
        .eq('source', 'ahrefs')
        .eq('metric_month', metricMonth)
        .maybeSingle();
    if (metricResult.error) throw new Error('Unable to read Search Console history');
    const metric = metricResult.data && typeof metricResult.data === 'object'
        ? metricResult.data as { data?: unknown; updated_at?: unknown }
        : null;

    return {
        connected: true,
        property,
        clientName,
        cityTokens,
        days,
        facts,
        ahrefsRows: ahrefsReferenceRows(metric?.data),
        ahrefsSyncedAt: typeof metric?.updated_at === 'string' ? metric.updated_at : null,
        lastSyncAt,
        lastSyncErrored,
    };
}

export function isDevice(value: string | null): value is GscDevice {
    return value === 'DESKTOP' || value === 'MOBILE' || value === 'TABLET';
}
