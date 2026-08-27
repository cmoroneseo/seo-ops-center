/**
 * Logging a scheduled task block as time worked.
 *
 * The workflow this serves: someone blocks out 3:15–6:00 PM for a task, works
 * it, and wants that session on the ledger — without closing the to-do, because
 * they intend to pick it back up tomorrow.
 *
 * That was possible but badly placed. The planner panel could turn a block into
 * time in one click for calendar EVENTS only; a task block offered a timer or a
 * link out to the task modal, where the duration already shown on screen had to
 * be retyped. Marking the task done also offered to log time, which quietly
 * made "record my hours" and "finish this work" the same gesture. They are not.
 *
 * Pure: no Supabase, no React.
 */

/** "2h 45m", "45m", "3h" — never "0m" for a real block. */
export function formatBlockDuration(minutes: number): string {
    const total = Math.max(0, Math.round(minutes));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (hours && rest) return `${hours}h ${rest}m`;
    if (hours) return `${hours}h`;
    return `${rest}m`;
}

/**
 * Read a duration the way people actually type one.
 *
 * Accepts "2h 45m", "2h", "45m", "2:45", "2.75" and bare "165". A plain number
 * is read as HOURS, matching the task modal's existing "Log time manually"
 * field, so the same "2.75" means the same thing in both places.
 *
 * Returns whole minutes, or null when the text is not a duration at all.
 */
export function parseDurationInput(input: string): number | null {
    const text = input.trim().toLowerCase();
    if (!text) return null;

    const clock = text.match(/^(\d+):([0-5]\d)$/);
    if (clock) return Number(clock[1]) * 60 + Number(clock[2]);

    const parts = text.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?$/);
    if (parts && (parts[1] || parts[2])) {
        const minutes = (Number(parts[1] ?? 0) * 60) + Number(parts[2] ?? 0);
        return minutes > 0 ? Math.round(minutes) : null;
    }

    if (/^\d+(\.\d+)?$/.test(text)) {
        const minutes = Math.round(Number(text) * 60);
        return minutes > 0 ? minutes : null;
    }
    return null;
}

/** Minutes -> the decimal hours the ledger stores, at two places. */
export function hoursFromMinutes(minutes: number): number {
    return Math.round((minutes / 60) * 100) / 100;
}

export interface TaskBlockLogDraft {
    minutes: number;
    /** What was worked on. Falls back to the task title. */
    note: string;
    countsTowardBudget: boolean;
}

export interface TaskBlockLogContext {
    organizationId: string;
    userId?: string;
    taskId: string;
    clientId: string;
    taskTitle: string;
    /** The block's own date, not today — a block is often logged after the fact. */
    date: string;
    /** When the block was scheduled to start. */
    plannedStartsAt: string;
    /** The SCHEDULED length, not the length logged. */
    plannedMinutes: number;
}

/**
 * The ledger row for a worked block.
 *
 * `countsTowardBudget` is carried from the draft rather than derived. Real
 * reviewed timesheets show the same activity billing for one client and not
 * another, so this stays the person's explicit choice — but unlike a meeting,
 * task work DEFAULTS to counting, because that is what delivery work is.
 *
 * Notably absent: any task status. Logging time says nothing about whether the
 * work is finished.
 */
export function taskBlockLogInput(context: TaskBlockLogContext, draft: TaskBlockLogDraft) {
    const note = draft.note.trim();
    return {
        organizationId: context.organizationId,
        userId: context.userId,
        clientId: context.clientId,
        taskId: context.taskId,
        date: context.date,
        hours: hoursFromMinutes(draft.minutes),
        description: note || context.taskTitle,
        billable: true,
        countsTowardBudget: draft.countsTowardBudget,
        // The forecast this log answers. Two jobs: it gives the entry a place
        // on the calendar, and it tells the planner this block's plan has been
        // worked, so the forecast is replaced by evidence rather than doubled.
        // Deliberately the SCHEDULED length — logging 2h against a 2h45m block
        // still consumes that block.
        plannedStartsAt: context.plannedStartsAt,
        plannedMinutes: context.plannedMinutes,
    };
}
