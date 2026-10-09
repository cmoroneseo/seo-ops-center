import { isUuid } from '@/lib/reports/access';
import { METRIC_DEFS, type ReportSourceKey } from '@/lib/reports/sections';
import { ptMonth } from '@/lib/sync/months';
import type { MetricRow, WriteMetricParams, WriteOutcome } from '@/lib/sync/upsertMetric';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const SOURCES = ['ga4', 'gsc', 'gbp', 'ahrefs'] as const;

type ClientAuth =
    | { ok: true; userId: string; organizationId: string; clientId: string; role: 'owner' | 'admin' | 'member' | 'viewer' }
    | { ok: false; status: number; error: string };

export interface MetricsRouteDeps {
    requireClientOrgMember: (clientId: unknown, organizationId?: unknown) => Promise<ClientAuth>;
    getClientMetrics: (clientId: string, opts: { organizationId: string; month?: string }) => Promise<MetricRow[]>;
    writeMetric: (params: WriteMetricParams) => Promise<{ success: true; outcome: WriteOutcome } | { success: false; error: string }>;
    deleteManualMetric: (params: { clientId: string; organizationId: string; source: string; metricMonth: string }) => Promise<'deleted' | 'not_found'>;
    now: () => Date;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function cleanMetricData(source: ReportSourceKey, data: unknown): Record<string, number | null> | string {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Invalid data';
    const defs = METRIC_DEFS[source];
    const allowed = new Set(defs.map(def => def.key));
    const percent = new Set(defs.filter(def => def.format === 'percent').map(def => def.key));
    const clean: Record<string, number | null> = {};
    let nonNull = 0;
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (!allowed.has(key)) return 'Unknown metric';
        if (value === null) {
            clean[key] = null;
            continue;
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Invalid metric value';
        if (percent.has(key) && value > 1) return 'Invalid percent';
        clean[key] = value;
        nonNull += 1;
    }
    if (nonNull === 0) return 'Enter at least one value';
    return clean;
}

export function createMetricsHandlers(deps: MetricsRouteDeps) {
    return {
        async list(request: Request) {
            const params = new URL(request.url).searchParams;
            const clientId = params.get('clientId');
            if (!clientId) return json({ error: 'Missing clientId' }, 400);
            if (!isUuid(clientId)) return json({ error: 'Invalid clientId' }, 400);
            const auth = await deps.requireClientOrgMember(clientId);
            if (!auth.ok) return json({ error: auth.error }, auth.status);
            const month = params.get('month') ?? undefined;
            if (month && !MONTH.test(month)) return json({ error: 'Invalid month' }, 400);
            const metrics = await deps.getClientMetrics(auth.clientId, { organizationId: auth.organizationId, month });
            return json({ metrics });
        },

        async create(request: Request) {
            let body: Record<string, unknown>;
            try {
                const parsed = await request.json();
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Invalid request' }, 400);
                body = parsed as Record<string, unknown>;
            } catch {
                return json({ error: 'Invalid JSON' }, 400);
            }
            if (!isUuid(body.clientId)) return json({ error: 'Invalid clientId' }, 400);
            const auth = await deps.requireClientOrgMember(body.clientId);
            if (!auth.ok) return json({ error: auth.error }, auth.status);
            if (auth.role === 'viewer') return json({ error: 'Forbidden' }, 403);
            if (typeof body.source !== 'string' || !SOURCES.includes(body.source as typeof SOURCES[number])) {
                return json({ error: 'Invalid source' }, 400);
            }
            if (typeof body.metricMonth !== 'string' || !MONTH.test(body.metricMonth) || body.metricMonth > ptMonth(deps.now())) {
                return json({ error: 'Invalid month' }, 400);
            }
            const data = cleanMetricData(body.source as ReportSourceKey, body.data);
            if (typeof data === 'string') return json({ error: data }, 400);
            const written = await deps.writeMetric({
                organizationId: auth.organizationId,
                clientId: auth.clientId,
                source: body.source as ReportSourceKey,
                metricMonth: body.metricMonth,
                data,
                sourceType: 'manual',
                enteredBy: auth.userId,
            });
            if (!written.success) return json({ error: 'Unable to save metrics' }, 500);
            return json({ success: true, outcome: written.outcome });
        },

        async remove(request: Request) {
            const params = new URL(request.url).searchParams;
            const clientId = params.get('clientId');
            const source = params.get('source');
            const metricMonth = params.get('metricMonth');
            if (!isUuid(clientId)) return json({ error: 'Invalid clientId' }, 400);
            if (!source || !SOURCES.includes(source as typeof SOURCES[number])) return json({ error: 'Invalid source' }, 400);
            if (!metricMonth || !MONTH.test(metricMonth)) return json({ error: 'Invalid month' }, 400);
            const auth = await deps.requireClientOrgMember(clientId);
            if (!auth.ok) return json({ error: auth.error }, auth.status);
            if (auth.role === 'viewer') return json({ error: 'Forbidden' }, 403);
            const result = await deps.deleteManualMetric({
                clientId: auth.clientId,
                organizationId: auth.organizationId,
                source,
                metricMonth,
            });
            if (result === 'not_found') return json({ error: 'Not found' }, 404);
            return json({ success: true });
        },
    };
}
