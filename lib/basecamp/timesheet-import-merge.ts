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
    basecamp_entry_id: number;
    basecamp_project_id: number;
    basecamp_recording_id: number;
    basecamp_synced_at: string;
    basecamp_sync_error: null;
    imported_at: string;
    provider_updated_at: string | null;
    voided_at: null;
}

export function mergeImportedEntry(
    existing: ExistingLedgerRow | null,
    incoming: ImportedEntryInput,
): MergedLedgerRow {
    // Attribution is kept if we already had it; only filled in if we did not.
    const clientId = existing?.clientId ?? incoming.clientId;
    const taskId = existing?.taskId ?? incoming.taskId;
    const userId = existing?.userId ?? incoming.userId;

    // A row is only unresolved if it is *still* unresolved after the merge.
    // A native row is resolved by construction and never enters review.
    const source: TimeLogSource = existing?.source ?? 'basecamp';
    const importStatus: TimeLogImportStatus = source === 'seo_pm'
        ? 'mapped'
        : (userId && clientId) ? 'mapped' : incoming.importStatus;

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
        import_status: importStatus === 'voided' ? 'mapped' : importStatus,
        basecamp_entry_id: Number(incoming.basecampEntryId),
        basecamp_project_id: Number(incoming.basecampProjectId),
        basecamp_recording_id: Number(incoming.basecampRecordingId),
        basecamp_synced_at: incoming.importedAt,
        basecamp_sync_error: null,
        imported_at: incoming.importedAt,
        provider_updated_at: incoming.providerUpdatedAt || null,
        // The provider confirmed it exists, so any earlier void is stale.
        voided_at: null,
    };
}
