import type { ReportAccess } from './access';
import { previousMonth } from './sections';
import type { RankTrackerOptions, RankTrackerResult, RankTrackerSortField } from '@/lib/sync/fetchAhrefsRankTracker';

export type RankTrackerPeriod = 'report_month' | 'last_month' | 'last_7d' | 'last_30d' | 'last_90d';

const VALID_PERIODS: RankTrackerPeriod[] = ['report_month', 'last_month', 'last_7d', 'last_30d', 'last_90d'];
const VALID_SORT_FIELDS: RankTrackerSortField[] = ['traffic', 'volume', 'position', 'keyword_difficulty'];

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function lastDayOfMonth(month: string): number {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Date(year, monthNumber, 0).getDate();
}

function shiftDate(dateStr: string, deltaDays: number): string {
    const date = new Date(dateStr + 'T00:00:00');
    date.setDate(date.getDate() + deltaDays);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Rolling windows anchor to the report month, clamped so Ahrefs never sees a future date. */
export function computeDateRange(reportMonth: string, period: RankTrackerPeriod, now: Date): { dateStart: string; dateEnd: string } {
    const today = now.toISOString().slice(0, 10);
    const monthStart = `${reportMonth}-01`;
    const trueMonthEnd = `${reportMonth}-${pad(lastDayOfMonth(reportMonth))}`;
    const monthEnd = trueMonthEnd > today ? today : trueMonthEnd;

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

export interface RankTrackerDeps {
    access: (id: unknown, mode: 'read' | 'write') => Promise<ReportAccess>;
    fetchAhrefsRankTracker: (
        clientId: string,
        dateStart: string,
        dateEnd: string,
        options: RankTrackerOptions,
    ) => Promise<RankTrackerResult>;
    now: () => Date;
}

function json(body: unknown, status = 200) {
    return Response.json(body, { status });
}

export function createRankTrackerHandler(deps: RankTrackerDeps) {
    return {
        async GET(id: string, request: Request) {
            const access = await deps.access(id, 'read');
            if (!access.ok) return json({ status: 'error', message: access.error }, access.status);
            if (!access.report.client_id) return json({ status: 'not_configured' });

            const params = new URL(request.url).searchParams;
            const periodParam = params.get('period') as RankTrackerPeriod | null;
            const period = periodParam && VALID_PERIODS.includes(periodParam) ? periodParam : 'report_month';
            const { dateStart, dateEnd } = computeDateRange(access.report.report_month, period, deps.now());
            const device = params.get('device') === 'mobile' ? 'mobile' : 'desktop';
            const limit = Math.min(Math.max(Number(params.get('limit')) || 100, 1), 100);
            const sortByParam = params.get('sortBy') as RankTrackerSortField | null;
            const sortBy = sortByParam && VALID_SORT_FIELDS.includes(sortByParam) ? sortByParam : 'traffic';
            const sortDir = params.get('sortDir') === 'asc' ? 'asc' : 'desc';
            const columns = (params.get('columns')?.split(',').filter(Boolean) ?? []) as RankTrackerOptions['columns'];

            const result = await deps.fetchAhrefsRankTracker(access.report.client_id, dateStart, dateEnd, {
                device, limit, sortBy, sortDir, columns,
            });
            return json(result.status === 'ok' ? { ...result, dateStart, dateEnd } : result);
        },
    };
}
