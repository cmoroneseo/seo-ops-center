import { searchReportingEnabled } from '@/lib/search-reporting/flag';
import { previousMonth, ptMonth } from '@/lib/sync/months';

/** The month the close board is working: the previous Pacific month. */
export function currentCloseMonth(now: Date = new Date()): string {
    return previousMonth(ptMonth(now));
}

/** Reports in the global nav opens the close board for the current close month. */
export function reportsNavHref(now: Date = new Date()): string {
    if (!searchReportingEnabled()) return '/reports';
    return `/reports/close?month=${currentCloseMonth(now)}`;
}

/** The report builder stays on /reports. The flag adds a query so the close redirect does not loop. */
export function reportsBuilderHref(): string {
    return searchReportingEnabled() ? '/reports?builder=1' : '/reports';
}
