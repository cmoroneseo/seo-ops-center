import type { Task } from '../types.ts';

/**
 * Human labels for task status.
 *
 * Exists because the raw enum is not presentable and derived casing gets it
 * wrong: `capitalize` over `todo` renders "Todo", which shipped in the planner
 * panel one line below a dropdown correctly reading "To Do". Statuses are
 * named in at least four places in this codebase; anything rendering one
 * should reach for this rather than transform the enum.
 */
export const TASK_STATUS_LABELS: Record<Task['status'], string> = {
    todo: 'To Do',
    in_progress: 'In Progress',
    review: 'Review',
    approved: 'Approved',
    blocked: 'Blocked',
    done: 'Done',
};

/** The label for a status, falling back to the raw value rather than blank. */
export function taskStatusLabel(status: string): string {
    return TASK_STATUS_LABELS[status as Task['status']] ?? status;
}
