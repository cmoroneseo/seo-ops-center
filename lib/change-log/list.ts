import { dateOffset } from '@/lib/gsc/history';

import { CHECKPOINTS, GSC_LAG_DAYS, type CheckpointDays } from './thresholds';
import { afterWindow, formatDay, formatDayWithYear, isIsoDay } from './time';
import {
    CHANGE_TYPE_LABEL,
    EARLY_ESTIMATE_LABEL,
    KPI_LABEL,
    VERDICT_LABEL,
    resultLabel,
    type ChangeType,
    type CheckpointRead,
    type TimelineItem,
} from './types';

export type ResultBucket = 'improved' | 'flat' | 'declined' | 'too_early' | 'early_estimate';

export const RESULT_STRIP: { id: ResultBucket; label: string }[] = [
    { id: 'improved', label: VERDICT_LABEL.improved },
    { id: 'flat', label: VERDICT_LABEL.flat },
    { id: 'declined', label: VERDICT_LABEL.declined },
    { id: 'too_early', label: VERDICT_LABEL.too_early },
    { id: 'early_estimate', label: EARLY_ESTIMATE_LABEL },
];

export type ChangeSortKey = 'change' | 'type' | 'live' | 'watching' | 'result' | 'next';
export type SortDirection = 'asc' | 'desc';

export interface ChangeSort {
    key: ChangeSortKey;
    direction: SortDirection;
}

/** Went live, newest first. */
export const DEFAULT_CHANGE_SORT: ChangeSort = { key: 'live', direction: 'desc' };

export const CHANGE_COLUMNS: { key: ChangeSortKey; label: string }[] = [
    { key: 'change', label: 'Change' },
    { key: 'type', label: 'Type' },
    { key: 'live', label: 'Went live' },
    { key: 'watching', label: "What we're watching" },
    { key: 'result', label: 'Latest result' },
    { key: 'next', label: 'Next check' },
];

export interface ChangeListFilter {
    query?: string;
    type?: ChangeType | '';
    from?: string;
    to?: string;
    result?: ResultBucket | null;
}

export type LiveRangePreset = '30' | '90' | 'all' | 'custom';

export interface LiveRange {
    from: string;
    to: string;
}

export const LIVE_RANGE_PRESETS: { id: LiveRangePreset; label: string }[] = [
    { id: '30', label: 'Last 30 days' },
    { id: '90', label: 'Last 90 days' },
    { id: 'all', label: 'All time' },
    { id: 'custom', label: 'Custom' },
];

const PRESET_DAYS = { '30': 30, '90': 90 } as const;

/** No start and no end. The list shows every go-live date. */
export function clearLiveRange(): LiveRange {
    return { from: '', to: '' };
}

/**
 * Inclusive Pacific window ending on today.
 * Last 30 days is today and the 29 days before it. An unusable today means All time.
 */
export function liveRangeForPreset(preset: '30' | '90' | 'all', today: string): LiveRange {
    if (preset === 'all' || !isIsoDay(today)) return clearLiveRange();
    return { from: dateOffset(today, 1 - PRESET_DAYS[preset]), to: today };
}

/** Keeps real dates only. A backwards pair is swapped so the earlier day is the start. */
export function customLiveRange(from: string, to: string): LiveRange {
    const start = isIsoDay(from) ? from : '';
    const end = isIsoDay(to) ? to : '';
    if (start && end && start > end) return { from: end, to: start };
    return { from: start, to: end };
}

export function matchLiveRange(range: LiveRange, today: string): LiveRangePreset {
    if (!range.from && !range.to) return 'all';
    if (isIsoDay(today)) {
        for (const preset of ['30', '90'] as const) {
            const expected = liveRangeForPreset(preset, today);
            if (range.from === expected.from && range.to === expected.to) return preset;
        }
    }
    return 'custom';
}

export function liveRangeLabel(range: LiveRange, today: string): string {
    const preset = matchLiveRange(range, today);
    if (preset === '30') return 'Last 30 days';
    if (preset === '90') return 'Last 90 days';
    if (preset === 'all') return 'All time';
    if (range.from && range.to) return `${formatDayWithYear(range.from)} – ${formatDayWithYear(range.to)}`;
    if (range.from) return `From ${formatDayWithYear(range.from)}`;
    if (range.to) return `Through ${formatDayWithYear(range.to)}`;
    return 'Custom';
}

export function resultBucket(item: Pick<TimelineItem, 'verdict' | 'estimate'>): ResultBucket {
    return item.estimate ? 'early_estimate' : item.verdict;
}

export function summaryCounts(
    items: readonly Pick<TimelineItem, 'verdict' | 'estimate'>[],
): Record<ResultBucket, number> {
    const counts: Record<ResultBucket, number> = {
        improved: 0,
        flat: 0,
        declined: 0,
        too_early: 0,
        early_estimate: 0,
    };
    for (const item of items) counts[resultBucket(item)] += 1;
    return counts;
}

/** Clicking the selected bucket again clears it. */
export function toggleResult(current: ResultBucket | null, next: ResultBucket): ResultBucket | null {
    return current === next ? null : next;
}

export function toggleSort(current: ChangeSort, key: ChangeSortKey): ChangeSort {
    if (current.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
    }
    return { key, direction: 'asc' };
}

/**
 * Headline fields for one list row.
 * An unfinished check contributes null, not zero, even if a lift number is sitting on it.
 */
export function headlineFields(headline: Pick<CheckpointRead, 'ready' | 'days' | 'lift'>): {
    headlineDays: CheckpointDays | null;
    headlinePct: number | null;
} {
    if (!headline.ready) return { headlineDays: null, headlinePct: null };
    if (headline.lift == null || !Number.isFinite(headline.lift)) {
        return { headlineDays: headline.days, headlinePct: null };
    }
    return {
        headlineDays: headline.days,
        headlinePct: Math.round(headline.lift * 1000) / 10,
    };
}

/**
 * The next check is the shortest window whose last day is not final yet.
 * Due date is go-live plus that many days. Ready means the window end
 * (go-live + N − 1) is on or before the final-data date.
 */
export function nextCheck(liveOn: string, through: string): {
    nextCheckOn: string | null;
    nextCheckDays: CheckpointDays | null;
} {
    if (!isIsoDay(liveOn) || !isIsoDay(through)) return { nextCheckOn: null, nextCheckDays: null };
    for (const days of CHECKPOINTS) {
        if (afterWindow(liveOn, days).end > through) {
            return { nextCheckOn: dateOffset(liveOn, days), nextCheckDays: days };
        }
    }
    return { nextCheckOn: null, nextCheckDays: null };
}

/** Signed percent for a pill. Null stays null so a missing result is never drawn as 0%. */
export function formatHeadlinePct(pct: number | null): string | null {
    if (pct == null || !Number.isFinite(pct)) return null;
    const rounded = Math.round(pct * 10) / 10;
    const body = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1);
    if (rounded === 0) return '0%';
    return `${rounded > 0 ? '+' : '−'}${body}%`;
}

export function resultDetail(item: Pick<TimelineItem, 'headlineDays'>): string {
    if (item.headlineDays == null) return 'Not ready yet';
    return `${item.headlineDays}-day check`;
}

export function nextCheckCopy(
    item: Pick<TimelineItem, 'nextCheckOn' | 'nextCheckDays'>,
    today: string,
): { date: string; check: string; data: string | null } {
    if (!item.nextCheckOn || item.nextCheckDays == null) {
        return { date: 'No further check', check: '', data: null };
    }
    const waiting = isIsoDay(today) && item.nextCheckOn <= today;
    return {
        date: formatDayWithYear(item.nextCheckOn),
        check: `${item.nextCheckDays}-day check`,
        data: waiting ? `data ~${formatDay(dateOffset(item.nextCheckOn, GSC_LAG_DAYS))}` : null,
    };
}

/** Path under the title. The site root uses the page name, matching a homepage row. */
export function pagePath(url: string, label: string): string {
    const trimmed = url.trim();
    if (!trimmed) return label || 'Page';
    let path = trimmed;
    if (/^https?:\/\//i.test(trimmed)) {
        try {
            path = new URL(trimmed).pathname || '/';
        } catch {
            path = trimmed;
        }
    }
    if (path === '/' || path === '') return label || '/';
    return path;
}

export function filterChanges(items: readonly TimelineItem[], filter: ChangeListFilter = {}): TimelineItem[] {
    const needle = filter.query?.trim().toLowerCase() ?? '';
    return items.filter(item => {
        if (filter.type && item.changeType !== filter.type) return false;
        if (filter.from && item.liveOn < filter.from) return false;
        if (filter.to && item.liveOn > filter.to) return false;
        if (filter.result && resultBucket(item) !== filter.result) return false;
        if (needle) {
            const hay = `${item.title} ${item.pageLabel} ${item.url} ${pagePath(item.url, item.pageLabel)}`.toLowerCase();
            if (!hay.includes(needle)) return false;
        }
        return true;
    });
}

function signed(diff: number, direction: SortDirection): number {
    if (diff === 0) return 0;
    return direction === 'asc' ? diff : -diff;
}

/** Missing dates and percents sort last in either direction, never as zero. */
function compareMissingLast(a: string | number | null, b: string | number | null, direction: SortDirection): number {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    const diff = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
    return signed(diff, direction);
}

export function sortChanges(items: readonly TimelineItem[], key: ChangeSortKey, direction: SortDirection): TimelineItem[] {
    const copy = [...items];
    copy.sort((a, b) => {
        let diff = 0;
        if (key === 'change') {
            diff = signed(a.title.localeCompare(b.title), direction)
                || signed(pagePath(a.url, a.pageLabel).localeCompare(pagePath(b.url, b.pageLabel)), direction);
        } else if (key === 'type') {
            diff = signed(CHANGE_TYPE_LABEL[a.changeType].localeCompare(CHANGE_TYPE_LABEL[b.changeType]), direction);
        } else if (key === 'live') {
            diff = signed(a.liveOn.localeCompare(b.liveOn), direction)
                || signed(a.liveAt.localeCompare(b.liveAt), direction);
        } else if (key === 'watching') {
            diff = signed(KPI_LABEL[a.kpi].localeCompare(KPI_LABEL[b.kpi]), direction);
        } else if (key === 'result') {
            diff = signed(resultLabel(a.verdict, a.estimate).localeCompare(resultLabel(b.verdict, b.estimate)), direction)
                || compareMissingLast(a.headlinePct, b.headlinePct, direction);
        } else {
            diff = compareMissingLast(a.nextCheckOn, b.nextCheckOn, direction)
                || compareMissingLast(a.nextCheckDays, b.nextCheckDays, direction);
        }
        return diff || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
    return copy;
}
