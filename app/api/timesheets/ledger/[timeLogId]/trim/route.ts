import { getAuthenticatedActor } from '@/lib/security/tenant-authz';
import { createAdminClient } from '@/lib/supabase/admin';
import { createPausedTrimPatch } from '@/lib/timesheets/paused-trim-route';
import { loadPausedTrim, savePausedTrim } from '@/lib/timesheets/paused-trim-store';

export const dynamic = 'force-dynamic';

const trim = createPausedTrimPatch({
    authenticate: getAuthenticatedActor,
    async findLog(id) {
        const { data, error } = await createAdminClient().from('time_logs')
            .select('id, organization_id, bot_key_id, user_id, status, timer_started_at, elapsed_seconds, description, created_at')
            .eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return {
            id: data.id,
            organizationId: data.organization_id,
            botKeyId: data.bot_key_id,
            userId: data.user_id,
            status: data.status,
            startedAt: data.timer_started_at,
            elapsedSeconds: data.elapsed_seconds,
            description: data.description,
            createdAt: data.created_at,
        };
    },
    async membership(organizationId, userId) {
        const { data, error } = await createAdminClient().from('organization_members')
            .select('role').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle();
        if (error) throw error;
        return data?.role ?? null;
    },
    loadTime: log => loadPausedTrim(createAdminClient(), log, log.createdAt),
    save: (log, input) => savePausedTrim(createAdminClient(), log, input),
    now: () => new Date(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ timeLogId: string }> }) {
    return trim(request, (await params).timeLogId);
}
