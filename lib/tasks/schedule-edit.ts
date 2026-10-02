/** Keep the existing time/offset when editing only the date of scheduled work. */
export function startDateForDay(date: string, original?: string): string | null {
    if (!date) return null;
    return `${date}${original && original.length > 10 ? original.slice(10) : 'T00:00:00.000Z'}`;
}

export function scheduleDateError(start: string, due: string): string | null {
    return start && due && start.slice(0, 10) > due.slice(0, 10) ? 'Due date must be on or after the start date.' : null;
}

export function estimateFromInput(value: string): { value: number | null; error?: string } {
    if (!value.trim()) return { value: null };
    const hours = Number(value);
    return Number.isFinite(hours) && hours >= 0 ? { value: hours } : { value: null, error: 'Enter a valid estimate of zero hours or more.' };
}
