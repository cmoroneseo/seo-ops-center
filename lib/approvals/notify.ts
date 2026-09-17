import 'server-only';

import { createAdminClient } from '../supabase/admin';
import type { NotificationType } from '../supabase/notifications';

/**
 * Notifications raised by the approval portal.
 *
 * These fire from client actions, which carry no Supabase session — so unlike
 * `createNotification` in lib/supabase/notifications.ts (browser, RLS-scoped) this
 * writes through the service-role client.
 *
 * Every call is fire-and-forget. A client who has just approved three blog posts must
 * never see an error because a bell notification failed to insert.
 */

export interface ApprovalNotifyInput {
    organizationId: string;
    clientId?: string | null;
    batchId: string;
    type: NotificationType;
    title: string;
    body?: string;
    entityType?: 'content_approval_batch' | 'content_approval_doc';
    entityId?: string;
}

/**
 * Who hears about it: whoever sent the batch out, and the client's account manager.
 *
 * Deliberately not the whole org — a fourteen-person agency does not need fourteen bells
 * because one client left one comment.
 */
async function recipients(batchId: string, clientId?: string | null): Promise<string[]> {
    const admin = createAdminClient();
    const ids = new Set<string>();

    const { data: batch } = await admin
        .from('content_approval_batches')
        .select('created_by, client_id')
        .eq('id', batchId)
        .maybeSingle();

    if (batch?.created_by) ids.add(batch.created_by);

    const resolvedClientId = clientId ?? batch?.client_id;
    if (resolvedClientId) {
        const { data: client } = await admin
            .from('clients')
            .select('account_manager_id')
            .eq('id', resolvedClientId)
            .maybeSingle();
        if (client?.account_manager_id) ids.add(client.account_manager_id);
    }

    return [...ids];
}

export async function notifyApproval(input: ApprovalNotifyInput): Promise<void> {
    try {
        const users = await recipients(input.batchId, input.clientId);
        if (users.length === 0) return;

        const admin = createAdminClient();
        await admin.from('notifications').insert(
            users.map((userId) => ({
                organization_id: input.organizationId,
                user_id: userId,
                type: input.type,
                title: input.title,
                body: input.body ?? null,
                entity_type: input.entityType ?? 'content_approval_batch',
                entity_id: input.entityId ?? input.batchId,
                client_id: input.clientId ?? null,
            })),
        );
    } catch (error) {
        // Never surface this to a reviewing client.
        console.error('[approvals] notification failed:', error instanceof Error ? error.message : error);
    }
}

/** Human-readable decision text, shared by the bell and the activity trail. */
export function decisionTitle(docTitle: string, status: string): string {
    if (status === 'approved') return `“${docTitle}” approved`;
    if (status === 'approved_with_edits') return `“${docTitle}” approved with edits`;
    return `Changes requested on “${docTitle}”`;
}
