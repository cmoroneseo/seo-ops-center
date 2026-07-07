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
 * Create a report shell for a month, optionally pre-assigned to a client.
 * When a client is given, auto-fills the executive summary + recommendations
 * from synced/manual metrics. Without one, the report starts blank — the
 * canvas stays empty until a client is picked in the builder's Settings tab.
 * Body: { orgId, month, clientId?, clientName?, createdBy?, blocks? }
 * `blocks` (from a stock or custom template) sets the v2 block layout;
 * omitted → the default Monthly SEO Report layout.
 */
export async function POST(req: NextRequest) {
    const { orgId, clientId, clientName, month, createdBy, blocks } = await req.json();
    if (!orgId || !month) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const title = clientId
        ? `${clientName || 'Client'} — ${monthLabel(month)} SEO Report`
        : `New Report — ${monthLabel(month)}`;

    const { report, error } = await createReport({
        organizationId: orgId,
        clientId: clientId ?? null,
        reportMonth: month,
        title,
        createdBy,
        blocks: Array.isArray(blocks) ? blocks : undefined,
    });
    if (error || !report) {
        return NextResponse.json({ error: error ?? 'Create failed' }, { status: 500 });
    }

    if (!clientId) return NextResponse.json({ report });

    // Auto-fill summary from metrics (current + previous month) — client known upfront.
    const [curRows, prevRows] = await Promise.all([
        getClientMetrics(clientId, { month }),
        getClientMetrics(clientId, { month: previousMonth(month) }),
    ]);
    const toMap = (rows: { source: string; data: Record<string, any> }[]) =>
        Object.fromEntries(rows.map(r => [r.source, r.data])) as Partial<Record<ReportSourceKey, Record<string, any>>>;

    const { executiveSummary, recommendations } = generateAutoSummary(
        clientName || 'Client', monthLabel(month), toMap(curRows), toMap(prevRows),
    );
    const { report: updated } = await updateReport(report.id, {
        executive_summary: executiveSummary,
        recommendations,
    });

    return NextResponse.json({ report: updated ?? report });
}
