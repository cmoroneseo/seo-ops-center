import { NextRequest, NextResponse } from 'next/server';
import { getReport, updateReport, deleteReport } from '@/lib/reports/reportStore';
import { getClientMetrics } from '@/lib/sync/upsertMetric';
import { previousMonth, ReportSourceKey } from '@/lib/reports/sections';

/**
 * GET /api/reports/[id]
 * Returns the report plus current + previous month metrics for rendering.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const report = await getReport(id);
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [curRows, prevRows] = await Promise.all([
        getClientMetrics(report.client_id, { month: report.report_month }),
        getClientMetrics(report.client_id, { month: previousMonth(report.report_month) }),
    ]);
    const toMap = (rows: { source: string; data: Record<string, any> }[]) =>
        Object.fromEntries(rows.map(r => [r.source, r.data])) as Partial<Record<ReportSourceKey, Record<string, any>>>;

    return NextResponse.json({
        report,
        metrics: { current: toMap(curRows), previous: toMap(prevRows) },
    });
}

/**
 * PATCH /api/reports/[id]
 * Save edits. Body: { title?, executive_summary?, recommendations?, sections?, status?, pdf_url? }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const patch = await req.json();
    const { report, error } = await updateReport(id, patch);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ report });
}

/** DELETE /api/reports/[id] */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const { error } = await deleteReport(id);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ success: true });
}
