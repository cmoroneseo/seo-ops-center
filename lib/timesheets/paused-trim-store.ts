import {
    closedTimerTime, readTrimSnapshot, rewriteTrimSegments, sourceForPause, trimAuditColumns, updateTrimSnapshot,
    withTrimReservation, type TimerTrimSnapshot,
} from '../bots/timer-trim.ts';
import type { createAdminClient } from '../supabase/admin.ts';
import type { PausedTrimLog, PausedTrimSave } from './paused-trim-route.ts';

type Db = ReturnType<typeof createAdminClient>;

export async function loadPausedTrim(db: Db, timer: TimerTrimSnapshot, createdAt: string): Promise<PausedTrimLog | null> {
    const row = await readTrimSnapshot(db, timer);
    if (!row) return null;
    const time = closedTimerTime(timer.elapsedSeconds, row.time_log_segments);
    return {
        ...timer,
        ...time,
        trimmedAt: row.trimmed_at,
        previousSource: row.paused_trim_source,
        pausedAt: time.stretches.at(-1)?.endedAt ?? createdAt,
        source: sourceForPause(row.paused_trim_source, time.stretches) ?? undefined,
        segments: row.time_log_segments,
    };
}

export async function savePausedTrim(db: Db, log: PausedTrimLog, input: PausedTrimSave): Promise<boolean> {
    const saved = await withTrimReservation(db, log, {
        trimmed_at: log.trimmedAt, paused_trim_source: log.previousSource,
    }, input.source, input.audit.at, async editId => {
        if (!await rewriteTrimSegments(db, log, log.segments, input.time.stretches, 'shrink')) return false;
        const { data, error } = await updateTrimSnapshot(db, log, log.trimmedAt, editId, {
            hours: input.hours,
            elapsed_seconds: input.elapsedSeconds,
            description: input.description,
            ...trimAuditColumns(input.audit),
        }).select('id').maybeSingle();
        if (error) throw error;
        if (!data) return false;
        return await rewriteTrimSegments(db, log, log.segments, input.time.stretches, 'grow');
    });
    return saved === true;
}
