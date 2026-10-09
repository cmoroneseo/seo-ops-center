import { NextRequest } from 'next/server';
import { requireClientOrgMember, requireOrganizationMember } from '@/lib/security/tenant-authz';
import { generateAutoSummary } from '@/lib/reports/autoSummary';
import { createReportHandlers } from '@/lib/reports/report-routes';
import { createReport, getReport, listReports, updateReport } from '@/lib/reports/reportStore';
import { getClientMetrics } from '@/lib/sync/upsertMetric';

const handlers = createReportHandlers({
    requireOrganizationMember,
    requireClientOrgMember,
    listReports,
    createReport,
    getReport,
    updateReport,
    deleteReport: async () => ({ error: 'Use the report id route' }),
    getClientMetrics,
    generateAutoSummary,
});

export async function GET(req: NextRequest) {
    return handlers.list(req);
}

export async function POST(req: NextRequest) {
    return handlers.create(req);
}
