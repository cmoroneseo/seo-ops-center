/** Rolling Search Console windows. The end date is the latest stored day, not today. */

export const DASHBOARD_RANGES = ['7d', '28d', '3m', '6m', '12m'] as const;
export type DashboardRange = typeof DASHBOARD_RANGES[number];
export type DashboardBucket = 'day' | 'week' | 'month';

export interface DateSpan { start: string; end: string }

export interface DashboardWindow {
    range: DashboardRange;
    bucket: DashboardBucket;
    current: DateSpan;
    previous: DateSpan;
}

const RANGE_LABEL: Record<DashboardRange, string> = {
    '7d': '7D',
    '28d': '28D',
    '3m': '3M',
    '6m': '6M',
    '12m': '12M',
};

export function isDashboardRange(value: string | null | undefined): value is DashboardRange {
    return DASHBOARD_RANGES.includes(value as DashboardRange);
}

export function dashboardRangeLabel(range: DashboardRange): string {
    return RANGE_LABEL[range];
}

export function addDays(iso: string, days: number): string {
    const value = new Date(`${iso}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
    const [year, month, day] = iso.split('-').map(Number);
    const total = month - 1 + months;
    const nextYear = year + Math.floor(total / 12);
    const nextMonth = ((total % 12) + 12) % 12;
    const last = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
    return new Date(Date.UTC(nextYear, nextMonth, Math.min(day, last))).toISOString().slice(0, 10);
}

export function daysInclusive(start: string, end: string): number {
    return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1;
}

/**
 * 7D and 28D are exact day counts. 3M, 6M, and 12M step back calendar months
 * and start the day after that anniversary so the previous window can sit
 * against this one with no overlap and no gap.
 */
export function dashboardWindow(range: DashboardRange, asOf: string): DashboardWindow {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error('Choose a valid end date.');
    const end = asOf;
    const bucket: DashboardBucket = range === '7d' || range === '28d' ? 'day' : range === '12m' ? 'month' : 'week';
    const start = range === '7d'
        ? addDays(end, -6)
        : range === '28d'
            ? addDays(end, -27)
            : addDays(addMonths(end, range === '3m' ? -3 : range === '6m' ? -6 : -12), 1);
    const length = daysInclusive(start, end);
    const previousEnd = addDays(start, -1);
    const previousStart = addDays(previousEnd, -(length - 1));
    return {
        range,
        bucket,
        current: { start, end },
        previous: { start: previousStart, end: previousEnd },
    };
}

/** Postgres date_trunc('week') starts on Monday. Month buckets start on the 1st. */
export function bucketStart(iso: string, bucket: DashboardBucket): string {
    if (bucket === 'month') return `${iso.slice(0, 7)}-01`;
    if (bucket === 'day') return iso;
    const date = new Date(`${iso}T12:00:00Z`);
    const weekday = date.getUTCDay();
    return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}

export function bucketSpine(start: string, end: string, bucket: DashboardBucket): string[] {
    const keys: string[] = [];
    let cursor = bucketStart(start, bucket);
    const last = bucketStart(end, bucket);
    while (cursor <= last && keys.length < 400) {
        keys.push(cursor);
        cursor = bucket === 'month' ? addMonths(cursor, 1) : bucket === 'week' ? addDays(cursor, 7) : addDays(cursor, 1);
    }
    return keys;
}

export function formatSpan(span: DateSpan): string {
    const part = (iso: string) => {
        const date = new Date(`${iso}T12:00:00Z`);
        return {
            month: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date),
            day: date.getUTCDate(),
            year: date.getUTCFullYear(),
        };
    };
    const start = part(span.start);
    const end = part(span.end);
    if (span.start === span.end) return `${start.month} ${start.day}, ${start.year}`;
    if (start.year === end.year && start.month === end.month) return `${start.month} ${start.day}–${end.day}, ${end.year}`;
    if (start.year === end.year) return `${start.month} ${start.day}–${end.month} ${end.day}, ${end.year}`;
    return `${start.month} ${start.day}, ${start.year}–${end.month} ${end.day}, ${end.year}`;
}

export function formatDay(iso: string | null): string | null {
    if (!iso) return null;
    const date = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function formatImportedAt(iso: string | null): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/Los_Angeles',
        timeZoneName: 'short',
    }).format(date);
}
