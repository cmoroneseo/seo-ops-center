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

export interface TimeLogCommentInput {
    description: string | null;
    /** The linked task's title, used to recognize a description that is not a note. */
    taskTitle: string | null;
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

    return note
        .split(/\r?\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => `<div>${escapeHtml(line)}</div>`)
        .join('');
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
