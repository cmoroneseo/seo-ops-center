import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { requireClientOrgMember, requireOrganizationMember } from '@/lib/security/tenant-authz';
import { generateAutoSummary } from '@/lib/reports/autoSummary';
import { createReportHandlers } from '@/lib/reports/report-routes';
import { deleteReport, getReport, updateReport } from '@/lib/reports/reportStore';
import { reportHasFrozenVersion } from '@/lib/reports/version-store';
import { getClientMetrics } from '@/lib/sync/upsertMetric';
import { createAdminClient } from '@/lib/supabase/admin';
import type { SearchReportingAdmin } from '@/lib/search-reporting/load';
import { keywordTrackingEnabled } from '@/lib/keyword-tracking/flag';
import {
    captureTrackedKeywordSnapshot,
    readStoredTrackingSnapshot,
    reportHasTrackedKeywordsBlock,
} from '@/lib/keyword-tracking/report-snapshot';

async function sessionDb() {
    const cookieStore = await cookies();
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) { cookieStore.set({ name, value, ...options }); },
                remove(name: string, options: CookieOptions) { cookieStore.set({ name, value: '', ...options }); },
            },
        },
    );
}

const handlers = createReportHandlers({
    requireOrganizationMember,
    requireClientOrgMember,
    listReports: async () => [],
    createReport: async () => ({ error: 'Use the collection route' }),
    getReport,
    updateReport,
    deleteReport,
    hasFrozenVersion: reportHasFrozenVersion,
    getClientMetrics,
    generateAutoSummary,
    captureTrackingSnapshot: async (report) => {
        const supabase = await sessionDb();
        return captureTrackedKeywordSnapshot({
            report,
            client: supabase as unknown as SearchReportingAdmin,
            write: async (row) => {
                const saved = await supabase.from('report_tracking_snapshots').upsert({
                    organization_id: row.organizationId,
                    client_id: row.clientId,
                    report_id: row.reportId,
                    payload: row.payload,
                    captured_at: row.capturedAt,
                }, { onConflict: 'report_id' });
                return { ok: !saved.error };
            },
        });
    },
    readTrackingSnapshot: async (report) => {
        if (!keywordTrackingEnabled() || !report.client_id || !reportHasTrackedKeywordsBlock(report.sections)) return null;
        return readStoredTrackingSnapshot({
            reportId: report.id,
            organizationId: report.organization_id,
            clientId: report.client_id,
            client: createAdminClient() as unknown as SearchReportingAdmin,
        });
    },
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
