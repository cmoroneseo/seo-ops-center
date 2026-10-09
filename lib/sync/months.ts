/** Calendar helpers for monthly sync. Month math is string arithmetic, never Date timezone conversion. */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function ptToday(now: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(now);
}

export function ptMonth(now: Date): string {
    return ptToday(now).slice(0, 7);
}

export function previousMonth(month: string): string {
    const match = MONTH.exec(month);
    if (!match) throw new Error('Invalid month');
    let year = Number(match[1]);
    let monthNumber = Number(match[2]);
    monthNumber -= 1;
    if (monthNumber === 0) {
        monthNumber = 12;
        year -= 1;
    }
    return `${year}-${String(monthNumber).padStart(2, '0')}`;
}

function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
    const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return lengths[month - 1];
}

export function monthBounds(month: string): { start: string; end: string; days: number } {
    const match = MONTH.exec(month);
    if (!match) throw new Error('Invalid month');
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    const days = daysInMonth(year, monthNumber);
    const mm = String(monthNumber).padStart(2, '0');
    return {
        start: `${year}-${mm}-01`,
        end: `${year}-${mm}-${String(days).padStart(2, '0')}`,
        days,
    };
}

/** A month is closed once Pacific time has moved into a later month. */
export function isClosedMonth(month: string, now: Date): boolean {
    return month < ptMonth(now);
}

/** Current Pacific month, plus the previous month through the 7th so the last days land. */
export function cronMonths(now: Date): string[] {
    const current = ptMonth(now);
    const day = Number(ptToday(now).slice(8, 10));
    if (day <= 7) return [current, previousMonth(current)];
    return [current];
}
