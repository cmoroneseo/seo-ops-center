/**
 * Bing JSON dates look like `/Date(1316156400000-0700)/`.
 * The calendar date is the one in that offset, not the UTC day.
 */
export function parseBingDate(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const match = /^\/Date\((-?\d+)([+-]\d{4})?\)\/$/.exec(value);
    if (!match) return null;
    const ms = Number(match[1]);
    if (!Number.isSafeInteger(ms)) return null;
    let offsetMinutes = 0;
    if (match[2]) {
        const sign = match[2][0] === '-' ? -1 : 1;
        const hours = Number(match[2].slice(1, 3));
        const mins = Number(match[2].slice(3, 5));
        if (hours > 14 || mins > 59) return null;
        offsetMinutes = sign * (hours * 60 + mins);
    }
    const shifted = ms + offsetMinutes * 60 * 1000;
    if (!Number.isSafeInteger(shifted)) return null;
    const date = new Date(shifted);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
