import { csvIdentityFor, type ProviderTimesheetEntry } from './timesheet-webhook-route.ts';

/**
 * Stamp the CSV fingerprint onto a time log SEO PM just pushed to Basecamp.
 *
 * The CSV report carries no entry ids, so the backfill recognizes an entry it
 * already has only by fingerprint. The webhook echo of our own push normally
 * stamps one — but only for projects that have the webhook and map to a client.
 * Internal projects (the SEO HQ check-ins) never echo, so those rows had no
 * fingerprint and every CSV import over their dates added a duplicate. An edit
 * made here (date, hours) also left an echo-stamped fingerprint stale.
 *
 * So the push reads its own entry back and stamps the identity itself, after
 * every successful create or update. Best effort: the hours are already in
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
