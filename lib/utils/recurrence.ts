/**
 * Recurrence utilities — calculate next due date for recurring tasks.
 * Used by updateTask() (auto-spawn) and the recurring-tasks cron job.
 */

export type RecurrenceConfig = {
    freq: 'daily' | 'weekly' | 'monthly';
    dayOfMonth?: number; // 1–28 (monthly: spawn on this day each month)
    dayOfWeek?: number;  // 0–6 Sun–Sat (weekly: spawn on this day each week)
    endDate?: string;    // YYYY-MM-DD — no new instances after this date
};

/**
 * Calculate the next due date given a recurrence config and the last due date.
 * Returns null if past the endDate (no more instances to create).
 */
export function getNextDueDate(
    recurrence: RecurrenceConfig,
    fromDate: string, // YYYY-MM-DD
): string | null {
    // Parse as local date (avoid UTC timezone shift)
    const [y, m, d] = fromDate.split('-').map(Number);
    const base = new Date(y, m - 1, d);

    let next: Date;

    if (recurrence.freq === 'daily') {
        next = new Date(base);
        next.setDate(next.getDate() + 1);
    } else if (recurrence.freq === 'weekly') {
        next = new Date(base);
        next.setDate(next.getDate() + 7);

        // If dayOfWeek is specified, find the next occurrence of that weekday
        if (recurrence.dayOfWeek !== undefined) {
            const targetDow = recurrence.dayOfWeek;
            const daysUntil = ((targetDow - base.getDay() + 7) % 7) || 7;
            next = new Date(base);
            next.setDate(next.getDate() + daysUntil);
        }
    } else {
        // monthly
        next = new Date(base);
        next.setMonth(next.getMonth() + 1);

        // If dayOfMonth specified, pin to that day (clamped to month-end)
        if (recurrence.dayOfMonth !== undefined) {
            const dom = recurrence.dayOfMonth;
            next.setDate(1); // go to 1st to avoid overflow issues
            // Clamp to last day of month
            const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
            next.setDate(Math.min(dom, lastDay));
        }
    }

    // Format as YYYY-MM-DD
    const nextStr = formatDate(next);

    // Check endDate
    if (recurrence.endDate && nextStr > recurrence.endDate) return null;

    return nextStr;
}

function formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Human-readable description of a recurrence config.
 * e.g., "Monthly on the 1st", "Weekly on Monday", "Daily"
 */
export function describeRecurrence(recurrence: RecurrenceConfig): string {
    const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (recurrence.freq === 'daily') return 'Daily';
    if (recurrence.freq === 'weekly') {
        if (recurrence.dayOfWeek !== undefined) {
            return `Weekly on ${DOW_NAMES[recurrence.dayOfWeek]}`;
        }
        return 'Weekly';
    }
    // monthly
    if (recurrence.dayOfMonth !== undefined) {
        const suffix = ordinal(recurrence.dayOfMonth);
        return `Monthly on the ${suffix}`;
    }
    return 'Monthly';
}

function ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
