export interface MyTimeLog {
    date: string;
    hours: number;
    userId: string;
}

export interface MyTimeTotals {
    week: number;
    month: number;
}

/** Em dash until a successful read. A loaded zero stays `0h`. */
export function formatMyTimeHours(hours: number | null): string {
    if (hours == null || !Number.isFinite(hours)) return '—';
    return `${Math.round(hours * 10) / 10}h`;
}

/**
 * Hours for one person in the month already loaded.
 * `null` logs or a missing user are unknown, not zero.
 */
export function summarizeMyTime(
    logs: readonly MyTimeLog[] | null,
    userId: string | null | undefined,
    today: Date,
): MyTimeTotals | null {
    if (logs == null || !userId) return null;
    const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);
    weekStart.setHours(0, 0, 0, 0);
    let week = 0;
    let month = 0;
    for (const log of logs) {
        if (log.userId !== userId) continue;
        month += log.hours;
        const logDate = new Date(`${log.date}T00:00:00`);
        if (logDate >= weekStart) week += log.hours;
    }
    return {
        week: Math.round(week * 10) / 10,
        month: Math.round(month * 10) / 10,
    };
}
