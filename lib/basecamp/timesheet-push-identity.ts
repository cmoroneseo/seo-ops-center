import { csvIdentityFor, type ProviderTimesheetEntry } from './timesheet-entry.ts';

/**
 * Stamp the CSV fingerprint onto a time log SEO Ops just pushed to Basecamp.
 *
 * The CSV report carries no entry ids. Comparison against that report, and any
 * row imported before inbound import stopped, recognizes an entry by
 * fingerprint. The push reads its own entry back and stamps the identity
 * itself, after every successful create or update, including edits that would
 * otherwise leave the stamp stale. Best effort: the hours are already in
 * Basecamp, so a failure here must never turn a good sync into an error.
 */

export type PushIdentityOutcome = 'stamped' | 'unavailable' | 'conflict' | 'failed';

export interface PushIdentityDependencies {
    readEntry(projectId: string, entryId: string): Promise<ProviderTimesheetEntry | 'missing' | 'unavailable'>;
    /** Resolves to the Postgres error code, or null on success. */
    writeFingerprint(fingerprint: string): Promise<string | null>;
}

export async function stampPushedEntryIdentity(
    dependencies: PushIdentityDependencies,
    projectId: string,
    entryId: string,
): Promise<PushIdentityOutcome> {
    try {
        const entry = await dependencies.readEntry(projectId, entryId);
        if (entry === 'missing' || entry === 'unavailable') return 'unavailable';

        const fingerprint = csvIdentityFor(entry);
        if (!fingerprint) return 'unavailable';

        const code = await dependencies.writeFingerprint(fingerprint);
        if (code === null) return 'stamped';
        // Another row already holds this identity: a CSV import that ran
        // before we could stamp. Leave both visible rather than guess which
        // one to keep.
        return code === '23505' ? 'conflict' : 'failed';
    } catch (error) {
        console.error('[Basecamp timesheet] identity stamp failed:', error);
        return 'failed';
    }
}
