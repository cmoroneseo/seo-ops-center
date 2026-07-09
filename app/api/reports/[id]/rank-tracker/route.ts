import { NextRequest, NextResponse } from 'next/server';
import { getReport } from '@/lib/reports/reportStore';
import { previousMonth } from '@/lib/reports/sections';
import {
    fetchAhrefsRankTracker, RankTrackerOptions, RankTrackerSortField,
} from '@/lib/sync/fetchAhrefsRankTracker';

export type RankTrackerPeriod = 'report_month' | 'last_month' | 'last_7d' | 'last_30d' | 'last_90d';

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function lastDayOfMonth(month: string): number {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
}

function shiftDate(dateStr: string, deltaDays: number): string {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + deltaDays);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Resolve a widget's chosen period into a concrete date range. Rolling
 * windows (7/30/90 days) anchor to the report month's last day, not
 * "today" — reports are often built for a month that's already ended.
 */
function computeDateRange(reportMonth: string, period: RankTrackerPeriod): { dateStart: string; dateEnd: string } {
    const monthStart = `${reportMonth}-01`;
    const monthEnd = `${reportMonth}-${pad(lastDayOfMonth(reportMonth))}`;

    switch (period) {
        case 'last_7d': return { dateStart: shiftDate(monthEnd, -7), dateEnd: monthEnd };
        case 'last_30d': return { dateStart: shiftDate(monthEnd, -30), dateEnd: monthEnd };
        case 'last_90d': return { dateStart: shiftDate(monthEnd, -90), dateEnd: monthEnd };
        case 'last_month': {
            const prev = previousMonth(reportMonth);
            return { dateStart: `${prev}-01`, dateEnd: `${prev}-${pad(lastDayOfMonth(prev))}` };
        }
        default: return { dateStart: monthStart, dateEnd: monthEnd };
    }
}

const VALID_PERIODS: RankTrackerPeriod[] = ['report_month', 'last_month', 'last_7d', 'last_30d', 'last_90d'];
const VALID_SORT_FIELDS: RankTrackerSortField[] = ['traffic', 'volume', 'position', 'keyword_difficulty'];

/**
 * GET /api/reports/[id]/rank-tracker?period=&device=&limit=&sortBy=&sortDir=&columns=
 * Live-fetches tracked keyword positions from the client's connected Ahrefs
 * Rank Tracker project. Not cached/stored — Ahrefs already retains the
 * history, so we just ask for the range on demand instead of duplicating it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const report = await getReport(id);
    if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!report.client_id) return NextResponse.json({ status: 'not_configured' });

    const sp = req.nextUrl.searchParams;
    const periodParam = sp.get('period') as RankTrackerPeriod | null;
    const period = periodParam && VALID_PERIODS.includes(periodParam) ? periodParam : 'report_month';
    const { dateStart, dateEnd } = computeDateRange(report.report_month, period);

    const device = sp.get('device') === 'mobile' ? 'mobile' : 'desktop';
    const limit = Math.min(Math.max(Number(sp.get('limit')) || 100, 1), 100);
    const sortByParam = sp.get('sortBy') as RankTrackerSortField | null;
    const sortBy = sortByParam && VALID_SORT_FIELDS.includes(sortByParam) ? sortByParam : 'traffic';
    const sortDir = sp.get('sortDir') === 'asc' ? 'asc' : 'desc';
    const columns = (sp.get('columns')?.split(',').filter(Boolean) ?? []) as RankTrackerOptions['columns'];

    const result = await fetchAhrefsRankTracker(report.client_id, dateStart, dateEnd, {
        device, limit, sortBy, sortDir, columns,
    });
    // Include the resolved date range so the widget can render accurate
    // column headers regardless of which period was chosen (rolling windows
    // and "last month" don't map to the report's own month).
    return NextResponse.json(result.status === 'ok' ? { ...result, dateStart, dateEnd } : result);
}
