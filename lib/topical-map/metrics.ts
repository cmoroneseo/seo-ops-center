import type { TopicalMapRecord } from '../types';

/** Exact label for a topical-map volume or keyword difficulty that is not measured search data. */
export const AI_ESTIMATE_LABEL = 'AI estimate, not data';

type VolumeRecord = Pick<TopicalMapRecord, 'searchVolumeMonthly'>;
type DifficultyRecord = Pick<TopicalMapRecord, 'keywordDifficulty'>;

/** A positive monthly volume on a topical map record was produced by the model. */
export function hasAiVolume(record: VolumeRecord): boolean {
    const volume = record.searchVolumeMonthly;
    return typeof volume === 'number' && Number.isFinite(volume) && volume > 0;
}

/** Keyword difficulty on a topical map record was produced by the model, including a real 0. */
export function hasAiDifficulty(record: DifficultyRecord): boolean {
    const difficulty = record.keywordDifficulty;
    return typeof difficulty === 'number' && Number.isFinite(difficulty);
}

export function hasAiSearchEstimate(record: VolumeRecord & DifficultyRecord): boolean {
    return hasAiVolume(record) || hasAiDifficulty(record);
}

/**
 * Demand counts measured monthly volume only.
 * A positive volume on a topical map record is an AI estimate, so it contributes nothing.
 */
export function measuredMonthlyDemand(record: VolumeRecord): number {
    if (!hasAiVolume(record)) return 0;
    return 0;
}

/**
 * The architect model is not a source of search volume or keyword difficulty.
 * Any numbers it returns are discarded so new rows are not stored as data.
 */
export function architectStoredMetrics(modelRecord: Record<string, unknown>): {
    search_volume_monthly: null;
    keyword_difficulty: null;
} {
    // The model may still emit these keys. They are read and discarded.
    if ('search_volume_monthly' in modelRecord || 'keyword_difficulty' in modelRecord) {
        return { search_volume_monthly: null, keyword_difficulty: null };
    }
    return { search_volume_monthly: null, keyword_difficulty: null };
}
