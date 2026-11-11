/**
 * Verdict rules for a logged SEO change.
 *
 * The badge uses the longest checkpoint (7, 14, 28, 56 days) whose end date
 * is already final in Search Console and whose stored days cover at least
 * `minAfterCoverage`. Search Console's own history writer rejects dates newer
 * than 3 Pacific days, so this lag matches that.
 *
 * Daily rates are compared, so a 7-day window is not scored against a 28-day
 * total. Positive "helpful" means the metric moved the useful way. Average
 * position is lower-is-better. A rank change under `positionNoise` is noise.
 *
 * With a control, the page has to beat that control by `controlLift`
 * (10 percentage points of relative change: +25% vs +10% is a 15 point lift).
 * Without a control, the page itself has to move by `pageBand` (15%).
 * Low data still gets a verdict, marked as an estimate.
 */

export const CHECKPOINTS = [7, 14, 28, 56] as const;
export type CheckpointDays = (typeof CHECKPOINTS)[number];

export const BASELINE_DAYS = 28;
export const GSC_LAG_DAYS = 3;

export const VERDICT_THRESHOLDS = {
    /** Stored final days required in the 28-day baseline. */
    minBaselineDays: 21,
    /** Share of a checkpoint that must be stored and final. */
    minAfterCoverage: 0.8,
    /** Relative-rate lift over the control. 0.10 = 10 percentage points. */
    controlLift: 0.10,
    /** Page-only band when no control is available. */
    pageBand: 0.15,
    /** Average-position moves smaller than this are flat. */
    positionNoise: 1,
    /** Page impressions under this, in either window, are low data. */
    lowDataImpressions: 100,
    /** Clicks under this, in either window, are low data when clicks are the KPI. */
    lowDataClicks: 10,
    /** Organic sessions under this, in either window, are low data. */
    lowDataSessions: 30,
    /** Key events under this, in either window, are low data. */
    lowDataKeyEvents: 5,
} as const;

export const CAUSATION = 'Lines up with the change. Does not show the change caused it.';
