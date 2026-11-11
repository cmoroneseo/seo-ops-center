import type { MapRecordAction, MapRecordStatus, ProductionStatus, TopicalMapRecord } from '../types';
import {
    displayedProductionStatus,
    readHttpUrl,
    readIsoDay,
    readWorkMonth,
    workMonthLabel,
} from '../topical-map/production';
import { contentPlanLimit, countsTowardPlan } from './quota';

export const UNSCHEDULED_LABEL = 'Unscheduled';

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
    /** The topic group (silo) name shown in the Topic group column. */
    topicGroup?: string | null;
    updatedAt?: string | null;
}

export interface ContentBoardGroup {
    key: string;
    label: string;
    workMonth: string | null;
    records: ContentBoardRecord[];
    /** Pages in this group that use up a piece of the monthly plan. */
    approved: number;
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

export function nextWorkMonth(month: string): string | null {
    const start = readWorkMonth(month);
    if (!start) return null;
    const year = Number(start.slice(0, 4));
    const next = Number(start.slice(5, 7)) + 1;
    return next === 13 ? `${year + 1}-01` : `${year}-${String(next).padStart(2, '0')}`;
}

/** "November" for 2026-11. The year is left off because the card already shows it. */
export function monthName(month: string | null | undefined): string {
    const label = workMonthLabel(month);
    return label ? label.split(' ')[0] : '';
}

/** This month and the following months, plus any month already saved on a page. */
export function contentMonthChoices(
    todayMonth: string,
    extras: ReadonlyArray<string | null | undefined> = [],
    count = 12,
): string[] {
    const months = new Set<string>();
    let cursor = readWorkMonth(todayMonth);
    for (let index = 0; cursor && index < count; index += 1) {
        months.add(cursor);
        cursor = nextWorkMonth(cursor);
    }
    for (const extra of extras) {
        const month = readWorkMonth(extra);
        if (month) months.add(month);
    }
    return [...months].sort();
}

export function boardProductionStatus(record: ContentBoardRecord): ProductionStatus {
    return displayedProductionStatus({
        status: record.status,
        productionStatus: record.productionStatus,
        action: record.action,
        matchedUrl: record.matchedUrl,
    });
}

/** Board copy. Short, plain words a client understands. Every pill also has an icon. */
export const BOARD_STATUS_LABEL: Record<ProductionStatus, string> = {
    not_written: 'Not written',
    awaiting_approval: 'Awaiting approval',
    approved: 'Approved',
    writing: 'Writing',
    client_review: 'Client review',
    ready: 'Ready',
    published: 'Published',
    already_live: 'Already live',
    declined: 'Declined',
    failed: 'Could not publish',
};

export type BoardFilter = 'all' | 'decision' | 'in_progress' | 'done';

export const BOARD_FILTERS: ReadonlyArray<{ id: BoardFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'decision', label: 'Needs a decision' },
    { id: 'in_progress', label: 'In progress' },
    { id: 'done', label: 'Done' },
];

const FILTER_FOR_STATUS: Record<ProductionStatus, BoardFilter | null> = {
    not_written: 'decision',
    awaiting_approval: 'decision',
    approved: 'in_progress',
    writing: 'in_progress',
    client_review: 'in_progress',
    ready: 'in_progress',
    failed: 'in_progress',
    published: 'done',
    already_live: 'done',
    declined: null,
};

export function boardFilterFor(record: ContentBoardRecord): BoardFilter | null {
    return FILTER_FOR_STATUS[boardProductionStatus(record)];
}

export interface BoardView {
    filter: BoardFilter;
    /** A topic group name, or '' for all topic groups. */
    topicGroup: string;
    query: string;
}

export const DEFAULT_BOARD_VIEW: BoardView = { filter: 'all', topicGroup: '', query: '' };

export function filterBoardRecords(
    records: ReadonlyArray<ContentBoardRecord>,
    view: BoardView,
): ContentBoardRecord[] {
    const query = view.query.trim().toLocaleLowerCase();
    return records.filter(record => {
        if (view.filter !== 'all' && boardFilterFor(record) !== view.filter) return false;
        if (view.topicGroup && (record.topicGroup ?? '') !== view.topicGroup) return false;
        if (query && !record.title.toLocaleLowerCase().includes(query)) return false;
        return true;
    });
}

/** Topic group names that have at least one page, in a stable order. */
export function boardTopicGroups(records: ReadonlyArray<ContentBoardRecord>): string[] {
    const names = new Set<string>();
    for (const record of records) {
        const name = record.topicGroup?.trim();
        if (name) names.add(name);
    }
    return [...names].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function compareByDue(left: ContentBoardRecord, right: ContentBoardRecord): number {
    const leftDue = readIsoDay(left.dueDate);
    const rightDue = readIsoDay(right.dueDate);
    if (leftDue && rightDue && leftDue !== rightDue) return leftDue < rightDue ? -1 : 1;
    if (leftDue && !rightDue) return -1;
    if (!leftDue && rightDue) return 1;
    return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
}

const UNSCHEDULED_RANK: Record<BoardFilter | 'declined', number> = {
    decision: 0,
    in_progress: 1,
    all: 1,
    done: 2,
    declined: 3,
};

/** Pages waiting on a decision first, then work in progress, then done and declined pages. */
function compareUnscheduled(left: ContentBoardRecord, right: ContentBoardRecord): number {
    const rank = (record: ContentBoardRecord) => UNSCHEDULED_RANK[boardFilterFor(record) ?? 'declined'];
    return rank(left) - rank(right) || compareByDue(left, right);
}

/**
 * Every page on the topic map. One group per month in order, then a final
 * Unscheduled group for pages with no month yet.
 */
export function groupBoardContent(records: ReadonlyArray<ContentBoardRecord>): ContentBoardGroup[] {
    const buckets = new Map<string, ContentBoardRecord[]>();
    const unscheduled: ContentBoardRecord[] = [];
    for (const record of records) {
        const month = readWorkMonth(record.workMonth);
        if (!month) {
            unscheduled.push(record);
            continue;
        }
        const list = buckets.get(month);
        if (list) list.push(record);
        else buckets.set(month, [record]);
    }

    const groups: ContentBoardGroup[] = [...buckets.keys()].sort().map(month => {
        const list = [...(buckets.get(month) ?? [])].sort(compareByDue);
        return {
            key: month,
            label: workMonthLabel(month) ?? month,
            workMonth: month,
            records: list,
            approved: list.filter(countsTowardPlan).length,
        };
    });
    if (unscheduled.length > 0) {
        groups.push({
            key: 'unscheduled',
            label: UNSCHEDULED_LABEL,
            workMonth: null,
            records: unscheduled.sort(compareUnscheduled),
            approved: unscheduled.filter(countsTowardPlan).length,
        });
    }
    return groups;
}

function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** "7 pages · 6 approved". Unscheduled leaves off "0 approved". */
export function groupCountLabel(group: ContentBoardGroup): string {
    const pages = plural(group.records.length, 'page', 'pages');
    if (group.workMonth || group.approved > 0) return `${pages} · ${group.approved} approved`;
    return pages;
}

export interface MonthPlan {
    month: string;
    nextMonth: string;
    approved: number;
    nextApproved: number;
    /** Pieces in the client's monthly plan. Null when no plan is saved. */
    limit: number | null;
    over: number;
    left: number;
}

export function monthPlan(
    records: ReadonlyArray<ContentBoardRecord>,
    contentPieces: number | null | undefined,
    month: string,
): MonthPlan {
    const current = readWorkMonth(month) ?? month;
    const next = nextWorkMonth(current) ?? current;
    const count = (target: string) => records.filter(record =>
        countsTowardPlan(record) && readWorkMonth(record.workMonth) === target,
    ).length;
    const limit = contentPlanLimit(contentPieces);
    const approved = count(current);
    return {
        month: current,
        nextMonth: next,
        approved,
        nextApproved: count(next),
        limit,
        over: limit == null ? 0 : Math.max(0, approved - limit),
        left: limit == null ? 0 : Math.max(0, limit - approved),
    };
}

export function planHeadline(plan: MonthPlan): string {
    return `${plan.approved} of ${plan.limit ?? 0} content pieces approved for ${monthName(plan.month)}`;
}

export function overPlanHeadline(plan: MonthPlan): string {
    return `${plan.approved} of ${plan.limit ?? 0} approved: ${plan.over} over this month's plan`;
}

export function overPlanDetail(plan: MonthPlan): string {
    const extra = plan.over === 1
        ? 'the extra piece is added to this month'
        : 'the extra pieces are added to this month';
    return `Approving still works. Check with the client whether ${extra} or moved to ${monthName(plan.nextMonth)}.`;
}

export function piecesLabel(count: number): string {
    return plural(count, 'piece', 'pieces');
}

/**
 * Pages to move when the month is over plan: the most recently approved pages
 * that have not started yet. Pages already being written stay put.
 */
export function overPlanMoves(
    records: ReadonlyArray<ContentBoardRecord>,
    plan: MonthPlan,
): ContentBoardRecord[] {
    if (plan.over <= 0) return [];
    return records
        .filter(record =>
            readWorkMonth(record.workMonth) === plan.month
            && countsTowardPlan(record)
            && boardProductionStatus(record) === 'approved',
        )
        .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
        .slice(0, plan.over);
}

export type BoardLink =
    | { kind: 'approvals'; href: string; label: 'Review in Approvals' }
    | { kind: 'live'; href: string; label: 'View live page' }
    | { kind: 'draft'; href: string; label: 'Open draft' }
    | { kind: 'waiting'; label: 'Waiting on client' }
    | { kind: 'none'; label: 'No link yet' };

export function boardLink(record: ContentBoardRecord, clientId: string): BoardLink {
    const status = boardProductionStatus(record);
    if (status === 'client_review') return { kind: 'approvals', href: clientReviewHref(clientId), label: 'Review in Approvals' };
    if (status === 'awaiting_approval') return { kind: 'waiting', label: 'Waiting on client' };
    const live = readHttpUrl(record.liveUrl) ?? (status === 'already_live' ? readHttpUrl(record.matchedUrl) : null);
    const draft = readHttpUrl(record.draftUrl);
    if (live && (status === 'published' || status === 'already_live')) return { kind: 'live', href: live, label: 'View live page' };
    if (draft) return { kind: 'draft', href: draft, label: 'Open draft' };
    if (live) return { kind: 'live', href: live, label: 'View live page' };
    return { kind: 'none', label: 'No link yet' };
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 4". The year is added only when it is not the current year. */
export function shortDueDate(value: string | null | undefined, todayMonth: string): string | null {
    const iso = readIsoDay(value);
    if (!iso) return null;
    const label = `${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
    return iso.slice(0, 4) === todayMonth.slice(0, 4) ? label : `${label}, ${iso.slice(0, 4)}`;
}

export function asContentBoardRecord(record: TopicalMapRecord, topicGroup?: string | null): ContentBoardRecord {
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
        topicGroup: topicGroup ?? null,
        updatedAt: record.updatedAt,
    };
}
