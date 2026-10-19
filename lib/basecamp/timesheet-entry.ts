import { fingerprintFor } from './timesheet-csv.ts';

/**
 * Canonical Basecamp timesheet entry, already normalized.
 *
 * The outbound push reads an entry back after create or update and stamps
 * `csvIdentityFor` onto the SEO Ops time log. That is the same identity
 * `fingerprintFor` computes from a CSV row, so a pushed row matches previously
 * imported rows and the comparison report.
 */
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
    /**
     * The Basecamp person the time belongs to — `person`, falling back to
     * `creator`. Not the account that happened to make the API call: SEO Ops'
     * own push sets `person` to the member while `creator` is the single shared
     * OAuth account, so keying on `creator` would misattribute every teammate's
     * synced row to one person.
     */
    creatorId: string;
    /** Display name of that same person. Empty when Basecamp omits it. */
    personName: string;
    /** Display name of the project (bucket). Empty when Basecamp omits it. */
    bucketName: string;
    /** ISO instant the entry was created — ms precision from the API. */
    createdAt: string;
}

/**
 * The CSV identity for a provider entry, computed through `fingerprintFor`.
 *
 * Returns null unless every field the hash needs is present. `import_fingerprint`
 * carries a unique index, so hashing a shape with blanks in it would let two
 * unrelated entries land on one identity.
 */
export function csvIdentityFor(entry: ProviderTimesheetEntry): string | null {
    if (!entry.personName || !entry.bucketName || !entry.date || !entry.createdAt) {
        return null;
    }
    return fingerprintFor({
        person: entry.personName,
        projectName: entry.bucketName,
        date: entry.date,
        // A number on both sides: the CSV parses `"2.0"` and so does the API
        // reader, so `String(hours)` spells them the same way.
        hours: entry.hours,
        created: entry.createdAt,
    });
}
