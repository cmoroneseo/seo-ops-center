const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a yyyy-MM-dd database value as local midnight rather than UTC. */
export function parseLocalDate(value: string): Date | null {
    const match = DATE_ONLY.exec(value);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
        ? date
        : null;
}

/** Format an instant as its local yyyy-MM-dd calendar day. */
export function formatLocalDate(value: Date | string): string {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date');

    return [
        String(date.getFullYear()).padStart(4, '0'),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
    ].join('-');
}

/** Explicit name for writes that record the local calendar day of an instant. */
export const localDateForInstant = formatLocalDate;
