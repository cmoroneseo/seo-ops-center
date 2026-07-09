import { NextRequest, NextResponse } from 'next/server';
import { getReport } from '@/lib/reports/reportStore';
import { fetchAhrefsRankTracker } from '@/lib/sync/fetchAhrefsRankTracker';

/**
 * GET /api/reports/[id]/rank-tracker
 * Live-fetches tracked keyword positions (start vs end of the report's
 * month) from the client's connected Ahrefs Rank Tracker project. Not
 * cached/stored — Ahrefs already retains the history, so we just ask for
 * the range on demand instead of duplicating it in our own DB.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const report = await getReport(id);
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!report.client_id) return NextResponse.json({ status: 'not_configured' });

    const [y, m] = report.report_month.split('-').map(Number);
    const dateStart = `${report.report_month}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const dateEnd = `${report.report_month}-${String(lastDay).padStart(2, '0')}`;

    const result = await fetchAhrefsRankTracker(report.client_id, dateStart, dateEnd);
    return NextResponse.json(result);
}
