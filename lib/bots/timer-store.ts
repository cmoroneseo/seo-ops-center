import type { createAdminClient } from '../supabase/admin.ts';
import {
    botStretchSegmentId,
    closedRunningMs,
    type BotTimerDaySlice,
    type BotTimerStretch,
    type BotTimerTime,
    type BotTimerTrimAudit,
} from './timer.ts';

export const BOT_TIMER_STRETCHES = 'time_log_segments!time_log_segments_time_log_id_fkey(started_at, ended_at, note)';

export interface BotTimerSnapshot {
    id: string;
    organizationId: string;
    botKeyId: string;
    startedAt: string | null;
    elapsedSeconds?: number;
    trimmedAt?: string | null;
}

export interface PausedTrimSource extends BotTimerTime {
    pausedAt: string;
}

export function closedTimerTime(row: Record<string, unknown>): BotTimerTime {
    const rows = Array.isArray(row.time_log_segments) ? row.time_log_segments : [];
    const stretches = rows.flatMap(item => {
        if (!item || typeof item !== 'object') return [];
        const { started_at, ended_at, note } = item as Record<string, unknown>;
        if (typeof started_at !== 'string' || typeof ended_at !== 'string') return [];
        return [{ startedAt: started_at, endedAt: ended_at, note: typeof note === 'string' && note.trim() ? note : null }];
    }).sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
    return { stretches, carriedSeconds: carriedSecondsOf(row, stretches) };
}

function carriedSecondsOf(row: Record<string, unknown>, stretches: BotTimerStretch[]): number {
    // Paused rows store the rounded total. Any seconds the segments do not
    // cover are legacy carry, including all time on rows with no segments.
    const elapsed = Number(row.elapsed_seconds);
    if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
    return Math.max(0, Math.round(elapsed) - Math.round(closedRunningMs(stretches) / 1000));
}

export function trimAuditColumns(audit: BotTimerTrimAudit) {
    return {
        trimmed_from_seconds: audit.fromSeconds,
        trimmed_at: audit.at,
        trimmed_by: audit.userId,
        trimmed_by_bot_key_id: audit.botKeyId,
    };
}

export function stretchColumns(stretch: BotTimerStretch) {
    return { started_at: stretch.startedAt, ended_at: stretch.endedAt, note: stretch.note };
}

export function writeBotTimer(
    db: ReturnType<typeof createAdminClient>,
    timer: BotTimerSnapshot,
    patch: Record<string, unknown>,
    stretches: readonly BotTimerStretch[],
    extraDays: readonly BotTimerDaySlice[] = [],
) {
    return db.rpc('write_bot_timer', {
        p_id: timer.id,
        p_organization_id: timer.organizationId,
        p_bot_key_id: timer.botKeyId,
        p_expected_status: timer.startedAt ? 'in_progress' : 'paused',
        p_expected_started_at: timer.startedAt,
        p_expected_elapsed_seconds: timer.elapsedSeconds ?? 0,
        p_expected_trimmed_at: timer.trimmedAt ?? null,
        p_patch: patch,
        p_stretches: stretches.map(stretch => ({
            id: botStretchSegmentId(timer.id, stretch.startedAt),
            ...stretchColumns(stretch),
        })),
        p_extra_days: extraDays,
    });
}
