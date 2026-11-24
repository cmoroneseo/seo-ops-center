import { randomUUID } from 'node:crypto';
import {
    botStretchSegmentId,
    closedRunningMs,
    type BotTimerStretch,
    type BotTimerTime,
    type BotTimerTrimAudit,
} from './timer.ts';
import type { createAdminClient } from '../supabase/admin.ts';

type Db = ReturnType<typeof createAdminClient>;

const TRIM_SEGMENT_EMBED = 'time_log_segments!time_log_segments_time_log_id_fkey(id, started_at, ended_at, note)';
export const TRIM_NEEDS_DATABASE_UPDATE = 'Trim needs a database update.';

export interface StoredBotStretch {
    id: string;
    started_at: string;
    ended_at: string | null;
    note: string | null;
}

type RestorableStretch = BotTimerStretch & { segmentId?: string };

export interface PausedTrimSource extends BotTimerTime {
    stretches: RestorableStretch[];
    pausedAt: string;
    revision?: string;
    editId?: string;
    editExpiresAt?: string;
}

export interface TimerTrimSnapshot {
    id: string;
    organizationId: string;
    botKeyId: string;
    userId: string;
    status: string;
    startedAt: string | null;
    elapsedSeconds: number;
    description: string | null;
}

export function isMissingTrimColumn(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) return false;
    return error.code === '42703' || error.code === 'PGRST204';
}

export function trimAuditColumns(audit: BotTimerTrimAudit) {
    return {
        trimmed_from_seconds: audit.fromSeconds,
        trimmed_at: audit.at,
        trimmed_by: audit.userId,
        trimmed_by_bot_key_id: audit.botKeyId,
    };
}

export function closedTimerTime(elapsedSeconds: number, segments: readonly StoredBotStretch[]) {
    const stretches = segments.flatMap(({ id, started_at, ended_at, note }) => ended_at
        ? [{ segmentId: id, startedAt: started_at, endedAt: ended_at, note: note?.trim() ? note : null }]
        : []).sort((left, right) => Date.parse(left.startedAt) - Date.parse(right.startedAt));
    return {
        stretches,
        carriedSeconds: Math.max(0, elapsedSeconds - Math.round(closedRunningMs(stretches) / 1000)),
    };
}

/** A new closed stretch after the original pause means the bot resumed and paused again. */
export function sourceForPause(source: PausedTrimSource | null, stretches: BotTimerStretch[]) {
    return source && !stretches.some(stretch => Date.parse(stretch.startedAt) >= Date.parse(source.pausedAt))
        ? source
        : null;
}

interface StoredTrimSnapshot {
    description: string | null;
    trimmed_at: string | null;
    paused_trim_source: PausedTrimSource | null;
    time_log_segments: StoredBotStretch[];
}

export async function readTrimSnapshot(db: Db, timer: TimerTrimSnapshot): Promise<StoredTrimSnapshot | null> {
    let query = db.from('time_logs').select(
        `description, trimmed_at, trimmed_from_seconds, trimmed_by, trimmed_by_bot_key_id, paused_trim_source, ${TRIM_SEGMENT_EMBED}`,
    )
        .eq('id', timer.id).eq('organization_id', timer.organizationId).eq('bot_key_id', timer.botKeyId)
        .eq('status', timer.status).eq('elapsed_seconds', timer.elapsedSeconds);
    query = timer.startedAt ? query.eq('timer_started_at', timer.startedAt) : query.is('timer_started_at', null);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    const row = data as unknown as StoredTrimSnapshot | null;
    return row?.description === timer.description ? row : null;
}

export function updateTrimSnapshot(
    db: Db,
    timer: TimerTrimSnapshot,
    trimmedAt: string | null,
    editId: string | undefined,
    patch: Record<string, unknown>,
) {
    let query = db.from('time_logs').update(patch)
        .eq('id', timer.id).eq('organization_id', timer.organizationId).eq('bot_key_id', timer.botKeyId)
        .eq('status', timer.status).eq('elapsed_seconds', timer.elapsedSeconds);
    query = timer.startedAt ? query.eq('timer_started_at', timer.startedAt) : query.is('timer_started_at', null);
    query = trimmedAt == null ? query.is('trimmed_at', null) : query.eq('trimmed_at', trimmedAt);
    return editId ? query.eq('paused_trim_source->>editId', editId) : query.is('paused_trim_source->>editId', null);
}

/**
 * Serialize corrections to the same snapshot and keep the original stretches
 * through an interrupted edit. An abandoned reservation expires.
 */
export async function withTrimReservation<T>(
    db: Db,
    timer: TimerTrimSnapshot,
    stored: Pick<StoredTrimSnapshot, 'trimmed_at' | 'paused_trim_source'>,
    source: PausedTrimSource,
    at: string,
    write: (editId: string) => Promise<T>,
): Promise<T | null> {
    const previous = stored.paused_trim_source;
    if (previous?.editExpiresAt && Date.parse(previous.editExpiresAt) > Date.parse(at)) return null;
    const editId = randomUUID();
    const nextSource = { ...source, revision: editId };
    const reserved = { ...nextSource, editId, editExpiresAt: new Date(Date.parse(at) + 60_000).toISOString() };
    let claim = updateTrimSnapshot(db, timer, stored.trimmed_at, previous?.editId, { paused_trim_source: reserved });
    claim = previous?.revision
        ? claim.eq('paused_trim_source->>revision', previous.revision)
        : claim.is('paused_trim_source->>revision', null);
    const { data, error } = await claim.select('id').maybeSingle();
    if (error) throw error;
    if (!data) return null;

    try {
        return await write(editId);
    } finally {
        // A successful stop already clears the reservation in its final row
        // update. Release any outstanding reservation without restoring status.
        await db.from('time_logs').update({ paused_trim_source: nextSource })
            .eq('id', timer.id).eq('organization_id', timer.organizationId).eq('bot_key_id', timer.botKeyId)
            .eq('paused_trim_source->>editId', editId);
    }
}

export async function finalizeTrimmedBotTimer(
    db: Db,
    timer: TimerTrimSnapshot & { stretches: BotTimerStretch[]; pausedAt: string | null },
    patch: Record<string, unknown>,
    stretches: BotTimerStretch[],
    audit: BotTimerTrimAudit,
    columns: string,
): Promise<Record<string, unknown> | null> {
    const stored = await readTrimSnapshot(db, timer);
    if (!stored) return null;
    const observed = closedTimerTime(timer.elapsedSeconds, stored.time_log_segments);
    // A segment can change without advancing elapsed_seconds (rounded to a
    // second). Reject a target calculated from a different set of stretches.
    if (observed.stretches.length !== timer.stretches.length
        || observed.stretches.some((stretch, index) => {
            const expected = timer.stretches[index];
            return Date.parse(stretch.startedAt) !== Date.parse(expected.startedAt)
                || Date.parse(stretch.endedAt) !== Date.parse(expected.endedAt)
                || stretch.note !== expected.note;
        })) return null;

    const previous = sourceForPause(stored.paused_trim_source, observed.stretches);
    const source = {
        stretches: previous?.stretches ?? observed.stretches,
        carriedSeconds: previous?.carriedSeconds ?? observed.carriedSeconds,
        pausedAt: previous?.pausedAt ?? timer.pausedAt ?? timer.startedAt ?? audit.at,
    };
    return withTrimReservation(db, timer, stored, source, audit.at, async editId => {
        if (!await rewriteTrimSegments(db, timer, stored.time_log_segments, stretches, 'shrink')) return null;
        const { data, error } = await updateTrimSnapshot(db, timer, stored.trimmed_at, editId, {
            ...patch, ...trimAuditColumns(audit), paused_trim_source: null,
        }).select(columns).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        if (!await rewriteTrimSegments(db, timer, stored.time_log_segments, stretches, 'grow')) {
            throw new Error('Timer segments changed during trim');
        }
        return data as unknown as Record<string, unknown>;
    });
}

/**
 * Run reductions before saving the total and additions after. Match the row's
 * observed end on update/delete so one stale edit cannot replace another.
 */
export async function rewriteTrimSegments(
    db: Db,
    timer: Pick<TimerTrimSnapshot, 'id' | 'organizationId' | 'userId'>,
    segments: readonly StoredBotStretch[],
    stretches: readonly RestorableStretch[],
    phase: 'shrink' | 'grow',
): Promise<boolean> {
    const existing = new Map(segments.map(segment => [Date.parse(segment.started_at), segment]));
    const retained = new Map(stretches.map(stretch => [Date.parse(stretch.startedAt), stretch]));
    for (const segment of segments) {
        if (!segment.ended_at) continue;
        const kept = retained.get(Date.parse(segment.started_at));
        const end = Date.parse(segment.ended_at);
        const delta = kept ? Date.parse(kept.endedAt) - end : -Infinity;
        if (phase === 'shrink' ? delta >= 0 : delta <= 0) continue;
        const query = kept
            ? db.from('time_log_segments').update({ ended_at: kept.endedAt })
            : db.from('time_log_segments').delete();
        const { data, error } = await query.eq('time_log_id', timer.id)
            .eq('id', segment.id).eq('ended_at', segment.ended_at).select('id').maybeSingle();
        if (error) throw error;
        if (!data) return false;
    }
    if (phase === 'grow') {
        const additions = stretches.filter(stretch => !existing.has(Date.parse(stretch.startedAt)));
        if (additions.length > 0) {
            const { error } = await db.from('time_log_segments').upsert(additions.map(stretch => ({
                id: stretch.segmentId ?? botStretchSegmentId(timer.id, stretch.startedAt),
                time_log_id: timer.id,
                organization_id: timer.organizationId,
                user_id: timer.userId,
                started_at: stretch.startedAt,
                ended_at: stretch.endedAt,
                note: stretch.note,
            })), { onConflict: 'id', ignoreDuplicates: true });
            if (error) throw error;
        }
    }
    return true;
}
