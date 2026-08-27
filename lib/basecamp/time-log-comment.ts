/**
 * The comment a logged time entry leaves on its Basecamp to-do.
 *
 * A timesheet entry records that hours happened; it does not say what was
 * done. The to-do showed "2.75 hr" and nothing else, so the note the person
 * wrote in SEO PM — "Van Electrical System Planning Checklist blog post" —
 * never reached the people reading the to-do.
 *
 * Pure: no provider calls.
 */

const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Basecamp comments are rich text, so the note is HTML.
 *
 * Escaped rather than interpolated: the note is whatever a person typed, and
 * an unescaped `<` would at best break the comment and at worst inject markup
 * into someone else's project.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** "2026-08-26" -> "Aug 26". Parsed by parts: a Date would shift the day. */
export function formatLogDate(date: string): string {
    const match = date.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return date.slice(0, 10);
    const month = MONTHS[Number(match[2]) - 1];
    return month ? `${month} ${Number(match[3])}` : date.slice(0, 10);
}

function formatHours(hours: number): string {
    const rounded = Math.round(hours * 100) / 100;
    return `${rounded}h`;
}

export interface TimeLogCommentInput {
    description: string | null;
    /** The linked task's title, used to recognize a description that is not a note. */
    taskTitle: string | null;
    hours: number;
    date: string;
    /** Who logged it, when known. */
    actorName?: string | null;
}

/**
 * The comment body, or null when there is nothing worth saying.
 *
 * Returns null when the description merely repeats the task title. The ledger
 * falls back to the title when someone logs time without writing a note, so
 * commenting unconditionally would post a to-do's own title back onto it —
 * noise on every single log.
 */
export function timeLogCommentBody(input: TimeLogCommentInput): string | null {
    const note = (input.description ?? '').trim();
    if (!note) return null;
    if (input.taskTitle && note === input.taskTitle.trim()) return null;

    const meta = [formatHours(input.hours), formatLogDate(input.date)];
    if (input.actorName?.trim()) meta.push(input.actorName.trim());

    return `<div>${escapeHtml(note)}</div>`
        + `<div><em>${escapeHtml(meta.join(' · '))}</em></div>`;
}

export interface CommentTarget {
    taskBasecampTodoId: string | number | null;
    taskBasecampProjectId: string | number | null;
}

/**
 * The to-do a time log's comment belongs on, or null when there isn't one.
 *
 * Guarded on the project matching because a task carrying a to-do from a
 * DIFFERENT Basecamp project must never have a comment posted into the project
 * this sync was authorized against — that is how one client's note lands in
 * another client's to-do.
 */
export function commentTargetFor(log: CommentTarget, authorizedProjectId: string): string | null {
    const todoId = normalizeId(log.taskBasecampTodoId);
    if (!todoId) return null;
    return normalizeId(log.taskBasecampProjectId) === normalizeId(authorizedProjectId)
        ? todoId
        : null;
}

function normalizeId(value: string | number | null): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value).trim();
    return /^\d+$/.test(text) ? text : null;
}
