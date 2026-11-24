import { BOT_TIMER_STRETCHES, closedTimerTime, trimAuditColumns, writeBotTimer, type PausedTrimSource } from '@/lib/bots/timer-store';
import { getAuthenticatedActor } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPausedTrimPatch } from '@/lib/timesheets/paused-trim-route';

export const dynamic = 'force-dynamic';

const trim = createPausedTrimPatch({
    authenticate: getAuthenticatedActor,
    async findLog(id) {
        const { data, error } = await createAdminClient().from('time_logs')
            .select(`id, organization_id, bot_key_id, status, timer_started_at, elapsed_seconds, created_at, trimmed_at, paused_trim_source, ${BOT_TIMER_STRETCHES}`)
            .eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        const time = closedTimerTime(data);
        return {
            ...time,
            id: data.id,
            organizationId: data.organization_id,
            botKeyId: data.bot_key_id,
            status: data.status,
            startedAt: data.timer_started_at,
            elapsedSeconds: data.elapsed_seconds,
            trimmedAt: data.trimmed_at,
            pausedAt: time.stretches[time.stretches.length - 1]?.endedAt ?? data.created_at,
            source: (data.paused_trim_source as PausedTrimSource | null) ?? undefined,
        };
    },
    async membership(organizationId, userId) {
        const { data, error } = await createAdminClient().from('organization_members')
            .select('role').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle();
        if (error) throw error;
        return data?.role ?? null;
    },
    async save(log, input) {
        const { data, error } = await writeBotTimer(createAdminClient(), log, {
            hours: input.hours,
            elapsed_seconds: input.elapsedSeconds,
            description: input.description,
            trimmed_description: input.description,
            paused_trim_source: input.source,
            ...trimAuditColumns(input.audit),
        }, input.time.stretches);
        if (error) throw error;
        return Boolean(data?.length);
    },
    now: () => new Date(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ timeLogId: string }> }) {
    return trim(request, (await params).timeLogId);
}
