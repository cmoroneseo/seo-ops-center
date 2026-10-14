/** Loading, filled, and the page skeleton share this box. 4.125rem is the border plus py-3 plus one 40px control. */
export const AGREEMENT_SUMMARY_ROW_CLASS = 'flex h-[4.125rem] items-center justify-between gap-6 overflow-hidden border-y border-border py-3';

export type AgreementSummaryPhase = 'loading' | 'hidden' | 'ready';

/**
 * The row stays mounted for the whole fetch. A history array that is already
 * in memory must not collapse the slot before `available` is known.
 */
export function agreementSummaryPhase(loading: boolean, available: boolean, error: string | null): AgreementSummaryPhase {
    if (loading && !available) return 'loading';
    if (!available && !error) return 'hidden';
    return 'ready';
}
