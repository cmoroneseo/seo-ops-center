export type SyncService = 'ga4' | 'gsc' | 'gbp' | 'ahrefs';

/** A measured value. Null means the source did not return it. Zero is a real zero. */
export type MetricValues = Record<string, number | null>;

export type FetchResult =
    | { status: 'ok'; data: MetricValues; provenance?: Record<string, unknown> }
    | { status: 'no_data'; reason: string }
    | { status: 'not_configured'; reason: string }
    | { status: 'error'; message: string; retryable: boolean; reauth?: boolean };

export const ok = (data: MetricValues, provenance?: Record<string, unknown> | null): FetchResult => (
    provenance == null ? { status: 'ok', data } : { status: 'ok', data, provenance }
);
export const noData = (reason: string): FetchResult => ({ status: 'no_data', reason });
export const notConfigured = (reason: string): FetchResult => ({ status: 'not_configured', reason });

export function fetchError(message: string, retryable: boolean, reauth?: boolean): FetchResult {
    return reauth
        ? { status: 'error', message, retryable, reauth }
        : { status: 'error', message, retryable };
}
