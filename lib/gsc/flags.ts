/** Server flags. Both default off, so a deploy on Supabase Free does not ingest new grains. */

export function gscHistoryV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.GSC_HISTORY_V2_ENABLED === 'true';
}

/** 486-day window and v2_backfill jobs. Independent of daily v2 ingest. */
export function gscHistoryV2BackfillEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.GSC_HISTORY_V2_BACKFILL_ENABLED === 'true';
}
