export interface BingManualView {
    sitesMapped: number;
    sitesSynced: number;
    remaining: number;
    errors: number[];
    skipped: 'flag_off' | 'missing_key' | 'unavailable' | null;
}

function count(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100000) return null;
    return value;
}

function statuses(value: unknown): number[] | null {
    if (!Array.isArray(value)) return null;
    const codes: number[] = [];
    for (const item of value) {
        if (typeof item !== 'number' || !Number.isInteger(item) || item < 100 || item > 599) return null;
        codes.push(item);
    }
    return codes;
}

/** Keep only counts and HTTP status codes. Anything else, including a key, is dropped. */
export function readBingManualView(value: unknown): BingManualView | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const sitesMapped = count(row.sitesMapped);
    const sitesSynced = count(row.sitesSynced);
    const remaining = count(row.remaining);
    const errors = statuses(row.errors);
    if (sitesMapped == null || sitesSynced == null || remaining == null || errors == null) return null;
    const skipped = row.skipped == null ? null
        : row.skipped === 'flag_off' || row.skipped === 'missing_key' || row.skipped === 'unavailable'
            ? row.skipped
            : null;
    if (row.skipped != null && skipped == null) return null;
    return { sitesMapped, sitesSynced, remaining, errors, skipped };
}

export function formatBingSyncResult(result: BingManualView): string {
    if (result.skipped === 'flag_off') return 'Bing sync is off.';
    if (result.skipped === 'missing_key') return 'Bing sync is not configured.';
    if (result.skipped === 'unavailable') return 'Bing sync did not finish. Try again.';
    const errors = result.errors.length > 0 ? ` Errors: ${result.errors.join(', ')}.` : '';
    return `Mapped ${result.sitesMapped}. Synced ${result.sitesSynced}. ${result.remaining} remaining.${errors}`;
}
