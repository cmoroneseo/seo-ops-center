import type { TimeLogImportStatus } from '../types.ts';

/**
 * Inbound Basecamp Timesheet::Entry import.
 *
 * Basecamp does not sign webhooks and supports no custom headers, so the
 * delivery is only ever a *notification*: it tells us which recording changed
 * and nothing more. Every field we persist is read back from the authenticated
 * Basecamp API. The webhook payload contributes exactly two things — the entry
 * id and the project it lives in — and both are cross-checked against the
 * canonical recording URL before use.
 *
 * Deduplication is anchored on `basecamp_entry_id`, which carries a partial
 * unique index (migration 038). Webhook retries, reconciliation sweeps, and
 * SEO PM -> Basecamp echoes therefore all collapse onto one ledger row.
 */

const TIMESHEET_ENTRY_KIND_PREFIX = 'timesheet_entry_';
const RECORDING_PATH =
    /^\/(\d+)\/buckets\/(\d+)\/timesheet_entries\/(\d+)\.json$/;

/** Canonical Basecamp entry state, already normalized. */
export interface ProviderTimesheetEntry {
    id: string;
    /** yyyy-MM-dd */
    date: string;
    hours: number;
    description: string;
    updatedAt: string;
    /** The Basecamp project (bucket) the entry lives in. */
    bucketId: string;
    /** The recording the entry hangs off: a to-do, or the project timesheet. */
    parentId: string;
    parentType: string;
    /** The Basecamp person the time belongs to. */
    creatorId: string;
}

export interface ImportedEntryInput {
    basecampEntryId: string;
    basecampProjectId: string;
    basecampRecordingId: string;
    organizationId: string;
    /** null only when we refuse to guess — paired with `needs_context`. */
    clientId: string | null;
    taskId: string | null;
    userId: string | null;
    date: string;
    hours: number;
    description: string;
    importStatus: TimeLogImportStatus;
    providerUpdatedAt: string;
    importedAt: string;
    /**
     * CSV identity, when the provider entry id is unknown. Null for webhook
     * imports, which always carry a real entry id.
     */
    importFingerprint: string | null;
}

export interface TimesheetImportStore {
    /** Which client (and org) owns this Basecamp project, if any. */
    findClientForProject(
        projectId: string,
    ): Promise<{ organizationId: string; clientId: string } | null>;
    /** Which org member is this Basecamp person, if we know them. */
    findMemberForPerson(
        organizationId: string,
        personId: string,
    ): Promise<{ userId: string } | null>;
    /** Which SEO PM task is this Basecamp to-do, if it is one we pushed. */
    findTaskForTodo(
        organizationId: string,
        todoId: string,
    ): Promise<{ taskId: string; clientId: string | null } | null>;
    upsertImportedEntry(input: ImportedEntryInput): Promise<'created' | 'updated'>;
    voidImportedEntry(entryId: string, at: string): Promise<'voided' | 'absent'>;
}

export interface TimesheetImportDependencies {
    expectedAccountId: string;
    now(): string;
    provider: {
        isConfigured(): boolean;
        /**
         * 'missing' means the provider confirmed the entry is gone (void it).
         * 'unavailable' means we could not ask (retry) — the two must never be
         * conflated, or an outage would erase real time.
         */
        getTimesheetEntry(
            projectId: string,
            entryId: string,
        ): Promise<ProviderTimesheetEntry | 'missing' | 'unavailable'>;
    };
    store: TimesheetImportStore;
}

export interface TimesheetDelivery {
    kind: string;
    recordingId: string;
    recordingUrl: string;
}

export interface TimesheetImportOutcome {
    status: number;
    /** Recorded on the delivery receipt for operator forensics. */
    result: string;
    body: unknown;
}

export function isTimesheetEntryKind(kind: string): boolean {
    return kind.startsWith(TIMESHEET_ENTRY_KIND_PREFIX)
        && kind.length > TIMESHEET_ENTRY_KIND_PREFIX.length;
}

/**
 * Accept only the exact canonical shape Basecamp emits for a timesheet entry
 * in the account we are configured for. Anything else is a provenance failure.
 */
export function parseTimesheetRecordingUrl(
    recordingUrl: string,
    accountId: string,
): { projectId: string; entryId: string } | null {
    if (!accountId) return null;
    try {
        const url = new URL(recordingUrl);
        if (url.protocol !== 'https:' || url.hostname !== '3.basecampapi.com') return null;
        const match = RECORDING_PATH.exec(url.pathname);
        if (!match || match[1] !== accountId) return null;
        return { projectId: match[2], entryId: match[3] };
    } catch {
        return null;
    }
}

export function createTimesheetEntryImporter(dependencies: TimesheetImportDependencies) {
    return async function importTimesheetEntry(
        delivery: TimesheetDelivery,
    ): Promise<TimesheetImportOutcome> {
        const canonical = parseTimesheetRecordingUrl(
            delivery.recordingUrl,
            dependencies.expectedAccountId,
        );
        if (!canonical || canonical.entryId !== delivery.recordingId) {
            return {
                status: 403,
                result: 'rejected:provenance-mismatch',
                body: { error: 'Basecamp delivery provenance mismatch' },
            };
        }

        if (!dependencies.provider.isConfigured()) {
            return {
                status: 503,
                result: 'retry:provider-unavailable',
                body: { error: 'Basecamp provider verification unavailable' },
            };
        }

        const entry = await dependencies.provider.getTimesheetEntry(
            canonical.projectId,
            canonical.entryId,
        );

        if (entry === 'unavailable') {
            return {
                status: 503,
                result: 'retry:provider-unavailable',
                body: { error: 'Basecamp provider verification unavailable' },
            };
        }

        // Verified gone at the provider. Keep the financial history; mark it void.
        if (entry === 'missing') {
            const voided = await dependencies.store.voidImportedEntry(
                canonical.entryId,
                dependencies.now(),
            );
            return voided === 'voided'
                ? { status: 200, result: 'voided', body: { ok: true, action: 'voided' } }
                : { status: 200, result: 'skipped:not-imported', body: { ok: true, skipped: 'not imported' } };
        }

        if (entry.id !== canonical.entryId || entry.bucketId !== canonical.projectId) {
            return {
                status: 403,
                result: 'rejected:provenance-mismatch',
                body: { error: 'Basecamp delivery provenance mismatch' },
            };
        }

        const client = await dependencies.store.findClientForProject(entry.bucketId);
        if (!client) {
            // A project we do not track is not our time. Refusing to invent a
            // client is the whole point — this is not an exception queue item.
            return {
                status: 200,
                result: 'skipped:unmapped-project',
                body: { ok: true, skipped: 'unmapped project' },
            };
        }

        const member = await dependencies.store.findMemberForPerson(
            client.organizationId,
            entry.creatorId,
        );

        const isTodoParent = entry.parentType === 'Todo';
        const task = isTodoParent
            ? await dependencies.store.findTaskForTodo(client.organizationId, entry.parentId)
            : null;

        // Anything we could not resolve from trusted state becomes a review
        // item. We never fall back to "probably this client/task/person".
        const unresolved = !member || (isTodoParent && !task);
        const importStatus: TimeLogImportStatus = unresolved ? 'needs_context' : 'mapped';

        const action = await dependencies.store.upsertImportedEntry({
            basecampEntryId: entry.id,
            basecampProjectId: entry.bucketId,
            basecampRecordingId: entry.parentId,
            organizationId: client.organizationId,
            clientId: task?.clientId ?? client.clientId,
            taskId: task?.taskId ?? null,
            userId: member?.userId ?? null,
            date: entry.date,
            hours: entry.hours,
            description: entry.description,
            importStatus,
            providerUpdatedAt: entry.updatedAt,
            importedAt: dependencies.now(),
            importFingerprint: null,
        });

        return {
            status: 200,
            result: action,
            body: { ok: true, action, entryId: entry.id, importStatus },
        };
    };
}
