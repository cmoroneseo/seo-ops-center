/**
 * Coalesce a burst of plan edits into one push.
 * Create and drag call the server directly. The side panel and the plan
 * editor call this so title, due, and assignee edits wait about two seconds.
 */

import { PLAN_BASECAMP_PUSH_DEBOUNCE_MS } from './basecamp-push';

export interface PlanPushQueue {
    queue(taskId: string): void;
    /** Drop a pending push. Used when the editor unmounts. */
    cancel(taskId: string): void;
}

export function createPlanBasecampPushQueue(options: {
    delayMs?: number;
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
    push: (taskId: string) => void;
}): PlanPushQueue {
    const delayMs = options.delayMs ?? PLAN_BASECAMP_PUSH_DEBOUNCE_MS;
    const pending = new Map<string, unknown>();
    return {
        queue(taskId: string) {
            const existing = pending.get(taskId);
            if (existing != null) options.clearTimer(existing);
            const handle = options.setTimer(() => {
                pending.delete(taskId);
                options.push(taskId);
            }, delayMs);
            pending.set(taskId, handle);
        },
        cancel(taskId: string) {
            const existing = pending.get(taskId);
            if (existing == null) return;
            options.clearTimer(existing);
            pending.delete(taskId);
        },
    };
}

const browserQueue = createPlanBasecampPushQueue({
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    push: taskId => {
        void fetch('/api/seo-plan/basecamp-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId }),
        });
    },
});

/** Schedule the shared push. A second edit inside the window replaces the first. */
export function queuePlanBasecampPush(taskId: string): void {
    browserQueue.queue(taskId);
}
