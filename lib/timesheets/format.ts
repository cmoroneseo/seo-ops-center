import { parseLocalDate } from '../planner/local-date.ts';
import { weekDays } from './ledger.ts';
import type { TimeLogSource } from '../types.ts';

/**
 * Presentation helpers for the Ledger Grid.
 *
 * Kept out of the components (and tested) because every cell, total, and
 * summary tile has to read identically — a grid where one row says "3h 10m"
 * and another says "3.17h" is a grid nobody trusts.
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SOURCE_LABELS: Record<TimeLogSource, string> = {
    seo_pm: 'SEO PM',
    basecamp: 'Basecamp',
};

/** '3h 10m', '15m', or the zero placeholder (an em-dash by default). */
export function formatDuration(
    minutes: number,
    options: { zero?: string } = {},
): string {
    if (!Number.isFinite(minutes) || minutes === 0) return options.zero ?? '–';

    const sign = minutes < 0 ? '-' : '';
    const total = Math.abs(Math.round(minutes));
    const hours = Math.floor(total / 60);
    const remainder = total % 60;

    if (hours === 0) return `${sign}${remainder}m`;
    return `${sign}${hours}h ${String(remainder).padStart(2, '0')}m`;
}

export function formatDayHeading(date: string): { weekday: string; date: string } {
    const parsed = parseLocalDate(date);
    if (!parsed) return { weekday: '', date: '' };
    return {
        weekday: WEEKDAYS[parsed.getDay()],
        date: `${MONTHS[parsed.getMonth()]} ${parsed.getDate()}`,
    };
}

/** 'Aug 23 – Aug 29, 2026', widening to include both years across New Year. */
export function formatWeekRange(weekStart: string): string {
    const days = weekDays(weekStart);
    const start = parseLocalDate(days[0]);
    const end = parseLocalDate(days[days.length - 1]);
    if (!start || !end) return '';

    const startLabel = `${MONTHS[start.getMonth()]} ${start.getDate()}`;
    const endLabel = `${MONTHS[end.getMonth()]} ${end.getDate()}`;

    return start.getFullYear() === end.getFullYear()
        ? `${startLabel} – ${endLabel}, ${end.getFullYear()}`
        : `${startLabel}, ${start.getFullYear()} – ${endLabel}, ${end.getFullYear()}`;
}

export function formatSourceLabel(sources: TimeLogSource[]): string {
    // Stable order so a mixed row never flips its label between renders.
    const ordered: TimeLogSource[] = ['seo_pm', 'basecamp'];
    return ordered
        .filter(source => sources.includes(source))
        .map(source => SOURCE_LABELS[source])
        .join(' + ');
}

export function percentOf(part: number, whole: number): number {
    if (!whole) return 0;
    return Math.round((part / whole) * 100);
}
