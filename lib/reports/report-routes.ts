import { isUuid, requireOrgAccess, requireReportAccess, type OrgMemberResult, type ReportAccessDeps } from './access';
import { generateAutoSummary } from './autoSummary';
import type { ReportRow } from './reportStore';
import { monthLabel, previousMonth, type ReportSourceKey } from './sections';
import type { MetricRow } from '@/lib/sync/upsertMetric';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

type ClientAuth =
    | { ok: true; userId: string; organizationId: string; clientId: string; role: OrgMemberResult extends { ok: true } ? OrgMemberResult['role'] : string }
    | { ok: false; status: number; error: string };

export interface ReportRouteDeps extends ReportAccessDeps {
    requireClientOrgMember: (clientId: unknown, organizationId?: unknown) => Promise<ClientAuth>;
    listReports: (organizationId: string, opts: { clientId?: string; month?: string }) => Promise<ReportRow[]>;
    createReport: (params: {
        organizationId: string;
        clientId?: string | null;
        reportMonth: string;
        title: string;
        createdBy?: string | null;
        blocks?: { type: string; props?: Record<string, unknown> }[];
    }) => Promise<{ report?: ReportRow; error?: string }>;
    updateReport: (
        id: string,
        organizationId: string,
        patch: Partial<Pick<ReportRow, 'title' | 'executive_summary' | 'recommendations' | 'sections' | 'status' | 'client_id' | 'report_month'>>,
    ) => Promise<{ report?: ReportRow; error?: string }>;
    deleteReport: (id: string, organizationId: string) => Promise<{ error?: string }>;
    getClientMetrics: (clientId: string, opts: { organizationId: string; month?: string }) => Promise<MetricRow[]>;
    generateAutoSummary: typeof generateAutoSummary;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

function toMap(rows: { source: string; data: Record<string, unknown> }[]) {
    return Object.fromEntries(rows.map(row => [row.source, row.data])) as Partial<Record<ReportSourceKey, Record<string, unknown>>>;
}

function parseBlocks(value: unknown): { type: string; props?: Record<string, unknown> }[] | undefined | 'invalid' {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 100) return 'invalid';
    const blocks: { type: string; props?: Record<string, unknown> }[] = [];
    for (const item of value) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return 'invalid';
        const type = (item as { type?: unknown }).type;
        const props = (item as { props?: unknown }).props;
        if (typeof type !== 'string' || type.length === 0 || type.length > 80) return 'invalid';
        if (props !== undefined && (props === null || typeof props !== 'object' || Array.isArray(props))) return 'invalid';
        blocks.push({ type, props: props as Record<string, unknown> | undefined });
    }
    return blocks;
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
    try {
        const body = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid request' }, 400);
        return body as Record<string, unknown>;
    } catch {
        return json({ error: 'Invalid JSON' }, 400);
    }
}

export function createReportHandlers(deps: ReportRouteDeps) {
    return {
        async list(request: Request) {
            const url = new URL(request.url);
            const access = await requireOrgAccess(url.searchParams.get('orgId'), 'read', deps);
            if (!access.ok) return json({ error: access.error }, access.status);

            const clientId = url.searchParams.get('clientId');
            if (clientId) {
                if (!isUuid(clientId)) return json({ error: 'Forbidden' }, 403);
                const client = await deps.requireClientOrgMember(clientId, access.auth.organizationId);
                if (!client.ok) return json({ error: 'Forbidden' }, client.status === 401 ? 401 : 403);
            }

            const month = url.searchParams.get('month');
            if (month && !MONTH.test(month)) return json({ error: 'Invalid month' }, 400);

            const reports = await deps.listReports(access.auth.organizationId, {
                clientId: clientId ?? undefined,
                month: month ?? undefined,
            });
            return json({ reports });
        },

        async create(request: Request) {
            const body = await readJson(request);
            if (body instanceof Response) return body;

            const access = await requireOrgAccess(body.orgId, 'write', deps);
            if (!access.ok) return json({ error: access.error }, access.status);

            const month = body.month;
            if (typeof month !== 'string' || !MONTH.test(month)) return json({ error: 'Invalid month' }, 400);

            let clientId: string | null = null;
            if (body.clientId != null && body.clientId !== '') {
                if (!isUuid(body.clientId)) return json({ error: 'Forbidden' }, 403);
                const client = await deps.requireClientOrgMember(body.clientId, access.auth.organizationId);
                if (!client.ok) return json({ error: 'Forbidden' }, client.status === 401 ? 401 : 403);
                clientId = client.clientId;
            }

            const blocks = parseBlocks(body.blocks);
            if (blocks === 'invalid') return json({ error: 'Invalid blocks' }, 400);

            const clientName = typeof body.clientName === 'string' ? body.clientName : '';
            const title = clientId
                ? `${clientName || 'Client'} — ${monthLabel(month)} SEO Report`
                : `New Report — ${monthLabel(month)}`;

            const created = await deps.createReport({
                organizationId: access.auth.organizationId,
                clientId,
                reportMonth: month,
                title,
                createdBy: access.auth.userId,
                blocks,
            });
            if (created.error || !created.report) return json({ error: 'Unable to create report' }, 500);
            if (!clientId) return json({ report: created.report });

            const [currentRows, previousRows] = await Promise.all([
                deps.getClientMetrics(clientId, { organizationId: access.auth.organizationId, month }),
                deps.getClientMetrics(clientId, { organizationId: access.auth.organizationId, month: previousMonth(month) }),
            ]);
            const summary = deps.generateAutoSummary(
                clientName || 'Client',
                monthLabel(month),
                toMap(currentRows),
                toMap(previousRows),
            );
            const updated = await deps.updateReport(created.report.id, access.auth.organizationId, {
                executive_summary: summary.executiveSummary,
                recommendations: summary.recommendations,
            });
            return json({ report: updated.report ?? created.report });
        },

        async get(id: string) {
            const access = await requireReportAccess(id, 'read', deps);
            if (!access.ok) return json({ error: access.error }, access.status);
            const report = access.report;
            if (!report.client_id) {
                return json({ report, metrics: { current: {}, previous: {}, sourceTypes: {}, updatedAt: {} }, history: {} });
            }

            const allRows = await deps.getClientMetrics(report.client_id, { organizationId: report.organization_id });
            const prevMonth = previousMonth(report.report_month);
            const currentRows = allRows.filter(row => row.metric_month === report.report_month);
            const previousRows = allRows.filter(row => row.metric_month === prevMonth);
            const history: Record<string, { month: string; data: Record<string, unknown> }[]> = {};
            for (const row of allRows) {
                if (!row.metric_month || row.metric_month > report.report_month) continue;
                (history[row.source] ??= []).push({ month: row.metric_month, data: row.data });
            }
            for (const source of Object.keys(history)) {
                history[source] = history[source].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
            }
            return json({
                report,
                metrics: {
                    current: toMap(currentRows),
                    previous: toMap(previousRows),
                    sourceTypes: Object.fromEntries(currentRows.map(row => [row.source, row.source_type])),
                    updatedAt: Object.fromEntries(currentRows.map(row => [row.source, row.updated_at])),
                },
                history,
            });
        },

        async patch(id: string, request: Request) {
            const access = await requireReportAccess(id, 'write', deps);
            if (!access.ok) return json({ error: access.error }, access.status);
            const body = await readJson(request);
            if (body instanceof Response) return body;

            const patch: Parameters<ReportRouteDeps['updateReport']>[2] = {};
            if ('title' in body) {
                if (typeof body.title !== 'string' || body.title.trim().length === 0 || body.title.length > 200) {
                    return json({ error: 'Invalid title' }, 400);
                }
                patch.title = body.title;
            }
            for (const field of ['executive_summary', 'recommendations'] as const) {
                if (!(field in body)) continue;
                const value = body[field];
                if (value !== null && (typeof value !== 'string' || value.length > 20_000)) {
                    return json({ error: 'Invalid text' }, 400);
                }
                patch[field] = value as string | null;
            }
            if ('sections' in body) {
                const sections = body.sections;
                if (Array.isArray(sections)) {
                    if (sections.length > 100) return json({ error: 'Invalid sections' }, 400);
                    patch.sections = sections as ReportRow['sections'];
                } else if (sections && typeof sections === 'object' && !Array.isArray(sections)) {
                    const doc = sections as { version?: unknown; blocks?: unknown };
                    if (doc.version !== 2 || !Array.isArray(doc.blocks) || doc.blocks.length > 100) {
                        return json({ error: 'Invalid sections' }, 400);
                    }
                    if (doc.blocks.some(block => !block || typeof block !== 'object' || Array.isArray(block))) {
                        return json({ error: 'Invalid sections' }, 400);
                    }
                    patch.sections = sections as ReportRow['sections'];
                } else {
                    return json({ error: 'Invalid sections' }, 400);
                }
            }
            if ('status' in body) {
                if (body.status !== 'draft' && body.status !== 'published') return json({ error: 'Invalid status' }, 400);
                patch.status = body.status;
            }
            if ('report_month' in body) {
                if (typeof body.report_month !== 'string' || !MONTH.test(body.report_month)) {
                    return json({ error: 'Invalid month' }, 400);
                }
                patch.report_month = body.report_month;
            }
            if ('client_id' in body) {
                if (body.client_id === null) {
                    patch.client_id = null;
                } else if (!isUuid(body.client_id)) {
                    return json({ error: 'Invalid client' }, 400);
                } else {
                    const client = await deps.requireClientOrgMember(body.client_id, access.report.organization_id);
                    if (!client.ok) return json({ error: 'Forbidden' }, client.status === 401 ? 401 : 403);
                    patch.client_id = client.clientId;
                }
            }

            if (Object.keys(patch).length === 0) return json({ error: 'No changes' }, 400);
            const updated = await deps.updateReport(access.report.id, access.report.organization_id, patch);
            if (updated.error || !updated.report) return json({ error: 'Unable to save report' }, 500);
            return json({ report: updated.report });
        },

        async remove(id: string) {
            const access = await requireReportAccess(id, 'write', deps);
            if (!access.ok) return json({ error: access.error }, access.status);
            const result = await deps.deleteReport(access.report.id, access.report.organization_id);
            if (result.error) return json({ error: 'Unable to delete report' }, 500);
            return json({ success: true });
        },
    };
}
