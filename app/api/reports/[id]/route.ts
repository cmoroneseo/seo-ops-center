import { NextRequest } from 'next/server';
import { requireClientOrgMember, requireOrganizationMember } from '@/lib/security/tenant-authz';
import { generateAutoSummary } from '@/lib/reports/autoSummary';
import { createReportHandlers } from '@/lib/reports/report-routes';
import { deleteReport, getReport, updateReport } from '@/lib/reports/reportStore';
import { getClientMetrics } from '@/lib/sync/upsertMetric';

const handlers = createReportHandlers({
    requireOrganizationMember,
    requireClientOrgMember,
    listReports: async () => [],
    createReport: async () => ({ error: 'Use the collection route' }),
    getReport,
    updateReport,
    deleteReport,
    getClientMetrics,
    generateAutoSummary,
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return handlers.get(id);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return handlers.patch(id, req);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return handlers.remove(id);
}
