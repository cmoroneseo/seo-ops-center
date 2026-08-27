/**
 * What happened when a newly created task was pushed to Basecamp.
 *
 * The push is a separate call from creating the task, and it fails far more
 * often than it looks: only a minority of clients have a Basecamp project
 * bound at all, so `409 Task has no authorized Basecamp project` is the
 * ordinary case, not an edge case. Every other caller in this codebase treats
 * the push as fire-and-forget, which is defensible when the user never asked
 * for it — but the import queue offers "create the task" as the feature, so
 * swallowing the result would tell someone their to-do reached Basecamp when
 * it never did.
 */

export type PushOutcome =
    | 'pushed'
    | 'no_project'
    | 'forbidden'
    | 'not_configured'
    | 'failed';

/** Human wording for the row. `pushed` needs no message. */
export const PUSH_OUTCOME_MESSAGE: Record<Exclude<PushOutcome, 'pushed'>, string> = {
    no_project: 'Task created. Not sent to Basecamp — this client has no Basecamp project linked.',
    forbidden: 'Task created. Not sent to Basecamp — you do not have permission to push to it.',
    not_configured: 'Task created. Not sent to Basecamp — the Basecamp integration is not configured.',
    failed: 'Task created. Sending it to Basecamp failed.',
};

/**
 * Map the push endpoint's reply to an outcome.
 *
 * `status` is null when the request never completed (offline, aborted): the
 * task still exists, so that is a push failure rather than a task failure.
 */
export function pushOutcomeFor(
    status: number | null,
    body: { success?: boolean; error?: string; configured?: boolean } | null,
): PushOutcome {
    if (status === null) return 'failed';
    if (status === 403) return 'forbidden';
    if (status === 503 || body?.configured === false) return 'not_configured';
    // 409 covers both "no authorized Basecamp project" and a link/config
    // mismatch. Both mean the same thing to the person reading the row: it
    // did not reach Basecamp, and the reason is configuration.
    if (status === 409) return 'no_project';
    if (status >= 200 && status < 300 && body?.success !== false) return 'pushed';
    return 'failed';
}
