import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildMappingUpdate, type MappingContext } from '@/lib/timesheets/mapping';
import { requireTimeLogIntegrationManager } from '@/lib/security/tenant-authz';

export const dynamic = 'force-dynamic';

/**
 * POST /api/timesheets/mapping
 * Body: { timeLogId, clientId, taskId?, userId }
 *
 * Resolves one `needs_context` imported entry to an explicit client/task/member.
 * Manager-only. Every referenced record is re-read server-side and checked
 * against the actor's organization before the write.
 */
export async function POST(req: NextRequest) {
    let body: unknown;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const input = (body ?? {}) as Record<string, unknown>;
    const timeLogId = typeof input.timeLogId === 'string' ? input.timeLogId : '';
    const clientId = typeof input.clientId === 'string' ? input.clientId : '';
    const taskId = typeof input.taskId === 'string' && input.taskId ? input.taskId : null;
    const userId = typeof input.userId === 'string' ? input.userId : '';

    const manager = await requireTimeLogIntegrationManager(timeLogId);
    if (!manager.ok) {
        return NextResponse.json({ error: manager.error }, { status: manager.status });
    }

    const admin = createAdminClient();
    const [log, client, task, member] = await Promise.all([
        admin.from('time_logs')
            .select('id, organization_id, import_status, source')
            .eq('id', timeLogId)
            .maybeSingle(),
        clientId
            ? admin.from('clients').select('id, organization_id').eq('id', clientId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        taskId
            ? admin.from('tasks').select('id, organization_id, client_id').eq('id', taskId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        userId
            ? admin.from('organization_members')
                .select('user_id, organization_id')
                .eq('user_id', userId)
                .eq('organization_id', manager.organizationId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ]);

    if (log.error || client.error || task.error || member.error) {
        return NextResponse.json({ error: 'Unable to verify mapping targets' }, { status: 500 });
    }
    if (!log.data) {
        return NextResponse.json({ error: 'Time log not found' }, { status: 404 });
    }

    const context: MappingContext = {
        organizationId: manager.organizationId,
        actorUserId: manager.userId,
        now: new Date().toISOString(),
        log: {
            id: log.data.id,
            organizationId: log.data.organization_id,
            importStatus: log.data.import_status,
            source: log.data.source,
        },
        client: client.data
            ? { id: client.data.id, organizationId: client.data.organization_id }
            : null,
        task: task.data
            ? {
                id: task.data.id,
                organizationId: task.data.organization_id,
                clientId: task.data.client_id ?? null,
            }
            : null,
        member: member.data
            ? { userId: member.data.user_id, organizationId: member.data.organization_id }
            : null,
    };

    const result = buildMappingUpdate(context, { timeLogId, clientId, taskId, userId });
    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { error } = await admin
        .from('time_logs')
        .update(result.patch)
        .eq('id', timeLogId)
        // Losing a race against a concurrent mapping must not overwrite it.
        .eq('import_status', 'needs_context');
    if (error) {
        return NextResponse.json({ error: 'Unable to save mapping' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, timeLogId, importStatus: 'mapped' });
}
