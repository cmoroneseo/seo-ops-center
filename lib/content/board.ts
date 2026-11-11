import type { MapRecordAction, MapRecordStatus, ProductionStatus, TopicalMapRecord } from '../types';
import {
    displayedProductionStatus,
    readIsoDay,
    readWorkMonth,
    workMonthLabel,
} from '../topical-map/production';

export const UNSCHEDULED_LABEL = 'Not scheduled yet';

export interface ContentBoardRecord {
    id: string;
    title: string;
    status: MapRecordStatus;
    productionStatus?: ProductionStatus | null;
    action: MapRecordAction;
    matchedUrl?: string | null;
    workMonth?: string | null;
    dueDate?: string | null;
    draftUrl?: string | null;
    liveUrl?: string | null;
}

export interface ContentBoardGroup {
    key: string;
    label: string;
    workMonth: string | null;
    records: ContentBoardRecord[];
}

export function clientReviewHref(clientId: string): string {
    return `/workspace/${encodeURIComponent(clientId)}?tab=approvals`;
}

export function topicMapHref(clientId: string): string {
    return `/workspace/${encodeURIComponent(clientId)}?tab=topical-map`;
}

/** The agency works on Pacific time, so "this month" flips at midnight in Los Angeles for everyone. */
export const CONTENT_TIME_ZONE = 'America/Los_Angeles';

export function currentWorkMonth(now = new Date(), timeZone = CONTENT_TIME_ZONE): string {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(now);
    const year = parts.find(part => part.type === 'year')?.value ?? '';
    const month = parts.find(part => part.type === 'month')?.value ?? '';
    return `${year}-${month}`;
}

/** This month and the following months, plus any month already saved on a page. */
export function contentMonthChoices(
    todayMonth: string,
    extras: ReadonlyArray<string | null | undefined> = [],
    count = 12,
): string[] {
    const months = new Set<string>();
    const start = readWorkMonth(todayMonth);
    if (start) {
        let year = Number(start.slice(0, 4));
        let month = Number(start.slice(5, 7));
        for (let index = 0; index < count; index += 1) {
            months.add(`${year}-${String(month).padStart(2, '0')}`);
            month += 1;
            if (month === 13) {
                month = 1;
                year += 1;
            }
        }
    }
    for (const extra of extras) {
        const month = readWorkMonth(extra);
        if (month) months.add(month);
    }
    return [...months].sort();
}

function compareRecords(left: ContentBoardRecord, right: ContentBoardRecord): number {
    const leftDue = readIsoDay(left.dueDate);
    const rightDue = readIsoDay(right.dueDate);
    if (leftDue && rightDue && leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
    if (leftDue && !rightDue) return -1;
    if (!leftDue && rightDue) return 1;
    return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
}

/** Approved pages only. Unscheduled pages come first, then months in order. */
export function groupApprovedContent(records: ReadonlyArray<ContentBoardRecord>): ContentBoardGroup[] {
    const buckets = new Map<string, ContentBoardRecord[]>();
    for (const record of records) {
        if (record.status !== 'approved') continue;
        const month = readWorkMonth(record.workMonth);
        const key = month ?? 'unscheduled';
        const list = buckets.get(key);
        if (list) list.push(record);
        else buckets.set(key, [record]);
    }

    const groups: ContentBoardGroup[] = [];
    const unscheduled = buckets.get('unscheduled');
    if (unscheduled) {
        groups.push({
            key: 'unscheduled',
            label: UNSCHEDULED_LABEL,
            workMonth: null,
            records: [...unscheduled].sort(compareRecords),
        });
    }
    for (const month of [...buckets.keys()].filter(key => key !== 'unscheduled').sort()) {
        groups.push({
            key: month,
            label: workMonthLabel(month) ?? month,
            workMonth: month,
            records: [...(buckets.get(month) ?? [])].sort(compareRecords),
        });
    }
    return groups;
}

export function boardProductionStatus(record: ContentBoardRecord): ProductionStatus {
    return displayedProductionStatus({
        status: record.status,
        productionStatus: record.productionStatus,
        action: record.action,
        matchedUrl: record.matchedUrl,
    });
}

export function asContentBoardRecord(record: TopicalMapRecord): ContentBoardRecord {
    return {
        id: record.id,
        title: record.title,
        status: record.status,
        productionStatus: record.productionStatus,
        action: record.action,
        matchedUrl: record.matchedUrl,
        workMonth: record.workMonth,
        dueDate: record.dueDate,
        draftUrl: record.draftUrl,
        liveUrl: record.liveUrl,
    };
}
