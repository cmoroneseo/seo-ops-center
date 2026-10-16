/**
 * Per-entry "Send to Basecamp" decision.
 *
 * Hours stay in SEO Ops unless the client both opted into timesheet sync and
 * has a Basecamp project. The master sync flag is part of that check because
 * the timesheet route skips the push without it — a default of on that cannot
 * land would look like the entry never left. An explicit false is this
 * entry's opt-out and wins over the client default.
 */
export interface BasecampTimesheetClientFields {
    basecamp_timesheet_enabled?: unknown;
    basecamp_project_id?: unknown;
    basecamp_sync_enabled?: unknown;
}

export function clientBasecampTimesheetEnabled(
    fields: BasecampTimesheetClientFields | null | undefined,
): boolean {
    if (!fields) return false;
    return Boolean(
        fields.basecamp_timesheet_enabled
        && fields.basecamp_project_id
        && fields.basecamp_sync_enabled,
    );
}

/**
 * `userOverride` is the toggle for this entry. False keeps the hours local
 * even when the client normally syncs. True does not invent a destination
 * for a client that is not set up.
 */
export function defaultSendToBasecamp(
    clientEligible: boolean,
    userOverride?: boolean,
): boolean {
    if (userOverride === false) return false;
    return clientEligible;
}
