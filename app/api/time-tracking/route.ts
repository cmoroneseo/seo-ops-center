import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { POST as postBasecampTimesheet } from '@/app/api/integrations/basecamp/timesheet/route';
import { POST as postBasecampPush } from '@/app/api/integrations/basecamp/push/route';
import { createAdminClient } from '@/lib/supabase/admin';
import {
    completeFinalizedTask,
    handleTimerMutation,
    type AttemptRouteDeps,
    type CompletedTask,
    type FinalizeAttemptInput,
    type FinalizeResult,
} from '@/lib/timer/attempt-route';
import { timerStateFromRows } from '@/lib/timer/contracts';

export const dynamic = 'force-dynamic';

type RpcFinalizeRow = {
    time_log_id: string;
    task_id: string | null;
    client_id: string | null;
};

function dependencyError(message: string, code: string): Error & { code: string } {
    return Object.assign(new Error(message), { code });
}

export async function POST(request: NextRequest): Promise<Response> {
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                get(name: string) { return cookieStore.get(name)?.value; },
                set(name: string, value: string, options: CookieOptions) {
                    cookieStore.set({ name, value, ...options });
                },
                remove(name: string, options: CookieOptions) {
                    cookieStore.set({ name, value: '', ...options });
                },
            },
        },
    );

    let authenticatedUserId: string | null = null;
    let authenticatedActorName = 'Unknown';

    const finalizeOwnedAttempt = async (input: FinalizeAttemptInput): Promise<FinalizeResult> => {
        const { data, error } = await supabase.rpc('finalize_time_attempt', {
            p_time_log_id: input.timeLogId,
            p_description: input.description,
            p_billable: input.billable,
            p_counts_toward_budget: input.countsTowardBudget,
            p_time_zone: input.timeZone,
            p_operation_id: input.operationId,
            p_finalized_at: input.finalizedAt,
        });
        if (error) throw error;

        const rows = (data ?? []) as RpcFinalizeRow[];
        if (rows.length === 0) {
            throw dependencyError('Finalization returned no owned logs', '42501');
        }

        const finalizedTimeLogIds = rows.map(row => row.time_log_id);
        if (!input.markTaskComplete) return { finalizedTimeLogIds };

        const taskId = rows.find(row => row.task_id)?.task_id;
        if (!taskId) {
            return {
                finalizedTimeLogIds,
                completionWarning: 'Time was saved, but there is no task to complete.',
            };
        }

        const completionWarning = await completeFinalizedTask({
            taskId,
            userId: input.userId,
            actorName: authenticatedActorName,
            operationId: input.operationId,
            finalizedAt: input.finalizedAt,
        }, {
            async completeOwnedTask(ownedTaskId, finalizedAt): Promise<CompletedTask | null> {
                const { data: task, error: updateError } = await supabase
                    .from('tasks')
                    .update({ status: 'done', completed_at: finalizedAt })
                    .eq('id', ownedTaskId)
                    .select('id, organization_id, client_id, title, priority, category')
                    .maybeSingle();
                if (updateError) throw updateError;
                if (!task) return null;
                return {
                    id: task.id,
                    organizationId: task.organization_id,
                    clientId: task.client_id,
                    title: task.title,
                    priority: task.priority,
                    category: task.category,
                };
            },
            async emitTaskCompleted(task, completionInput) {
                const admin = createAdminClient();
                const { error: activityError } = await admin.from('client_activity_log').insert({
                    organization_id: task.organizationId,
                    client_id: task.clientId,
                    event_type: 'task.completed',
                    actor_id: completionInput.userId,
                    actor_name: completionInput.actorName,
                    operation_id: completionInput.operationId,
                    metadata: {
                        taskId: task.id,
                        title: task.title,
                        status: 'done',
                        priority: task.priority,
                        category: task.category,
                    },
                });
                if (activityError) throw activityError;
            },
            async syncBasecampTodoCompletion(task) {
                // Mirror updateTask's status->done push: check off the linked
                // Basecamp to-do through the protected push route, which
                // re-derives the project/todo from the task server-side. A task
                // with no to-do link answers 409 (nothing to sync).
                const protectedRequest = new NextRequest(
                    new URL('/api/integrations/basecamp/push', request.url),
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'complete_todo', taskId: task.id }),
                    },
                );
                const response = await postBasecampPush(protectedRequest);
                if (!response.ok && response.status !== 409) {
                    console.error('[Basecamp] to-do completion push failed:', response.status);
                }
            },
        });
        return {
            finalizedTimeLogIds,
            ...(completionWarning ? { completionWarning } : {}),
        };
    };

    const deps: AttemptRouteDeps = {
        async getUser() {
            const { data: { user }, error } = await supabase.auth.getUser();
            if (error || !user) return null;
            authenticatedUserId = user.id;
            authenticatedActorName = user.user_metadata?.full_name || user.email || 'Unknown';
            return { id: user.id };
        },
        async mutateRpc(name, args) {
            if (name === 'discard_time_attempt') {
                if (!authenticatedUserId) throw dependencyError('Authentication required', '42501');
                const { data: discarded, error: deleteError } = await supabase
                    .from('time_logs')
                    .delete()
                    .eq('id', String(args.p_time_log_id ?? ''))
                    .eq('user_id', authenticatedUserId)
                    .eq('status', 'in_progress')
                    .select('id')
                    .maybeSingle();
                if (deleteError) throw deleteError;
                if (!discarded) throw dependencyError('Owned in-progress time attempt not found', '42501');
                return null;
            }

            const { data, error } = await supabase.rpc(name, args);
            if (error) throw error;
            return data;
        },
        async loadAttempts(userId) {
            const { data, error } = await supabase
                .from('time_logs')
                .select('*, clients(name), tasks(title), time_log_segments!time_log_segments_time_log_id_fkey(*)')
                .eq('user_id', userId)
                .eq('status', 'in_progress')
                .order('created_at', { ascending: false });
            if (error) throw error;
            return timerStateFromRows(data ?? []);
        },
        finalizeOwnedAttempt,
        async syncBasecamp(timeLogId, createIfMissing) {
            if (!authenticatedUserId) throw dependencyError('Authentication required', '42501');
            const { data: ownedLog, error } = await supabase
                .from('time_logs')
                .select('id')
                .eq('id', timeLogId)
                .eq('user_id', authenticatedUserId)
                .eq('status', 'logged')
                .maybeSingle();
            if (error) throw error;
            if (!ownedLog) throw dependencyError('Finalized owned time log not found', '42501');

            const protectedRequest = new NextRequest(
                new URL('/api/integrations/basecamp/timesheet', request.url),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'sync', timeLogId, createIfMissing }),
                },
            );
            const response = await postBasecampTimesheet(protectedRequest);
            const payload = await response.json().catch(() => ({})) as {
                success?: boolean;
                skipped?: boolean;
                error?: string;
                reason?: string;
            };
            return response.ok && (payload.success === true || payload.skipped === true)
                ? { ok: true }
                : { ok: false, error: payload.error || payload.reason || 'Basecamp sync failed' };
        },
    };

    return handleTimerMutation(request, deps);
}
