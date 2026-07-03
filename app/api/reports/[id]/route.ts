import { NextRequest, NextResponse } from 'next/server';
import { getReport, updateReport, deleteReport } from '@/lib/reports/reportStore';
import { getClientMetrics } from '@/lib/sync/upsertMetric';
import { previousMonth, ReportSourceKey } from '@/lib/reports/sections';

/**
 * GET /api/reports/[id]
 * Returns the report, current + previous month metrics, and up to 12 months
 * of per-source history (ascending) ending at the report month — used by
 * trend charts and the organic history table.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const report = await getReport(id);
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Unassigned report — no client to pull metrics for yet.
    if (!report.client_id) {
        return NextResponse.json({ report, metrics: { current: {}, previous: {} }, history: {} });
    }

    const allRows = await getClientMetrics(report.client_id); // all months, desc
    const toMap = (rows: { source: string; data: Record<string, any> }[]) =>
        Object.fromEntries(rows.map(r => [r.source, r.data])) as Partial<Record<ReportSourceKey, Record<string, any>>>;

    const prevMonth = previousMonth(report.report_month);
    const curRows = allRows.filter(r => r.metric_month === report.report_month);
    const prevRows = allRows.filter(r => r.metric_month === prevMonth);

    // Per-source history: months <= report month, ascending, last 12
    const history: Record<string, { month: string; data: Record<string, any> }[]> = {};
    for (const row of allRows) {
        if (!row.metric_month || row.metric_month > report.report_month) continue;
        (history[row.source] ??= []).push({ month: row.metric_month, data: row.data });
    }
    for (const source of Object.keys(history)) {
        history[source] = history[source]
            .sort((a, b) => a.month.localeCompare(b.month))
            .slice(-12);
    }

    return NextResponse.json({
        report,
        metrics: { current: toMap(curRows), previous: toMap(prevRows) },
        history,
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
