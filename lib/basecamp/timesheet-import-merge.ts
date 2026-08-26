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
 * Provider-owned facts (date, hours, description, provenance) always win —
 * those are exactly what Basecamp is authoritative for.
 */

export interface ExistingLedgerRow {
    source: TimeLogSource;
    importStatus: TimeLogImportStatus;
    clientId: string | null;
    taskId: string | null;
    userId: string | null;
    activityKey: string | null;
    importFingerprint: string | null;
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
    activity_key: string | null;
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
    const activityKey = existing?.activityKey ?? null;

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
                : (userId && clientId && activityKey) ? 'mapped' : 'needs_context';

    return {
        organization_id: incoming.organizationId,
        client_id: clientId,
        task_id: taskId,
        user_id: userId,
        date: incoming.date,
        hours: incoming.hours,
        description: incoming.description,
        status: 'logged',
        source,
        import_status: importStatus,
        activity_key: activityKey,
        // Adoption: keep whichever identity we already had, add the new one.
        import_fingerprint: existing?.importFingerprint ?? incoming.importFingerprint,
        basecamp_entry_id: entryId,
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
