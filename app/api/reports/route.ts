import { NextRequest, NextResponse } from 'next/server';
import { listReports, createReport, updateReport } from '@/lib/reports/reportStore';
import { getClientMetrics } from '@/lib/sync/upsertMetric';
import { generateAutoSummary } from '@/lib/reports/autoSummary';
import { monthLabel, previousMonth, ReportSourceKey } from '@/lib/reports/sections';

/**
 * GET /api/reports?orgId=...&clientId=...&month=...
 * List reports for an org (optionally filtered).
 */
export async function GET(req: NextRequest) {
    const orgId = req.nextUrl.searchParams.get('orgId');
    const clientId = req.nextUrl.searchParams.get('clientId') ?? undefined;
    const month = req.nextUrl.searchParams.get('month') ?? undefined;
    if (!orgId) return NextResponse.json({ error: 'Missing orgId' }, { status: 400 });

    const reports = await listReports(orgId, { clientId, month });
    return NextResponse.json({ reports });
}

/**
 * POST /api/reports
 * Create a report for a client+month and auto-fill the executive summary
 * + recommendations from synced/manual metrics.
 * Body: { orgId, clientId, clientName, month, createdBy? }
 */
export async function POST(req: NextRequest) {
    const { orgId, clientId, clientName, month, createdBy } = await req.json();
    if (!orgId || !clientId || !month) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const name = clientName || 'Client';
    const title = `${name} — ${monthLabel(month)} SEO Report`;

    const { report, error } = await createReport({
        organizationId: orgId,
        clientId,
        reportMonth: month,
        title,
        createdBy,
    });
    if (error || !report) {
        return NextResponse.json({ error: error ?? 'Create failed' }, { status: 500 });
    }

    // Auto-fill summary from metrics (current + previous month).
    const [curRows, prevRows] = await Promise.all([
        getClientMetrics(clientId, { month }),
        getClientMetrics(clientId, { month: previousMonth(month) }),
    ]);
    const toMap = (rows: { source: string; data: Record<string, any> }[]) =>
        Object.fromEntries(rows.map(r => [r.source, r.data])) as Partial<Record<ReportSourceKey, Record<string, any>>>;

    const { executiveSummary, recommendations } = generateAutoSummary(
        name, monthLabel(month), toMap(curRows), toMap(prevRows),
    );
    const { report: updated } = await updateReport(report.id, {
        executive_summary: executiveSummary,
        recommendations,
    });

    return NextResponse.json({ report: updated ?? report });
}
