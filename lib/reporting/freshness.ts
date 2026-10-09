/**
 * How old a reporting number is allowed to be before the surface says so.
 * Fresh is `<=` the window. A sync that errored is stale immediately.
 */

import { STATES_COPY, staleAsOf, type ReceiptTag } from './states-copy.ts';

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export const FRESH_WINDOW_MS = {
    gsc: 36 * HOUR_MS,
    ga4: 36 * HOUR_MS,
    ahrefs: 36 * HOUR_MS,
    gbp: 72 * HOUR_MS,
    dfs: 7 * DAY_MS,
} as const;

export type FreshnessSource = keyof typeof FRESH_WINDOW_MS;

export type FreshnessState = 'fresh' | 'stale' | 'partial' | 'empty' | 'missing' | 'not_connected';

export interface FreshnessInput {
    source: FreshnessSource;
    connected: boolean;
    /** Shown after the em dash when the source is not connected. */
    notConnectedReason?: string;
    lastSyncAt: Date | null;
    lastSyncErrored: boolean;
    now: Date;
    historyCoversWindow: boolean;
    backfillRunning: boolean;
    /** `null` is missing. `0` is a real zero. */
    value: number | null;
}

export interface FreshnessReadout {
    state: FreshnessState;
    displayValue: string;
    /** Empty and missing stay neutral. Never green, never an em dash for a real zero. */
    tone: 'neutral';
    copy: string;
    /** "as of {date}" when the number is stale and a sync time exists. */
    asOf: string | null;
    tag: ReceiptTag | null;
}

const STALE_COPY: Record<FreshnessSource, string> = {
    gsc: STATES_COPY.staleGsc,
    ga4: STATES_COPY.staleDefault,
    ahrefs: STATES_COPY.staleDefault,
    gbp: STATES_COPY.staleGbp,
    dfs: STATES_COPY.staleDfs,
};

export function formatAsOfDate(date: Date): string {
    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    }).format(date);
}

function displayFor(value: number | null): string {
    if (value == null) return STATES_COPY.missingValue;
    if (value === 0) return STATES_COPY.emptyValue;
    return String(value);
}

export function resolveFreshness(input: FreshnessInput): FreshnessReadout {
    if (!input.connected) {
        const reason = input.notConnectedReason?.trim() || STATES_COPY.notConnected;
        return {
            state: 'not_connected',
            displayValue: STATES_COPY.missingValue,
            tone: 'neutral',
            copy: reason,
            asOf: null,
            tag: null,
        };
    }

    const age = input.lastSyncAt == null ? null : input.now.getTime() - input.lastSyncAt.getTime();
    const windowMs = FRESH_WINDOW_MS[input.source];
    const stale = input.lastSyncErrored || age == null || age > windowMs;
    if (stale) {
        const copy = input.lastSyncErrored
            ? STATES_COPY.staleError
            : age == null
                ? STATES_COPY.noSuccessfulSync
                : STALE_COPY[input.source];
        return {
            state: 'stale',
            displayValue: displayFor(input.value),
            tone: 'neutral',
            copy,
            asOf: input.lastSyncAt ? staleAsOf(formatAsOfDate(input.lastSyncAt)) : null,
            tag: null,
        };
    }

    if (!input.historyCoversWindow || input.backfillRunning) {
        return {
            state: 'partial',
            displayValue: displayFor(input.value),
            tone: 'neutral',
            copy: input.backfillRunning ? STATES_COPY.partialBackfill : STATES_COPY.partialHistory,
            asOf: null,
            tag: STATES_COPY.prelimTag,
        };
    }

    if (input.value === 0) {
        return {
            state: 'empty',
            displayValue: STATES_COPY.emptyValue,
            tone: 'neutral',
            copy: STATES_COPY.empty,
            asOf: null,
            tag: null,
        };
    }

    if (input.value == null) {
        return {
            state: 'missing',
            displayValue: STATES_COPY.missingValue,
            tone: 'neutral',
            copy: STATES_COPY.missing,
            asOf: null,
            tag: null,
        };
    }

    return {
        state: 'fresh',
        displayValue: displayFor(input.value),
        tone: 'neutral',
        copy: STATES_COPY.fresh,
        asOf: null,
        tag: null,
    };
}
