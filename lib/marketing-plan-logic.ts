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
