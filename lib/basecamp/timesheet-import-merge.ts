import type { ImportedEntryInput } from './timesheet-webhook-route.ts';
import type { TimeLogImportStatus, TimeLogSource } from '../types.ts';

/**
 * How a verified provider entry merges onto an existing ledger row.
 *
 * The rule is **an import may add attribution, never remove it.** Two cases
 * make this necessary:
 *
 *   * an SEO PM entry pushed to Basecamp comes straight back as a webhook. It
 *     already has the right client, task, and person. If the Basecamp person
 *     happens to be unmapped, a naive overwrite would blank all three and file
 *     our own entry as an exception.
 *   * a manager resolves an unmapped import by hand. The next provider edit
 *     must not undo that decision.
 *
 * Provider-owned facts (date, hours, provenance) always win — those are exactly
 * what Basecamp is authoritative for. The description is the exception: once a
 * member has supplied context through review it is ours, not Basecamp's, and
 * the same rule applies — an import may add context, never remove it.
 */

export interface ExistingLedgerRow {
    source: TimeLogSource;
    importStatus: TimeLogImportStatus;
    clientId: string | null;
    taskId: string | null;
    userId: string | null;
    activityKeys: string[];
    /** What the row says now. Member-supplied when `activityKeys` is non-empty. */
    description: string | null;
    importFingerprint: string | null;
    /** Stamped by a webhook adoption; the CSV backfill never supplies one. */
    basecampEntryId: number | null;
}

export interface MergedLedgerRow {
    organization_id: string;
    client_id: string | null;
    task_id: string | null;
    user_id: string | null;
    date: string;
    hours: number;
    description: string;
    status: 'logged';
    source: TimeLogSource;
    import_status: TimeLogImportStatus;
    activity_keys: string[];
    import_fingerprint: string | null;
    basecamp_entry_id: number | null;
    basecamp_project_id: number | null;
    basecamp_recording_id: number | null;
    basecamp_synced_at: string;
    basecamp_sync_error: null;
    imported_at: string;
    provider_updated_at: string | null;
    voided_at: null;
}

/** Statuses a provider update must never move a row away from. */
const MEMBER_OWNED: TimeLogImportStatus[] = ['pending_review', 'mapped'];

function numberOrNull(value: string): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function mergeImportedEntry(
    existing: ExistingLedgerRow | null,
    incoming: ImportedEntryInput,
): MergedLedgerRow {
    // Attribution is kept if we already had it; only filled in if we did not.
    const clientId = existing?.clientId ?? incoming.clientId;
    const taskId = existing?.taskId ?? incoming.taskId;
    const userId = existing?.userId ?? incoming.userId;
    // Only ever set by a human via review; an import never supplies one.
    const activityKeys = existing?.activityKeys ?? [];
    const hasActivity = activityKeys.length > 0;
    // Review writes the member's context into `description` (describeActivity),
    // and having at least one activity is the marker that it did. Basecamp is authoritative
    // for descriptions only until a member has put context there — after that a
    // provider edit (13 of 14 arrive empty) would silently blank an approved
    // row while it keeps counting toward budget.
    // An empty stored description holds no context to protect, so the provider
    // value is still an addition rather than a removal.
    const description = (hasActivity && existing?.description)
        ? existing.description
        : incoming.description;

    // A row is only unresolved if it is *still* unresolved after the merge.
    // A native row is resolved by construction and never enters review.
    const source: TimeLogSource = existing?.source ?? 'basecamp';
    const entryId = numberOrNull(incoming.basecampEntryId);

    // A member has already acted on these; a provider edit is not allowed to
    // undo that and send the row back to the queue.
    const importStatus: TimeLogImportStatus =
        existing && MEMBER_OWNED.includes(existing.importStatus)
            ? existing.importStatus
            : source === 'seo_pm'
                ? 'mapped'
                // Merely having a Basecamp entry id proves nothing about whether
                // the entry has context: resolved attribution AND an activity
                // still don't guarantee a description, and most webhook rows
                // arrive with an empty one. Imported time must pass through
                // context capture before it counts toward budget.
                : (userId && clientId && hasActivity) ? 'mapped' : 'needs_context';

    return {
        organization_id: incoming.organizationId,
        client_id: clientId,
        task_id: taskId,
        user_id: userId,
        date: incoming.date,
        hours: incoming.hours,
        description,
        status: 'logged',
        source,
        import_status: importStatus,
        activity_keys: activityKeys,
        // Adoption: keep whichever identity we already had, add the new one.
        // Both identity columns follow the same rule, and the entry id needs it
        // just as much: the CSV backfill is documented as safe to re-run, and it
        // passes an empty `basecampEntryId`. Overwriting unconditionally would
        // blank the id a webhook had stamped on, undoing the adoption — and the
        // next delivery would then miss the row and insert a duplicate.
        import_fingerprint: existing?.importFingerprint ?? incoming.importFingerprint,
        basecamp_entry_id: entryId ?? existing?.basecampEntryId ?? null,
        basecamp_project_id: numberOrNull(incoming.basecampProjectId),
        basecamp_recording_id: numberOrNull(incoming.basecampRecordingId),
        basecamp_synced_at: incoming.importedAt,
        basecamp_sync_error: null,
        imported_at: incoming.importedAt,
        provider_updated_at: incoming.providerUpdatedAt || null,
        // The provider confirmed it exists, so any earlier void is stale.
        voided_at: null,
    };
}
