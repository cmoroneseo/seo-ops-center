/**
 * A published content piece keeps its live URL on the task.
 * The ship date is completed_at, already written when the task is marked done.
 * A task with no URL is not shipped work.
 */

import type { LedgerDeliverableInput } from '@/lib/search-reporting/ledger';
import { normalizeShipDate, parseHttpUrl } from '@/lib/search-reporting/proof';

export const LIVE_URL_MAX_LENGTH = 2000;

const HTTP_URL = /https?:\/\/[^\s<>"']+/i;

export interface SubtaskLine {
    title: string;
    publishedUrl: string | null;
}

export function splitLiveUrl(line: string): SubtaskLine {
    const trimmed = line.trim().replace(/\s+/g, ' ');
    const match = HTTP_URL.exec(trimmed);
    if (!match) return { title: trimmed, publishedUrl: null };
    const publishedUrl = trimUrlTail(match[0]);
    if (!parseHttpUrl(publishedUrl)) return { title: trimmed, publishedUrl: null };

    let before = trimmed.slice(0, match.index);
    let after = trimmed.slice(match.index + match[0].length);
    const removed = match[0].slice(publishedUrl.length);
    if (removed && after.startsWith(removed)) after = after.slice(removed.length);
    if (removed.includes(')') && /\(\s*$/.test(before)) before = before.replace(/\(\s*$/, '');
    const title = `${before} ${after}`.replace(/\s+/g, ' ').trim();
    return { title: title || labelFromUrl(publishedUrl), publishedUrl };
}

export function subtaskLineDrafts(lines: readonly string[]): SubtaskLine[] {
    return lines.map(splitLiveUrl);
}

/** A pasted subtask line is checked on the title that will be stored. */
export function subtaskLinesError(
    lines: readonly string[],
    titleError: (titles: readonly string[]) => string | null,
): string | null {
    const drafts = subtaskLineDrafts(lines);
    const problem = titleError(drafts.map(draft => draft.title));
    if (problem) return problem;
    if (drafts.some(draft => (draft.publishedUrl?.length ?? 0) > LIVE_URL_MAX_LENGTH)) {
        return 'That link is too long.';
    }
    return null;
}

export function parseLiveUrlInput(raw: string): { ok: true; publishedUrl: string | null } | { ok: false; error: string } {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, publishedUrl: null };
    if (trimmed.length > LIVE_URL_MAX_LENGTH) return { ok: false, error: 'That link is too long.' };
    if (!parseHttpUrl(trimmed)) return { ok: false, error: 'Use a full http or https link.' };
    return { ok: true, publishedUrl: trimmed };
}

/**
 * Stamp a ship date only when done work gains a live URL and has none yet.
 * An existing completed_at stays. Open work and URL-less work are left alone.
 */
export function completedAtForLiveUrl(input: {
    status: string;
    completedAt?: string | null;
    publishedUrl?: string | null;
    now: string;
}): string | undefined {
    if (input.status !== 'done') return undefined;
    if (!input.publishedUrl?.trim()) return undefined;
    if (normalizeShipDate(input.completedAt)) return undefined;
    return input.now;
}

/** A done task with a live URL and a ship date. Anything else stays out of the ledger. */
export function taskToLedgerDeliverable(task: {
    id: string;
    title: string;
    status: string;
    category?: string | null;
    publishedUrl?: string | null;
    completedAt?: string | null;
}): LedgerDeliverableInput | null {
    const publishedUrl = task.publishedUrl?.trim() ?? '';
    if (task.status !== 'done' || !publishedUrl) return null;
    const deliveredOn = normalizeShipDate(task.completedAt);
    if (!deliveredOn) return null;
    const shape = ledgerShape(task.category);
    return {
        id: task.id,
        title: task.title.trim() || 'Untitled',
        type: shape.type,
        subtype: shape.subtype,
        status: 'Published',
        publishedUrl,
        deliveredOn,
    };
}

function ledgerShape(category: string | null | undefined): { type: string; subtype: string | null } {
    if (category === 'links') return { type: 'Backlink', subtype: 'link_building' };
    if (category === 'local') return { type: 'GBP', subtype: 'gbp_management' };
    return { type: 'Content', subtype: null };
}

function trimUrlTail(raw: string): string {
    let value = raw;
    while (/[),.;:!?]$/.test(value)) value = value.slice(0, -1);
    return value;
}

function labelFromUrl(raw: string): string {
    const url = parseHttpUrl(raw);
    if (!url) return raw;
    const parts = url.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (!last) return url.hostname.replace(/^www\./i, '');
    try {
        return decodeURIComponent(last).replace(/[-_]+/g, ' ');
    } catch {
        return last.replace(/[-_]+/g, ' ');
    }
}
