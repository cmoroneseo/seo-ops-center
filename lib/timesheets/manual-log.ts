import { weekDays } from './ledger.ts';

/**
 * The calendar day a manual timesheet entry should open on.
 * Today, when that column is on the week being viewed. Otherwise the first
 * visible day of that week, so the new row lands on the timesheet on screen.
 */
export function manualLogDate(weekStart: string, today: string): string {
    const days = weekDays(weekStart);
    if (days.includes(today)) return today;
    return days[0] ?? weekStart;
}
