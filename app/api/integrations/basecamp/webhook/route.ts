import { createAdminClient } from '@/lib/supabase/admin';
import { logClientActivity } from '@/lib/supabase/client-activity';
import {
    getBasecampTimesheetEntryState,
    getBasecampTodo,
    isBasecampConfigured,
} from '@/lib/basecamp/api';
import {
    createBasecampWebhookPost,
    type BasecampWebhookTask,
} from '@/lib/basecamp/webhook-route';
import { createTimesheetEntryImporter } from '@/lib/basecamp/timesheet-webhook-route';
import { createTimesheetImportStore } from '@/lib/basecamp/timesheet-import-store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/integrations/basecamp/webhook
 *
 * Basecamp does not sign webhook requests or support custom request headers.
 * Treat the payload as an untrusted notification, then verify the canonical
 * linked to-do through the authenticated Basecamp API before changing state.
 * Handles:
 *   - Todo completion → marks the linked SEO PM task as done
 *   - Todo uncomplete → reopens the linked SEO PM task
 *   - Timesheet entry created/changed/trashed → imports into the time ledger
 */
export const POST = createBasecampWebhookPost({
    importTimesheetEntry: createTimesheetEntryImporter({
        expectedAccountId: process.env.BASECAMP_ACCOUNT_ID ?? '',
        now: () => new Date().toISOString(),
        provider: {
            isConfigured: isBasecampConfigured,
            getTimesheetEntry: getBasecampTimesheetEntryState,
        },
        store: createTimesheetImportStore(),
    }),
    expectedAccountId: process.env.BASECAMP_ACCOUNT_ID ?? '',
    now: () => new Date().toISOString(),
    provider: {
        isConfigured: isBasecampConfigured,
        getTodo: getBasecampTodo,
    },
    store: {
        async claimDelivery(delivery) {
            const admin = createAdminClient();
            const { error } = await admin
                .from('basecamp_webhook_deliveries')
                .insert({
                    event_id: delivery.eventId,
                    request_id: delivery.requestId,
                    kind: delivery.kind,
                    recording_id: delivery.recordingId,
                });
            if (!error) return 'new';
            if (error.code !== '23505') throw error;

            let receipt = await admin
                .from('basecamp_webhook_deliveries')
                .select('processed_at')
                .eq('event_id', delivery.eventId)
                .maybeSingle();
            if (receipt.error) throw receipt.error;
            if (!receipt.data) {
                receipt = await admin
                    .from('basecamp_webhook_deliveries')
                    .select('processed_at')
                    .eq('request_id', delivery.requestId)
                    .maybeSingle();
                if (receipt.error) throw receipt.error;
            }
            return receipt.data?.processed_at ? 'processed' : 'retry';
        },
        async markDeliveryProcessed(eventId, result) {
            const { error } = await createAdminClient()
                .from('basecamp_webhook_deliveries')
                .update({
                    processed_at: new Date().toISOString(),
                    result,
                })
                .eq('event_id', eventId);
            if (error) throw error;
        },
        async getTaskByTodoId(todoId) {
            const { data, error } = await createAdminClient()
                .from('tasks')
                .select('id, status, status_history, organization_id, client_id, title, basecamp_todo_id, basecamp_project_id')
                .eq('basecamp_todo_id', todoId)
                .maybeSingle();
            if (error) throw error;
            if (!data?.basecamp_todo_id || !data.basecamp_project_id) return null;
            return {
                id: data.id,
                status: data.status,
                statusHistory: Array.isArray(data.status_history) ? data.status_history : [],
                organizationId: data.organization_id,
                clientId: data.client_id,
                title: data.title,
                basecampTodoId: String(data.basecamp_todo_id),
                basecampProjectId: String(data.basecamp_project_id),
            };
        },
        async updateTaskStatus(task, status, actorName, now) {
            const statusHistory = [
                ...task.statusHistory,
                { status, at: now, by: actorName },
            ];
            const { data, error } = await createAdminClient()
                .from('tasks')
                .update({
                    status,
                    completed_at: status === 'done' ? now : null,
                    status_history: statusHistory,
                    last_synced_at: now,
                })
                .eq('id', task.id)
                .eq('status', task.status)
                .select('id')
                .maybeSingle();
            if (error) throw error;
            return Boolean(data);
        },
    },
    async logCompletion(task: BasecampWebhookTask, actorName: string) {
        if (!task.clientId) return;
        await logClientActivity({
            organizationId: task.organizationId,
            clientId: task.clientId,
            eventType: 'task.completed',
            actorName,
            metadata: { taskId: task.id, title: task.title, source: 'basecamp' },
        });
    },
});
