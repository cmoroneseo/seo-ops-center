/**
 * Receipt model: what a number is willing to say about itself.
 * The popover stays at or under seven rows. Client receipts drop property
 * and method. Staff receipts link to Search Insights with the same `?range=`.
 */

import { assertClientCopy } from '../reports/copy-rules.ts';
import { STATES_COPY, snapshotLocked, type ReceiptTag } from './states-copy.ts';

export const RECEIPT_HOVER_OPEN_MS = 150;
export const RECEIPT_ROW_LIMIT = 7;
export const INSIGHTS_LINK_LABEL = 'Open in Search Insights →';

export type ReceiptTier = 'A' | 'B' | 'card';
export type ReceiptAudience = 'staff' | 'client';

export interface ReceiptInput {
    title: string;
    value: string;
    freshness: string;
    source: string;
    property?: string | null;
    dates: string;
    method?: string | null;
    note?: string | null;
    audience?: ReceiptAudience;
    tier?: ReceiptTier;
    tag?: ReceiptTag | null;
    /** Display date already formatted. Frozen receipts read the snapshot. */
    frozenAt?: string | null;
    clientId?: string | null;
    range?: string | null;
    metricSources?: readonly string[];
    /** Staff tooltip that is previewing the words a client would read. */
    previewClientCopy?: boolean;
}

export interface ReceiptRow {
    label: string;
    value: string;
}

export interface ReceiptContent {
    title: string;
    value: string;
    tier: ReceiptTier;
    audience: ReceiptAudience;
    tag: ReceiptTag | null;
    rows: ReceiptRow[];
    insightsHref: string | null;
    insightsLabel: string;
    copyIssue: string | null;
    triggerLabel: string;
}

export interface ReceiptInteraction {
    open: boolean;
    pinned: boolean;
}

export type ReceiptSignal =
    | { type: 'hover-open' }
    | { type: 'hover-close' }
    | { type: 'focus' }
    | { type: 'blur'; intoPopover: boolean }
    | { type: 'activate' }
    | { type: 'escape' }
    | { type: 'outside' };

export interface ReceiptTransition {
    state: ReceiptInteraction;
    returnFocus: boolean;
}

export function receiptTriggerLabel(value: string): string {
    return `${value}: show source`;
}

export function searchInsightsHref(clientId: string, range: string): string {
    return `/workspace/${encodeURIComponent(clientId)}?range=${encodeURIComponent(range)}`;
}

export function clientCopyIssue(text: string, metricSources: readonly string[]): string | null {
    try {
        assertClientCopy(text, metricSources);
        return null;
    } catch (error) {
        if (error instanceof Error && error.name === 'ClientCopyError') return error.message;
        throw error;
    }
}

function clean(value: string | null | undefined): string | null {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
}

export function buildReceiptContent(input: ReceiptInput): ReceiptContent {
    const audience = input.audience ?? 'staff';
    const tier = input.tier ?? 'A';
    const frozenAt = clean(input.frozenAt);
    const tag: ReceiptTag | null = frozenAt ? STATES_COPY.snapshotTag : input.tag ?? null;
    const freshness = frozenAt ? snapshotLocked(frozenAt) : input.freshness;
    const lint = audience === 'client' || input.previewClientCopy === true;
    const sources = input.metricSources ?? [];
    let copyIssue: string | null = null;

    const consider = (text: string): string | null => {
        if (!lint) return text;
        const issue = clientCopyIssue(text, sources);
        if (!issue) return text;
        copyIssue ??= issue;
        return null;
    };

    const title = consider(input.title) ?? 'Source';
    const visibleValue = lint ? (consider(input.value) ?? '—') : input.value;
    const rows: ReceiptRow[] = [];
    const push = (label: string, value: string | null | undefined) => {
        const text = clean(value);
        if (!text) return;
        const safe = consider(text);
        if (!safe) return;
        rows.push({ label, value: safe });
    };

    push('Value', visibleValue);
    push('Freshness', freshness);
    push('Source', input.source);
    if (audience === 'staff') push('Property', input.property);
    push('Dates', input.dates);
    if (audience === 'staff') push('Method', input.method);
    push('Note', input.note);

    const range = clean(input.range);
    const clientId = clean(input.clientId);
    const insightsHref = audience === 'staff' && clientId && range
        ? searchInsightsHref(clientId, range)
        : null;

    return {
        title,
        value: visibleValue,
        tier,
        audience,
        tag,
        rows: rows.slice(0, RECEIPT_ROW_LIMIT),
        insightsHref,
        insightsLabel: INSIGHTS_LINK_LABEL,
        copyIssue,
        triggerLabel: receiptTriggerLabel(visibleValue),
    };
}

export function reduceReceipt(state: ReceiptInteraction, signal: ReceiptSignal): ReceiptTransition {
    switch (signal.type) {
        case 'hover-open':
            if (state.pinned) return { state, returnFocus: false };
            return { state: { open: true, pinned: false }, returnFocus: false };
        case 'hover-close':
            if (state.pinned) return { state, returnFocus: false };
            return { state: { open: false, pinned: false }, returnFocus: false };
        case 'focus':
            if (state.pinned) return { state, returnFocus: false };
            return { state: { open: true, pinned: false }, returnFocus: false };
        case 'blur':
            if (state.pinned || signal.intoPopover) return { state, returnFocus: false };
            return { state: { open: false, pinned: false }, returnFocus: false };
        case 'activate':
            if (state.pinned && state.open) return { state: { open: false, pinned: false }, returnFocus: true };
            return { state: { open: true, pinned: true }, returnFocus: false };
        case 'escape':
        case 'outside':
            if (!state.open) return { state, returnFocus: false };
            return { state: { open: false, pinned: false }, returnFocus: true };
        default:
            return { state, returnFocus: false };
    }
}

/** Shared by the trigger and tests so Escape both closes and moves focus back. */
export function commitReceiptSignal(
    state: ReceiptInteraction,
    signal: ReceiptSignal,
    trigger?: { focus(): void } | null,
): ReceiptInteraction {
    const effect = reduceReceipt(state, signal);
    if (effect.returnFocus) trigger?.focus();
    return effect.state;
}
