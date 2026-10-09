import { searchReportingEnabled } from '@/lib/search-reporting/flag';

/** Reports in the global nav opens the month-close board when reporting is on. */
export function reportsNavHref(): string {
    return searchReportingEnabled() ? '/reports/close' : '/reports';
}
