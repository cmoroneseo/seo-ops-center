import type {
    MarketingPlanItem, MarketingPlanStep,
    MarketingPlanItemPriority, MarketingPlanItemStatus,
} from './types';

export interface PlanSummary {
    total: number;
    done: number;
    todo: number;
    ignored: number;
    progressPercent: number;
    priorityCounts: { high: number; medium: number; low: number };
}

export function computePlanSummary(items: MarketingPlanItem[]): PlanSummary {
    const total = items.length;
    const done = items.filter(i => i.status === 'done').length;
    const ignored = items.filter(i => i.status === 'ignored').length;
    const todo = total - done - ignored;
    const denominator = total - ignored;
    const progressPercent = denominator === 0 ? 0 : Math.round((done / denominator) * 100);
    const active = items.filter(i => i.status !== 'ignored');
    const priorityCounts = {
        high: active.filter(i => i.priority === 'high').length,
        medium: active.filter(i => i.priority === 'medium').length,
        low: active.filter(i => i.priority === 'low').length,
    };
    return { total, done, todo, ignored, progressPercent, priorityCounts };
}

export type GroupMode = 'step' | 'priority' | 'status';

export interface ItemGroup {
    key: string;
    label: string;
    items: MarketingPlanItem[];
}

const PRIORITY_ORDER: { key: MarketingPlanItemPriority; label: string }[] = [
    { key: 'high', label: 'High' },
    { key: 'medium', label: 'Medium' },
    { key: 'low', label: 'Low' },
];

const STATUS_ORDER: { key: MarketingPlanItemStatus; label: string }[] = [
    { key: 'todo', label: 'To Do' },
    { key: 'done', label: 'Done' },
    { key: 'ignored', label: 'Ignored' },
];

export function groupItems(
    items: MarketingPlanItem[],
    steps: MarketingPlanStep[],
    mode: GroupMode,
): ItemGroup[] {
    const bySort = (a: MarketingPlanItem, b: MarketingPlanItem) => a.sortOrder - b.sortOrder;

    if (mode === 'step') {
        return [...steps]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map(s => ({
                key: s.key,
                label: s.name,
                items: items.filter(i => i.stepKey === s.key).sort(bySort),
            }));
    }
    if (mode === 'priority') {
        return PRIORITY_ORDER
            .map(p => ({
                key: p.key,
                label: p.label,
                items: items.filter(i => i.priority === p.key).sort(bySort),
            }))
            .filter(g => g.items.length > 0);
    }
    return STATUS_ORDER
        .map(s => ({
            key: s.key,
            label: s.label,
            items: items.filter(i => i.status === s.key).sort(bySort),
        }))
        .filter(g => g.items.length > 0);
}

export function filterItems(items: MarketingPlanItem[], query: string): MarketingPlanItem[] {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(i =>
        i.title.toLowerCase().includes(q) ||
        (i.description ?? '').toLowerCase().includes(q),
    );
}

// ---------------------------------------------------------------------------
// Task generation + checklist sync
// ---------------------------------------------------------------------------

/**
 * Task statuses that count as checklist-complete. `approved` is terminal in
 * the task model, same as `done` for "is this work still open?" counts.
 * Kept in lockstep with migration 059 (`new.status in ('done', 'approved')`).
 */
export const TASK_STATUSES_THAT_COMPLETE_CHECKLIST = ['done', 'approved'] as const;

export function taskCompletesChecklist(taskStatus: string): boolean {
    return (TASK_STATUSES_THAT_COMPLETE_CHECKLIST as readonly string[]).includes(taskStatus);
}

/**
 * Item status to write after a linked task's status changes.
 * Returns null when the item should be left alone (already in the target
 * state, or `ignored` — ignore is an explicit skip and is never overwritten).
 */
export function nextChecklistStatusForTask(
    itemStatus: MarketingPlanItemStatus,
    taskStatus: string,
): MarketingPlanItemStatus | null {
    if (itemStatus === 'ignored') return null;
    if (taskCompletesChecklist(taskStatus)) {
        return itemStatus === 'done' ? null : 'done';
    }
    return itemStatus === 'done' ? 'todo' : null;
}

/** To-do items that do not already have a linked task. Order is preserved. */
export function itemsEligibleForTaskGeneration(items: MarketingPlanItem[]): MarketingPlanItem[] {
    return items.filter(item => item.status === 'todo' && !item.taskId);
}

/** Fields copied onto a real Task. Priority, assignee, and due date pass through. */
export function taskFieldsFromPlanItem(item: MarketingPlanItem): {
    organizationId: string;
    clientId: string;
    title: string;
    description?: string;
    priority: MarketingPlanItemPriority;
    assigneeIds?: string[];
    dueDate?: string;
} {
    return {
        organizationId: item.organizationId,
        clientId: item.clientId,
        title: item.title,
        ...(item.description ? { description: item.description } : {}),
        priority: item.priority,
        ...(item.assigneeId ? { assigneeIds: [item.assigneeId] } : {}),
        ...(item.dueDate ? { dueDate: item.dueDate } : {}),
    };
}

export interface ChecklistTogglePlan {
    /** `task` writes tasks.status and lets migration 059 update the item.
     *  `item` writes the checklist row only. */
    write: 'item' | 'task';
    status: 'todo' | 'done';
}

/**
 * Safest checkbox behavior for v1.
 *
 * - No linked task: toggle the item only (unchanged from the original checklist).
 * - Checking a linked item: mark the task `done`. The database trigger checks
 *   the item, so a failed task update leaves the checklist untouched. This
 *   does not open the time-reconciliation sheet.
 * - Unchecking a linked item: reopen the task to `todo` only when that task
 *   is `done` or `approved`. A task already in progress, review, or blocked
 *   is left alone and only the item is unchecked — a manual check from before
 *   sync existed must not rewind real work. A missing task row unchecks the item.
 */
export function checklistTogglePlan(input: {
    itemStatus: MarketingPlanItemStatus;
    taskId?: string;
    /** Required when unchecking a linked item. null means the task row is gone. */
    taskStatus?: string | null;
}): ChecklistTogglePlan {
    const next = input.itemStatus === 'done' ? 'todo' : 'done';
    if (!input.taskId) return { write: 'item', status: next };
    if (next === 'done') return { write: 'task', status: 'done' };
    if (input.taskStatus == null) return { write: 'item', status: 'todo' };
    if (taskCompletesChecklist(input.taskStatus)) return { write: 'task', status: 'todo' };
    return { write: 'item', status: 'todo' };
}

// ---------------------------------------------------------------------------
// Report fulfillment — step vs engagement month
// ---------------------------------------------------------------------------

/**
 * How a Project Report SEO Plan block groups checklist progress.
 * Stored on the block as `props.planView`. Missing or unknown values are step.
 */
export type PlanReportView = 'step' | 'month';

export function readPlanReportView(value: unknown): PlanReportView {
    return value === 'month' ? 'month' : 'step';
}

export interface FulfillmentCounts {
    done: number;
    todo: number;
    ignored: number;
    /** Non-ignored items. Denominator of the "3/10" fraction. */
    total: number;
    progressPercent: number;
}

/** Ignored items are an explicit skip, so they stay out of the fraction and the percent. */
export function fulfillmentCounts(items: Pick<MarketingPlanItem, 'status'>[]): FulfillmentCounts {
    const ignored = items.filter(i => i.status === 'ignored').length;
    const done = items.filter(i => i.status === 'done').length;
    const todo = items.filter(i => i.status === 'todo').length;
    const total = done + todo;
    const progressPercent = total === 0 ? 0 : Math.round((done / total) * 100);
    return { done, todo, ignored, total, progressPercent };
}

export interface FulfillmentBucket {
    key: string;
    label: string;
    items: MarketingPlanItem[];
    done: number;
    total: number;
}

function toBucket(key: string, label: string, items: MarketingPlanItem[]): FulfillmentBucket {
    const counts = fulfillmentCounts(items);
    return { key, label, items, done: counts.done, total: counts.total };
}

/**
 * One bucket per plan step, in step order, including steps with no items.
 * Items whose step is not on the plan land in "Other" so they are not dropped.
 */
export function stepFulfillmentBuckets(
    items: MarketingPlanItem[],
    steps: MarketingPlanStep[],
): FulfillmentBucket[] {
    const sortedSteps = [...steps].sort((a, b) => a.sortOrder - b.sortOrder);
    const known = new Set(sortedSteps.map(s => s.key));
    const bySort = (a: MarketingPlanItem, b: MarketingPlanItem) => a.sortOrder - b.sortOrder;
    const buckets = sortedSteps.map((step, index) => toBucket(
        step.key,
        `Step ${index + 1}: ${step.name}`,
        items.filter(i => i.stepKey === step.key).sort(bySort),
    ));
    const orphans = items.filter(i => !known.has(i.stepKey)).sort(bySort);
    if (orphans.length > 0) buckets.push(toBucket('other', 'Other', orphans));
    return buckets;
}

/** Calendar month from a `YYYY-MM...` prefix. No timezone conversion. */
export function calendarYearMonth(value: string): { year: number; month: number } | null {
    const match = /^(\d{4})-(\d{2})/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return { year, month };
}

/**
 * Engagement month index. Month 1 is the anchor's calendar month.
 * 0 or negative means the due month is before the anchor. Null means unparseable.
 */
export function engagementMonthIndex(anchorDate: string, dueDate: string): number | null {
    const anchor = calendarYearMonth(anchorDate);
    const due = calendarYearMonth(dueDate);
    if (!anchor || !due) return null;
    return (due.year - anchor.year) * 12 + (due.month - anchor.month) + 1;
}

/**
 * Anchor for Month 1. Same clock the blog cadence uses (`launchDateOverride`,
 * then `launchDate`), then the plan's created timestamp when the client has
 * no launch date. This does not invent a schedule — it only names an origin.
 */
export function planEngagementAnchor(input: {
    launchDateOverride?: string | null;
    launchDate?: string | null;
    planCreatedAt?: string | null;
}): string | null {
    for (const candidate of [input.launchDateOverride, input.launchDate, input.planCreatedAt]) {
        if (candidate && calendarYearMonth(candidate)) return candidate;
    }
    return null;
}

/**
 * Date that places an item in an engagement month.
 * The checklist due date wins. A linked task's due date is used only when the
 * item itself has none (the task is the live copy after generation).
 */
export function schedulingDateForItem(
    item: Pick<MarketingPlanItem, 'dueDate' | 'taskId'>,
    taskDueDates?: Readonly<Record<string, string | null | undefined>>,
): string | null {
    const own = item.dueDate?.trim();
    if (own) return own;
    if (!item.taskId || !taskDueDates) return null;
    const linked = taskDueDates[item.taskId]?.trim();
    return linked || null;
}

export interface MonthFulfillmentOptions {
    /** Null when no engagement origin exists — every item is Unscheduled. */
    anchorDate: string | null;
    taskDueDates?: Readonly<Record<string, string | null | undefined>>;
}

/**
 * Groups items into Month 1, Month 2, … from the engagement anchor.
 * Empty months are omitted. Dated items before the anchor stay in "Before start".
 * Items with no usable date (or no anchor) stay in "Unscheduled". Neither is dropped.
 */
export function monthFulfillmentBuckets(
    items: MarketingPlanItem[],
    options: MonthFulfillmentOptions,
): FulfillmentBucket[] {
    const byMonth = new Map<number, MarketingPlanItem[]>();
    const before: MarketingPlanItem[] = [];
    const unscheduled: MarketingPlanItem[] = [];

    for (const item of items) {
        const due = schedulingDateForItem(item, options.taskDueDates);
        const index = due && options.anchorDate ? engagementMonthIndex(options.anchorDate, due) : null;
        if (index == null) unscheduled.push(item);
        else if (index < 1) before.push(item);
        else {
            const list = byMonth.get(index) ?? [];
            list.push(item);
            byMonth.set(index, list);
        }
    }

    const bySchedule = (a: MarketingPlanItem, b: MarketingPlanItem) => {
        const ad = schedulingDateForItem(a, options.taskDueDates) ?? '';
        const bd = schedulingDateForItem(b, options.taskDueDates) ?? '';
        if (ad !== bd) return ad < bd ? -1 : 1;
        return a.sortOrder - b.sortOrder;
    };

    const buckets: FulfillmentBucket[] = [];
    if (before.length > 0) buckets.push(toBucket('before', 'Before start', [...before].sort(bySchedule)));
    for (const index of [...byMonth.keys()].sort((a, b) => a - b)) {
        buckets.push(toBucket(`month-${index}`, `Month ${index}`, [...byMonth.get(index)!].sort(bySchedule)));
    }
    if (unscheduled.length > 0) {
        buckets.push(toBucket(
            'unscheduled',
            'Unscheduled',
            [...unscheduled].sort((a, b) => a.sortOrder - b.sortOrder),
        ));
    }
    return buckets;
}

export function planFulfillmentBuckets(
    items: MarketingPlanItem[],
    steps: MarketingPlanStep[],
    view: PlanReportView,
    monthOptions: MonthFulfillmentOptions,
): FulfillmentBucket[] {
    return view === 'month'
        ? monthFulfillmentBuckets(items, monthOptions)
        : stepFulfillmentBuckets(items, steps);
}
