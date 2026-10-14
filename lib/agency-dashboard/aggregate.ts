import type { AggregateClient } from './portfolio';
import type { SeriesPoint, Totals } from './metrics';

export interface AgencyFreshness {
    latestDataDate: string | null;
    latestImportedAt: string | null;
    settling: boolean;
}

export interface AgencyAggregate {
    clients: AggregateClient[];
    freshness: AgencyFreshness;
}

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function num(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return null;
}

function text(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function totals(value: unknown): Totals | null {
    const row = record(value);
    if (!row) return null;
    const clicks = num(row.clicks);
    const impressions = num(row.impressions);
    const days = num(row.days);
    if (clicks == null || impressions == null || days == null || clicks < 0 || impressions < 0 || days <= 0) return null;
    const weight = row.positionWeight == null ? null : num(row.positionWeight);
    if (row.positionWeight != null && weight == null) return null;
    return { clicks, impressions, positionWeight: impressions > 0 ? weight : null, days };
}

/** Reject a payload that is missing pieces instead of turning them into zeros. */
export function parseAgencyAggregate(value: unknown): AgencyAggregate {
    const body = record(value);
    if (!body || !Array.isArray(body.current) || !Array.isArray(body.previous) || !Array.isArray(body.series) || !Array.isArray(body.queries)) {
        throw new Error('Invalid dashboard aggregate');
    }
    const current = new Map<string, Totals>();
    const previous = new Map<string, Totals>();
    const series = new Map<string, SeriesPoint[]>();
    const queries = new Map<string, Array<{ query: string; clicks: number }>>();
    const incomplete = new Set<string>();

    for (const item of body.current) {
        const row = record(item);
        const clientId = text(row?.clientId);
        const parsed = totals(row);
        if (!clientId || !parsed) throw new Error('Invalid dashboard aggregate');
        current.set(clientId, parsed);
        if (row?.incomplete === true) incomplete.add(clientId);
    }
    for (const item of body.previous) {
        const row = record(item);
        const clientId = text(row?.clientId);
        const parsed = totals(row);
        if (!clientId || !parsed) throw new Error('Invalid dashboard aggregate');
        previous.set(clientId, parsed);
    }
    for (const item of body.series) {
        const row = record(item);
        const clientId = text(row?.clientId);
        const bucket = text(row?.bucket)?.slice(0, 10) ?? null;
        const clicks = num(row?.clicks);
        const impressions = num(row?.impressions);
        if (!clientId || !bucket || clicks == null || impressions == null || clicks < 0 || impressions < 0) throw new Error('Invalid dashboard aggregate');
        const weight = row?.positionWeight == null ? null : num(row.positionWeight);
        if (row?.positionWeight != null && weight == null) throw new Error('Invalid dashboard aggregate');
        const list = series.get(clientId) ?? [];
        list.push({ bucket, clicks, impressions, positionWeight: impressions > 0 ? weight : null });
        series.set(clientId, list);
    }
    for (const item of body.queries) {
        const row = record(item);
        const clientId = text(row?.clientId);
        const query = text(row?.query);
        const clicks = num(row?.clicks);
        if (!clientId || !query || clicks == null || clicks <= 0) throw new Error('Invalid dashboard aggregate');
        const list = queries.get(clientId) ?? [];
        list.push({ query, clicks });
        queries.set(clientId, list);
    }

    const ids = new Set([...current.keys(), ...previous.keys(), ...series.keys(), ...queries.keys()]);
    const freshness = record(body.freshness);
    return {
        clients: [...ids].map(clientId => ({
            clientId,
            current: current.get(clientId) ?? null,
            previous: previous.get(clientId) ?? null,
            series: series.get(clientId) ?? [],
            queries: (queries.get(clientId) ?? []).slice(0, 3),
            incomplete: incomplete.has(clientId),
        })),
        freshness: {
            latestDataDate: text(freshness?.latestDataDate)?.slice(0, 10) ?? null,
            latestImportedAt: text(freshness?.latestImportedAt),
            settling: freshness?.settling === true,
        },
    };
}
