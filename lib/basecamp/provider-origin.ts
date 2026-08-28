/**
 * Whether a time log may be CREATED at the provider.
 *
 * The hazard this closes: an entry imported FROM Basecamp already exists
 * there, but the CSV import records only a fingerprint — not the provider's
 * entry id. So the sync path, which decides create-vs-update purely on
 * `basecampEntryId`, would see no id, take the create branch, and add a second
 * timesheet entry beside the original. The client's hours would double and a
 * comment would be posted for work recorded weeks earlier.
 *
 * Nothing reaches that path today, which is luck rather than design: imported
 * rows carry `basecamp_synced_at` from the import, so the UI reads them as
 * synced and offers no push. One new caller that pushes by id would be enough.
 *
 * The rule is simply: work that ORIGINATED at the provider is never created
 * there again. Updating is fine — that needs an entry id, which proves we know
 * which record we are touching.
 */

export interface ProviderOriginLog {
    /** 'seo_pm' for work created here; 'basecamp' for imported work. */
    source?: string | null;
    /** Set by every import path, including those that never learn an entry id. */
    importFingerprint?: string | null;
    basecampEntryId?: string | number | null;
}

export type ProviderCreateRefusal = 'imported-entry-not-identified';

/** True when this log came from the provider rather than being authored here. */
export function isProviderOriginated(log: ProviderOriginLog): boolean {
    if (log.source && log.source !== 'seo_pm') return true;
    return Boolean(log.importFingerprint);
}

/**
 * Null when a create is allowed, otherwise why it is refused.
 *
 * A provider-originated log WITH an entry id is fine: it will take the update
 * branch and never reach a create.
 */
export function refuseProviderCreate(log: ProviderOriginLog): ProviderCreateRefusal | null {
    if (log.basecampEntryId) return null;
    return isProviderOriginated(log) ? 'imported-entry-not-identified' : null;
}

export const PROVIDER_CREATE_REFUSAL_MESSAGE: Record<ProviderCreateRefusal, string> = {
    'imported-entry-not-identified':
        'This time was imported from Basecamp and already exists there. '
        + 'Sending it again would duplicate the entry.',
};
